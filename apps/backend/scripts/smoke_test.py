"""End-to-end smoke test against a running aftercall server, using the real Jev API.

    cd apps/backend
    python -m uvicorn aftercall.api:app          # terminal 1
    python scripts/smoke_test.py                 # terminal 2

It uses --api-key, or DEV_API_KEY (the demo workspace a memory-store server seeds), creates the sample
trackers and their signals, checks that choosing fewer trackers estimates fewer tokens, uploads the sample calls plus two generated ones (one just under the token budget,
to force signal splitting, and one over it, to check the over_limit flag), waits for the
worker, then checks results, CSV export and usage. Exits 1 if the pipeline is broken.
Answer accuracy against the `expected` labels is reported but does not fail the run.
"""

import argparse
import csv
import io
import json
import sys
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from aftercall import tokens
from aftercall.config import get_settings

SAMPLES = BACKEND.parent.parent / "samples"
FILLER = [
    "agent: Ji, main aapki baat samajh rahi hoon, kripya thoda detail mein batayein ki problem kab se hai.",
    "caller: Dekhiye, pichle hafte se daant mein dard hai, raat ko neend nahi aati, thanda paani peene par aur badh jaata hai.",
    "agent: Theek hai, kya aapne koi dawai li hai ya pehle kisi doctor ko dikhaya hai is baare mein?",
    "caller: Ek painkiller li thi, thoda aaram mila par phir se shuru ho gaya. Office ki wajah se time nahi mil raha.",
]


def build_long_transcript(target_tokens: int) -> str:
    lines, n, i = [], 0, 0
    while True:
        line = FILLER[i % len(FILLER)] + f" ({i})"
        cost = tokens.count(line + "\n")
        if n + cost > target_tokens:
            break
        lines.append(line)
        n += cost
        i += 1
    return "\n".join(lines)


class Check:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def __call__(self, ok: bool, label: str) -> bool:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
        if not ok:
            self.failures.append(label)
        return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", help="a workspace API key; defaults to DEV_API_KEY")
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()

    check = Check()
    budget = get_settings().token_budget
    http = httpx.Client(base_url=args.base_url, timeout=60)

    print("1. Server")
    check(http.get("/health").json() == {"status": "ok"}, f"{args.base_url}/health is ok")

    api_key = args.api_key or get_settings().dev_api_key
    if not api_key:
        sys.exit("Pass --api-key, or set DEV_API_KEY (the memory-store server seeds a demo workspace with it)")
    http.headers["X-API-Key"] = api_key

    print("2. Trackers and signals")
    trackers = json.loads((SAMPLES / "trackers_booking.json").read_text(encoding="utf-8"))
    names: list[tuple[str, str]] = []  # (tracker, signal)
    for cat in trackers:
        body = {"name": cat["name"], "description": cat["description"]}
        r = http.post("/trackers", json=body)
        if r.status_code == 409:
            r = http.put(f"/trackers/{cat['name']}", json=body)
        check(r.is_success, f"tracker {cat['name']}")
        for spec in cat["signals"]:
            url = f"/trackers/{cat['name']}/signals"
            r = http.post(url, json=spec)
            if r.status_code == 409:
                r = http.put(f"{url}/{spec['name']}", json=spec)
            check(r.is_success, f"  {spec['type']:<7} {cat['name']}.{spec['name']} → v{r.json().get('version') if r.is_success else r.text}")
            names.append((cat["name"], spec["name"]))
    bad = http.post(f"/trackers/{trackers[0]['name']}/signals",
                    json={"name": "bad", "type": "choice", "instructions": "x", "criteria": {"a": "A", "b": "B"}})
    check(bad.status_code == 422, 'choice without an "other" option is rejected (422)')
    listed = http.get("/trackers").json()
    check([c["name"] for c in listed] == [c["name"] for c in trackers], f"{len(trackers)} trackers listed")
    check(len(http.get("/signals").json()) == len(names), f"{len(names)} active signals across them")

    print("3. Upload")
    sample = json.loads((SAMPLES / "calls_booking.json").read_text(encoding="utf-8"))
    expected = {c["external_id"]: c["expected"] for c in sample["calls"]}
    run_tag = time.strftime("%H%M%S")
    near = build_long_transcript(budget - 400)
    over = build_long_transcript(budget + 2000)
    sample["calls"] += [
        {"external_id": f"near-limit-{run_tag}", "agent_id": "clinic-booking", "transcript": near},
        {"external_id": f"over-limit-{run_tag}", "agent_id": "clinic-booking", "transcript": over},
    ]
    payload = {"file": ("calls_booking.json", json.dumps(sample, ensure_ascii=False), "application/json")}
    one = trackers[1]["name"]
    subset = http.post("/uploads", params={"dry_run": True, "trackers": one}, files=payload).json()
    dry = http.post("/uploads", params={"dry_run": True}, files=payload).json()
    check(subset["trackers"] == [one] and dry["trackers"] == [c["name"] for c in trackers],
          "dry run runs the chosen trackers (all when none are chosen)")
    check(subset["estimate"]["tokens"] < dry["estimate"]["tokens"],
          f"choosing only {one!r} estimates fewer tokens ({subset['estimate']['tokens']:,} vs {dry['estimate']['tokens']:,})")
    check(dry["dry_run"] and dry["upload_id"] is None, "dry run stores nothing")
    check(dry["large"] == 1 and dry["over_limit"] == 1, "dry run flags 1 large and 1 over-limit call before running")
    print(f"  estimate: {dry['estimate']}")
    for f in dry["flagged"]:
        print(f"  flag {f['flag']:<10} row {f['row']}: {f['message']}")
    r = http.post("/uploads", files=payload)
    check(r.status_code == 201, f"upload accepted: {r.text[:300]}")
    up = r.json()
    print(f"  {up}")
    new_samples = len(sample["calls"]) - 2 - up["duplicates"]
    check(up["over_limit"] == 1 and up["over_limit_message"] is not None, "over-limit call flagged at upload with the not-charged message")
    check(up["queued"] == new_samples + 1, f"{up['queued']} calls queued")

    print("4. Worker")
    started = time.monotonic()
    while True:
        status = http.get(f"/uploads/{up['upload_id']}").json()
        if status["complete"] or time.monotonic() - started > args.timeout:
            break
        time.sleep(1)
    print(f"  {status['counts']} in {time.monotonic() - started:.1f}s")
    check(status["complete"], "all calls processed")
    check(status["counts"]["failed"] == 0, "no failed calls")

    print("5. Results")
    results = http.get(f"/uploads/{up['upload_id']}/results").json()
    by_ext = {r["external_id"]: r for r in results}
    def answered(res) -> set[tuple[str, str]]:
        return {(c, q) for c, qs in res["answers"].items() for q in qs}

    agree = total = 0
    for ext, exp in expected.items():
        res = by_ext.get(ext)
        if res is None:
            continue  # duplicate from a previous smoke run
        check(res["status"] == "done" and answered(res) == set(names), f"{ext}: done, all {len(names)} signals answered")
        cells = []
        for c, n in names:
            a = res["answers"].get(c, {}).get(n)
            if a is None:
                continue
            got = round(a["value"]) if a["type"] == "score" else a["value"]
            ok = got == exp[n]  # sample labels are keyed by signal name, unique across the sample trackers
            agree += ok
            total += 1
            flag = "" if ok else f"≠{exp[n]}"
            review = "?" if a["needs_review"] else ""
            cells.append(f"{c}.{n}={got}{flag}{review}({a['confidence']:.2f})")
        print(f"      {' | '.join(cells)}")
        print(f"      tokens: estimated transcript {res['tokens']['transcript']}, billed input {res['tokens']['billed_input']}, requests {res['requests']}, model {res['model']}")
    if total:
        print(f"  agreement with hand labels: {agree}/{total} ({agree / total:.0%})  ('?' = routed to review)")

    near_res = by_ext[f"near-limit-{run_tag}"]
    check(near_res["status"] == "done" and answered(near_res) == set(names), "near-limit call answered")
    check(near_res["requests"] > 1, f"near-limit call split into {near_res['requests']} Jev requests")
    print(f"      transcript ≈{near_res['tokens']['transcript']} tokens, billed input {near_res['tokens']['billed_input']}")
    over_res = by_ext[f"over-limit-{run_tag}"]
    check(over_res["status"] == "over_limit" and over_res["tokens"]["billed_input"] == 0 and not over_res["answers"],
          f"over-limit call ({over_res['tokens']['transcript']} tokens) not sent to Jev")
    print(f"      message: {over_res['message']}")

    print("6. CSV export")
    r = http.get(f"/uploads/{up['upload_id']}/export.csv")
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    check(r.is_success and len(rows) == len(results), f"{len(rows)} rows exported")
    check(all(f"{c}.{n}_confidence" in rows[0] for c, n in names), "confidence column per tracker.signal")

    print("7. Usage")
    u = http.get("/usage").json()
    billed = sum(r["tokens"]["billed_input"] for r in results)
    print(f"  {u['totals']}")
    check(u["totals"]["billed_input_tokens"] >= billed > 0, f"usage counts billed tokens ({billed:,} this upload)")
    check(u["totals"]["over_limit_calls"] >= 1, "usage counts over-limit calls separately")

    print("8. Conditional trackers (if / else)")
    gate = {"tracker": "outcome", "signal": "call_outcome", "value": ["declined"]}
    branches = {
        "declined_followup": ({**gate, "op": "in"}, {
            "name": "offered_alternative", "type": "yes_no",
            "instructions": "Did the agent offer the caller another slot, doctor or option after they declined?"}),
        "booked_followup": ({**gate, "op": "not_in"}, {
            "name": "confirmed_details", "type": "yes_no",
            "instructions": "Did the agent confirm the appointment date or time with the caller?"}),
    }
    for name, (run_if, spec) in branches.items():
        r = http.post("/trackers", json={"name": name, "run_if": run_if})
        if r.status_code == 409:
            r = http.put(f"/trackers/{name}", json={"name": name, "run_if": run_if})
        check(r.is_success and r.json()["run_if"]["op"] == run_if["op"], f"tracker {name} runs if outcome.call_outcome {run_if['op']} [declined]")
        r = http.post(f"/trackers/{name}/signals", json=spec)
        if r.status_code == 409:
            r = http.put(f"/trackers/{name}/signals/{spec['name']}", json=spec)
        check(r.is_success, f"  yes_no  {name}.{spec['name']}")
    alone = http.post("/uploads", params={"dry_run": True, "trackers": "declined_followup"}, files=payload)
    check(alone.status_code == 422, "choosing a branch without its gate tracker is rejected (422)")

    cond_calls = {"calls": [{**c, "external_id": f"{c['external_id']}-cond-{run_tag}"}
                            for c in json.loads((SAMPLES / "calls_booking.json").read_text(encoding="utf-8"))["calls"]]}
    cond_payload = {"file": ("calls_cond.json", json.dumps(cond_calls, ensure_ascii=False), "application/json")}
    chosen = "outcome,declined_followup,booked_followup"
    r = http.post("/uploads", params={"trackers": chosen}, files=cond_payload)
    check(r.status_code == 201, f"conditional upload accepted: {r.text[:200]}")
    cup = r.json()
    check(cup["conditional"] == ["declined_followup", "booked_followup"] and cup["large"] == 0,
          f"conditional trackers listed, not flagged large; estimate (upper bound) {cup['estimate']['tokens']:,} tokens")
    started = time.monotonic()
    while not http.get(f"/uploads/{cup['upload_id']}").json()["complete"] and time.monotonic() - started < args.timeout:
        time.sleep(1)
    cres = http.get(f"/uploads/{cup['upload_id']}/results").json()
    billed = 0
    for res in cres:
        outcome = res["answers"].get("outcome", {}).get("call_outcome", {}).get("value")
        conds = res["conditions"]
        ran = [c for c in branches if conds.get(c, {}).get("met")]
        want = "declined_followup" if outcome == "declined" else "booked_followup"
        other = next(c for c in branches if c != want)
        ok = (res["status"] == "done" and ran == [want] and want in res["answers"] and other not in res["answers"]
              and conds[want]["value"] == outcome and conds[other]["reason"])
        check(ok, f"{res['external_id']}: outcome={outcome} → ran {ran}, "
                  f"{want}.{branches[want][1]['name']}={res['answers'].get(want, {}).get(branches[want][1]['name'], {}).get('value')}; "
                  f"requests {res['requests']}, billed {res['tokens']['billed_input']}")
        billed += res["tokens"]["billed_input"]
    check(0 < billed <= cup["estimate"]["tokens"] * 1.1,
          f"billed {billed:,} tokens vs estimate (every branch) {cup['estimate']['tokens']:,}")

    print()
    if check.failures:
        print(f"SMOKE TEST FAILED: {len(check.failures)} check(s)")
        for f in check.failures:
            print(f"  - {f}")
        return 1
    print("SMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
