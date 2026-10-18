import csv
import io
import json
from pathlib import Path

import pytest

from aftercall import tasks, tokens, worker
from aftercall.api import app
from aftercall.config import get_settings

OUTCOME_Q = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
             "criteria": {"booked": "Booked a slot", "declined": "Said no", "other": "Anything else"}}
HUMAN_Q = {"name": "asked_for_human", "type": "yes_no", "instructions": "Did the caller ask for a human?"}
FRUSTRATION_Q = {"name": "frustration", "type": "score", "instructions": "How frustrated?",
                 "criteria": ["calm", "irritated", "angry"]}
# Parent trackers → the Jev signals under them.
TRACKERS = {"sales": [OUTCOME_Q], "experience": [HUMAN_Q, FRUSTRATION_Q]}


def setup_trackers(client, trackers=TRACKERS) -> None:
    for cat, signals in trackers.items():
        assert client.post("/trackers", json={"name": cat}).status_code == 201
        for q in signals:
            assert client.post(f"/trackers/{cat}/signals", json=q).status_code == 201


QUEUED: list[str] = []


@pytest.fixture(autouse=True)
def hold_queue(monkeypatch):
    """Calls wait in QUEUED until a test drains them with an engine of its choice."""
    QUEUED.clear()
    monkeypatch.setattr(tasks, "enqueue_call", QUEUED.append)


def drain(engine, store) -> None:
    while QUEUED:
        worker.run_call(store, engine, QUEUED.pop(0))


def upload(client, calls, name="calls.json", **params):
    return client.post("/uploads", params=params, files={"file": (name, json.dumps({"calls": calls}), "application/json")})


def test_requires_api_key(client):
    assert client.get("/trackers", headers={"X-API-Key": "nope"}).status_code == 401


def test_tracker_and_signal_lifecycle(client):
    setup_trackers(client)
    assert client.post("/trackers", json={"name": "sales"}).status_code == 409
    assert client.post("/trackers", json={"name": "bad__name"}).status_code == 422
    assert client.post("/trackers/sales/signals", json=OUTCOME_Q).status_code == 409
    assert client.post("/trackers/nope/signals", json=OUTCOME_Q).status_code == 404
    # The same signal name can live in two trackers.
    assert client.post("/trackers/experience/signals", json=OUTCOME_Q).status_code == 201

    edited = {**HUMAN_Q, "instructions": "Did the caller ask for a real person?"}
    r = client.put("/trackers/experience/signals/asked_for_human", json=edited)
    assert r.json()["version"] == 2 and r.json()["tracker"] == "experience"

    client.delete("/trackers/experience/signals/frustration")
    exp = client.get("/trackers/experience").json()
    assert [q["name"] for q in exp["signals"]] == ["asked_for_human", "outcome"]
    assert exp["signal_tokens"] == sum(q["tokens"] for q in exp["signals"]) > 0

    client.delete("/trackers/sales")
    assert [c["name"] for c in client.get("/trackers").json()] == ["experience"]
    assert len(client.get("/trackers", params={"include_inactive": True}).json()) == 2
    assert [(q["tracker"], q["name"]) for q in client.get("/signals").json()] == [
        ("experience", "asked_for_human"), ("experience", "outcome")]
    assert len(client.get("/signals", params={"include_inactive": True}).json()) == 4

    client.put("/trackers/sales", json={"name": "sales", "description": "Did the call sell?"})
    assert client.get("/trackers/sales").json()["active"] is True


def test_upload_requires_signals(client):
    assert upload(client, [{"transcript": "hi"}]).status_code == 400
    client.post("/trackers", json={"name": "empty"})
    assert upload(client, [{"transcript": "hi"}]).status_code == 400
    assert upload(client, [{"transcript": "hi"}], trackers="empty").status_code == 422


def test_only_chosen_trackers_run(client, store, fake_engine):
    setup_trackers(client)
    bad = upload(client, [{"transcript": "hi"}], trackers="sales,nope")
    assert bad.status_code == 422 and "nope" in bad.text

    everything = upload(client, [{"transcript": "hi"}], dry_run=True).json()
    assert everything["trackers"] == ["sales", "experience"] and everything["signals"] == 3

    body = upload(client, [{"external_id": "s1", "transcript": "caller: book karo"}], trackers="experience").json()
    assert body["trackers"] == ["experience"] and body["signals"] == 2
    assert body["estimate"]["tokens"] < everything["estimate"]["tokens"]

    # The trackers chosen at upload are what run, even if more are added before the worker gets to it.
    client.post("/trackers", json={"name": "later"})
    client.post("/trackers/later/signals", json=OUTCOME_Q)
    drain(fake_engine, store)
    assert [set(r) for r in fake_engine.requests] == [{"experience__asked_for_human", "experience__frustration"}]
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["trackers"] == ["experience"] and set(res["answers"]) == {"experience"}
    assert set(res["answers"]["experience"]) == {"asked_for_human", "frustration"}
    assert client.get(f"/uploads/{body['upload_id']}").json()["trackers"] == ["experience"]
    assert res["started_at"] is None
    second = upload(client, [{"external_id": "s2", "transcript": "hi", "started_at": "2026-09-25T10:00:00+05:30"}]).json()
    listed = client.get("/uploads").json()
    assert [u["upload_id"] for u in listed] == [second["upload_id"], body["upload_id"]]
    assert listed[0]["counts"]["queued"] == 1 and listed[1]["complete"] is True

    # Repeated params work as well as comma-separated.
    both = client.post("/uploads", params=[("trackers", "sales"), ("trackers", "later"), ("dry_run", "true")],
                       files={"file": ("c.json", json.dumps({"calls": [{"transcript": "hi"}]}), "application/json")})
    assert both.json()["trackers"] == ["sales", "later"]


def test_bulk_upload_to_results(client, store, fake_engine):
    setup_trackers(client)

    over = "caller: " + "bahut lamba call " * 1500  # > TOKEN_BUDGET=2000 in tests
    r = upload(client, [
        {"external_id": "c1", "transcript": "caller: mujhe human se baat karni hai"},
        {"external_id": "c2", "transcript": [{"speaker": "agent", "text": "hello"}, {"speaker": "caller", "text": "book karo"}]},
        {"external_id": "c3", "transcript": over},
    ])
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["queued"], body["over_limit"]) == (2, 1)
    assert "weren't charged" in body["over_limit_message"]

    # Re-uploading the same external_id is skipped, not double-billed.
    assert upload(client, [{"external_id": "c1", "transcript": "again"}]).json()["duplicates"] == 1

    drain(fake_engine, store)
    status = client.get(f"/uploads/{body['upload_id']}").json()
    assert status["complete"] and status["counts"]["done"] == 2 and status["counts"]["over_limit"] == 1

    results = {r["external_id"]: r for r in client.get(f"/uploads/{body['upload_id']}/results").json()}
    c1 = results["c1"]["answers"]
    assert c1["sales"]["outcome"]["value"] == "booked"
    assert c1["experience"]["asked_for_human"]["value"] == "yes"
    assert c1["experience"]["asked_for_human"]["needs_review"] is False
    frustration = c1["experience"]["frustration"]
    assert frustration["value"] == 1.1 and frustration["needs_review"] is True  # confidence 0.5 < 0.6
    assert results["c2"]["answers"]["experience"]["asked_for_human"]["needs_review"] is True  # noul 0.55 → 0.1
    assert results["c1"]["tokens"]["billed_input"] == 300
    assert results["c3"]["status"] == "over_limit" and results["c3"]["answers"] == {}
    assert len(fake_engine.requests) == 2  # the over-limit call never reached the engine

    rows = list(csv.DictReader(io.StringIO(client.get(f"/uploads/{body['upload_id']}/export.csv").content.decode("utf-8-sig"))))
    assert len(rows) == 3 and rows[0]["sales.outcome"] == "booked" and "experience.frustration_confidence" in rows[0]
    assert rows[0]["trackers"] == "sales|experience"

    usage = client.get("/usage").json()["totals"]
    assert usage["calls_analyzed"] == 2 and usage["billed_input_tokens"] == 600 and usage["over_limit_calls"] == 1


def test_signals_split_near_budget(client, store, fake_engine):
    setup_trackers(client)
    near = "caller: " + "haan ji " * 10
    while tokens.count(near) < 1900:  # just under TOKEN_BUDGET=2000 in tests, too big for all signals at once
        near += "haan ji "
    body = upload(client, [{"external_id": "n1", "transcript": near}]).json()
    assert body["queued"] == 1
    drain(fake_engine, store)
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["status"] == "done" and sum(len(qs) for qs in res["answers"].values()) == 3
    assert res["requests"] == len(fake_engine.requests) > 1


def test_engine_failure_marks_call_failed(client, store):
    from aftercall.jev import EngineError

    class Broken:
        name = "broken"

        def evaluate(self, state, signals):
            raise EngineError("HTTP 400: bad request")

    setup_trackers(client, {"sales": [OUTCOME_Q]})
    body = upload(client, [{"transcript": "hi"}]).json()
    drain(Broken(), store)
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["status"] == "failed" and "400" in res["message"]


def near_limit_transcript(target: int = 1900) -> str:
    text = "caller: " + "haan ji " * 10
    while tokens.count(text) < target:
        text += "haan ji "
    return text


def test_dry_run_flags_large_and_over_limit_without_storing(client, fake_engine):
    setup_trackers(client)
    calls = [
        {"external_id": "small", "transcript": "caller: book karo"},
        {"external_id": "large", "transcript": near_limit_transcript()},
        {"external_id": "huge", "transcript": "caller: " + "bahut lamba call " * 1500},
    ]
    r = client.post("/uploads", params={"dry_run": True},
                    files={"file": ("c.json", json.dumps({"calls": calls}), "application/json")})
    body = r.json()
    assert body["dry_run"] is True and body["upload_id"] is None
    assert (body["queued"], body["large"], body["over_limit"]) == (2, 1, 1)
    flags = {f["external_id"]: f for f in body["flagged"]}
    assert flags["large"]["flag"] == "large" and flags["large"]["requests"] > 1 and flags["large"]["multiplier"] > 1
    assert "parts" in flags["large"]["message"]
    assert flags["huge"]["flag"] == "over_limit" and flags["huge"]["estimated_tokens"] == 0
    assert body["estimate"]["cost"] is None  # no price set yet

    # Nothing was stored: the same ids upload fresh afterwards, and nothing ran.
    real = upload(client, calls).json()
    assert real["duplicates"] == 0 and real["large"] == 1
    assert fake_engine.requests == []


def test_large_call_warning_in_results(client, store, fake_engine):
    setup_trackers(client)
    body = upload(client, [{"external_id": "n", "transcript": near_limit_transcript()}]).json()
    drain(fake_engine, store)
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["large"] is True and "parts" in res["warning"]
    assert res["estimate"]["requests"] == res["requests"] > 1


def cond(tracker, signal, op, value):
    return {"tracker": tracker, "signal": signal, "op": op, "value": value}


def test_condition_is_checked_when_saved(client):
    setup_trackers(client)
    ok = client.post("/trackers", json={"name": "retention", "run_if": cond("sales", "outcome", "in", ["declined"])})
    assert ok.status_code == 201 and ok.json()["run_if"]["value"] == ["declined"]
    bad = {
        "no such signal": cond("sales", "nope", "in", ["declined"]),
        "no such tracker": cond("nope", "outcome", "in", ["declined"]),
        "not an option": cond("sales", "outcome", "in", ["maybe"]),
        "gte on a choice": cond("sales", "outcome", "gte", 1),
        "in on a score": cond("experience", "frustration", "in", ["1"]),
        "yes_no takes yes/no": cond("experience", "asked_for_human", "in", ["true"]),
    }
    for why, run_if in bad.items():
        r = client.post("/trackers", json={"name": "x", "run_if": run_if})
        assert r.status_code == 422, why
    assert client.post("/trackers", json={"name": "angry", "run_if": cond("experience", "frustration", "gte", 2)}).status_code == 201
    assert client.post("/trackers", json={"name": "escalate", "run_if": cond("experience", "asked_for_human", "in", ["yes"])}).status_code == 201

    # sales → retention → sales would loop.
    client.post("/trackers/retention/signals", json=HUMAN_Q)
    loop = client.put("/trackers/sales", json={"name": "sales", "run_if": cond("retention", "asked_for_human", "in", ["yes"])})
    assert loop.status_code == 422 and "each other" in loop.text
    # Leaving run_if out of a PUT removes the condition.
    assert client.put("/trackers/retention", json={"name": "retention"}).json()["run_if"] is None


def test_if_else_trackers_run_by_condition(client, store, fake_engine):
    setup_trackers(client)  # the fake engine answers sales.outcome = "booked"
    branches = {
        "upsell": (cond("sales", "outcome", "in", ["booked"]), HUMAN_Q),  # if
        "win_back": (cond("sales", "outcome", "not_in", ["booked"]), FRUSTRATION_Q),  # else
        "win_back_detail": (cond("win_back", "frustration", "gte", 0), OUTCOME_Q),  # only after win_back
    }
    for name, (run_if, q) in branches.items():
        assert client.post("/trackers", json={"name": name, "run_if": run_if}).status_code == 201
        assert client.post(f"/trackers/{name}/signals", json=q).status_code == 201

    alone = upload(client, [{"transcript": "hi"}], trackers="upsell")
    assert alone.status_code == 422 and "choose 'sales' as well" in alone.text

    body = upload(client, [{"external_id": "b1", "transcript": "caller: book karo"}]).json()
    assert body["trackers"] == ["sales", "experience", "upsell", "win_back", "win_back_detail"]
    assert body["conditional"] == ["upsell", "win_back", "win_back_detail"]
    # The estimate assumes every condition holds: 3 stages, one request each.
    assert body["estimate"]["requests"] == 3 and body["large"] == 0

    drain(fake_engine, store)
    assert [set(r) for r in fake_engine.requests] == [
        {"sales__outcome", "experience__asked_for_human", "experience__frustration"},
        {"upsell__asked_for_human"},
    ]
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    # Both the gate's answer and the branch's answer come back.
    assert set(res["answers"]) == {"sales", "experience", "upsell"}
    assert res["answers"]["sales"]["outcome"]["value"] == "booked"
    c = res["conditions"]
    assert c["upsell"]["met"] is True and c["upsell"]["value"] == "booked" and c["upsell"]["reason"] is None
    assert c["win_back"]["met"] is False and "'booked'" in c["win_back"]["reason"]
    assert c["win_back"]["condition"] == "sales.outcome not in [booked]"
    assert c["win_back_detail"]["met"] is False and "didn't run" in c["win_back_detail"]["reason"]
    assert res["requests"] == 2 and res["tokens"]["billed_input"] == 400  # skipped branches cost nothing
    assert res["large"] is False and res["warning"] is None

    rows = list(csv.DictReader(io.StringIO(client.get(f"/uploads/{body['upload_id']}/export.csv").content.decode("utf-8-sig"))))
    assert rows[0]["upsell.ran"] == "True" and rows[0]["win_back.ran"] == "False"
    assert rows[0]["upsell.asked_for_human"] == "yes" and "win_back.frustration" not in rows[0]  # columns come from answers

    # Turning off the gate's tracker is refused while conditions depend on it, unless forced;
    # then the trackers that depend on it drop out of the default choice.
    refused = client.delete("/trackers/sales")
    assert refused.status_code == 409 and "'upsell' runs only if sales.outcome in [booked]" in refused.text
    assert client.delete("/trackers/sales", params={"force": True}).status_code == 200
    assert upload(client, [{"transcript": "hi"}], dry_run=True).json()["trackers"] == ["experience"]


def test_signal_cap_splits_requests_without_flagging(client, store, fake_engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_signals_per_request", 2)
    setup_trackers(client)
    body = upload(client, [{"external_id": "q1", "transcript": "caller: hello"}]).json()
    assert body["estimate"]["requests"] == 2 and body["large"] == 0 and body["flagged"] == []
    drain(fake_engine, store)
    # Each tracker stays in one request.
    assert sorted(sorted(r) for r in fake_engine.requests) == [
        ["experience__asked_for_human", "experience__frustration"], ["sales__outcome"]]
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["requests"] == 2 and res["large"] is False and res["conditions"] == {}


def test_permanent_delete_keeps_past_answers(client, store, fake_engine):
    setup_trackers(client)
    body = upload(client, [{"external_id": "p1", "transcript": "caller: hello"}]).json()
    drain(fake_engine, store)

    assert client.delete("/trackers/experience/signals/frustration", params={"permanent": True}).status_code == 204
    assert client.get("/trackers/experience/signals/frustration").status_code == 404
    assert client.delete("/trackers/sales", params={"permanent": True}).status_code == 204
    assert client.get("/trackers/sales").status_code == 404
    assert [c["name"] for c in client.get("/trackers", params={"include_inactive": True}).json()] == ["experience"]
    assert client.delete("/trackers/nope", params={"permanent": True}).status_code == 404

    # Past results still show what was answered, with the version that answered it.
    res = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
    assert res["answers"]["sales"]["outcome"]["value"] == "booked"
    assert res["answers"]["experience"]["frustration"]["signal_version"] == "1"
    rows = list(csv.DictReader(io.StringIO(client.get(f"/uploads/{body['upload_id']}/export.csv").content.decode("utf-8-sig"))))
    assert rows[0]["sales.outcome"] == "booked"

    # The names are free again, and start over at version 1.
    assert client.post("/trackers", json={"name": "sales"}).status_code == 201
    assert client.post("/trackers/sales/signals", json=OUTCOME_Q).json()["version"] == 1
    assert client.post("/trackers/experience/signals", json=FRUSTRATION_Q).json()["version"] == 1


def test_conditions_block_deletes_and_breaking_edits(client):
    setup_trackers(client)
    client.post("/trackers", json={"name": "upsell", "run_if": cond("sales", "outcome", "in", ["booked"])})

    for path in ("/trackers/sales", "/trackers/sales/signals/outcome"):
        gone = client.delete(path, params={"permanent": True})
        assert gone.status_code == 409 and "'upsell' runs only if sales.outcome in [booked]" in gone.text
        off = client.delete(path)
        assert off.status_code == 409 and "force=true" in off.text
    # Other signals in the tracker aren't depended on.
    assert client.delete("/trackers/experience/signals/frustration").status_code == 200

    # An edit that drops an answer the condition uses is refused; one that keeps it is fine.
    no_booked = {**OUTCOME_Q, "criteria": {"declined": "Said no", "other": "Anything else"}}
    edit = client.put("/trackers/sales/signals/outcome", json=no_booked)
    assert edit.status_code == 409 and "'booked'" in edit.text
    as_score = {"name": "outcome", "type": "score", "instructions": "How well?", "criteria": ["bad", "good"]}
    assert client.put("/trackers/sales/signals/outcome", json=as_score).status_code == 409
    more = {**OUTCOME_Q, "criteria": {**OUTCOME_Q["criteria"], "rescheduled": "Moved the slot"}}
    assert client.put("/trackers/sales/signals/outcome", json=more).json()["version"] == 2

    assert client.delete("/trackers/sales/signals/outcome", params={"force": True}).json()["active"] is False
    # Once the dependent tracker is gone, the gate can be deleted.
    assert client.delete("/trackers/upsell", params={"permanent": True}).status_code == 204
    assert client.delete("/trackers/sales", params={"permanent": True}).status_code == 204


def test_delete_calls_and_uploads(client, store, fake_engine):
    from aftercall.models import Answer, Call

    setup_trackers(client)
    body = upload(client, [{"external_id": "d1", "transcript": "caller: secret details"},
                           {"external_id": "d2", "transcript": "caller: more"}]).json()
    drain(fake_engine, store)
    usage = client.get("/usage").json()["totals"]
    results = client.get(f"/uploads/{body['upload_id']}/results").json()
    first, second = results[0]["call_id"], results[1]["call_id"]

    assert client.delete(f"/calls/{first}").status_code == 204
    assert client.get(f"/calls/{first}").status_code == 404
    assert client.delete(f"/calls/{first}").status_code == 404
    assert [r["call_id"] for r in client.get(f"/uploads/{body['upload_id']}/results").json()] == [second]
    gone = store.get(Call, first)
    assert gone.transcript == "" and gone.external_id is None and gone.status == "deleted" and gone.deleted
    assert store.count(Answer, ("call_id", "==", first)) == 0
    # Billing history is untouched, and the external_id can be uploaded again.
    assert client.get("/usage").json()["totals"] == usage
    assert upload(client, [{"external_id": "d1", "transcript": "again"}], dry_run=True).json()["duplicates"] == 0

    assert client.delete(f"/uploads/{body['upload_id']}").status_code == 204
    assert client.get(f"/uploads/{body['upload_id']}").status_code == 404
    assert client.get(f"/calls/{second}").status_code == 404
    assert client.get("/usage").json()["totals"] == usage

    # Queued calls in a deleted upload are never run.
    queued = upload(client, [{"external_id": "q1", "transcript": "hi"}]).json()
    assert client.delete(f"/uploads/{queued['upload_id']}").status_code == 204
    fake_engine.requests.clear()
    drain(fake_engine, store)
    assert fake_engine.requests == []

    # A call being analysed can't be deleted until it's done.
    busy = upload(client, [{"external_id": "b1", "transcript": "hi"}]).json()
    busy_id = QUEUED[0]
    assert worker.claim(store, busy_id) is not None
    assert client.delete(f"/calls/{busy_id}").status_code == 409
    assert client.delete(f"/uploads/{busy['upload_id']}").status_code == 409


SAMPLE_TRACKERS = Path(__file__).resolve().parents[3] / "samples" / "trackers_booking.json"


class PairEngine:
    """Answers overlap signals: yes for the given pairs, no for the rest. Records requests."""

    name = "pairs"

    def __init__(self, overlapping: set[tuple[str, str]]):
        self.overlapping = {tuple(sorted(p)) for p in overlapping}
        self.requests: list[dict] = []

    def evaluate(self, state, signals):
        from aftercall.jev import EngineResult

        self.requests.append(signals)
        answers = {k: {"type": "noul", "noul": 0.93 if tuple(sorted(k.split("__"))) in self.overlapping else 0.08}
                   for k in signals}
        return EngineResult(model="fake-1", answers=answers, input_tokens=50 * len(signals), output_tokens=1, latency_ms=1)


@pytest.fixture
def with_engine():
    from aftercall.deps import get_engine

    def use(engine):
        app.dependency_overrides[get_engine] = lambda: engine
        return engine

    yield use
    app.dependency_overrides.clear()


def test_import_trackers_from_json(client, with_engine):
    with_engine(None)
    raw = SAMPLE_TRACKERS.read_bytes()
    dry = client.post("/trackers/import", params={"dry_run": True}, content=raw)
    assert dry.status_code == 201 and dry.json()["created"] == ["outcome", "compliance", "experience"]
    assert [len(c["signals"]) for c in dry.json()["trackers"]] == [2, 1, 2]
    assert client.get("/trackers").json() == []  # dry run saved nothing

    r = client.post("/trackers/import", content=raw).json()
    assert (r["created"], r["signals_created"]) == (["outcome", "compliance", "experience"], 5)
    assert r["overlap"] is None and "TYPESAFE_API_KEY" in r["overlap_error"]
    assert [q["name"] for q in client.get("/trackers/outcome").json()["signals"]] == ["call_outcome", "decline_reason"]

    again = client.post("/trackers/import", content=raw)
    assert again.status_code == 409 and len(again.json()["detail"]["errors"]) == 3
    assert client.post("/trackers/import", params={"on_conflict": "skip"}, content=raw).json()["skipped"] == [
        "outcome", "compliance", "experience"]

    # Update from a multipart file: one changed signal gets a new version, the rest are unchanged.
    data = json.loads(raw)
    data[2]["signals"][0]["instructions"] = "Did the caller ask to speak to a person?"
    up = client.post("/trackers/import", params={"on_conflict": "update"},
                     files={"file": ("cats.json", json.dumps({"trackers": data}), "application/json")}).json()
    assert (up["updated"], up["signals_updated"], up["signals_unchanged"]) == (
        ["outcome", "compliance", "experience"], 1, 4)
    assert client.get("/trackers/experience/signals/asked_for_human").json()["version"] == 2


def test_import_is_all_or_nothing_with_every_error_listed(client, with_engine):
    with_engine(None)
    bad = [
        {"name": "good", "signals": [OUTCOME_Q]},
        {"name": "Bad Name", "signals": []},
        {"name": "scores", "signals": [{"name": "s", "type": "score", "instructions": "x", "criteria": ["only one"]}]},
        {"name": "dupes", "signals": [HUMAN_Q, HUMAN_Q]},
        {"name": "branch", "run_if": cond("good", "outcome", "in", ["maybe"]), "signals": [HUMAN_Q]},
    ]
    r = client.post("/trackers/import", json=bad)
    errors = r.json()["detail"]["errors"]
    assert r.status_code == 422
    assert any("trackers[1] ('Bad Name').name" in e for e in errors)
    assert any("trackers[2] ('scores').signals[0]" in e and "levels" in e for e in errors)
    assert any("dupes: signal 'asked_for_human' appears more than once" in e for e in errors)
    assert client.get("/trackers").json() == []

    # Conditions only fail once the rest is valid, and are checked against the file itself.
    r = client.post("/trackers/import", json=[bad[0], bad[4]])
    assert r.status_code == 422 and "can't answer 'maybe'" in r.text
    assert client.get("/trackers").json() == []
    # A branch listed before its gate in the file still works.
    ok = [{**bad[4], "run_if": cond("good", "outcome", "in", ["booked"])}, bad[0]]
    assert client.post("/trackers/import", json=ok).json()["created"] == ["branch", "good"]
    assert client.get("/trackers/branch").json()["run_if"]["tracker"] == "good"
    assert client.post("/trackers/import", content=b"{not json").status_code == 422


def test_overlap_check_colours_overlapping_trackers(client, with_engine):
    engine = with_engine(PairEngine({("sales", "retention"), ("retention", "billing")}))
    setup_trackers(client, {"sales": [OUTCOME_Q], "experience": [HUMAN_Q], "retention": [OUTCOME_Q], "billing": [FRUSTRATION_Q]})

    r = client.post("/overlap").json()
    assert r["asked"] == 6 and r["billed"] is False and len(engine.requests) == 1
    cats = r["trackers"]
    assert cats["sales"]["color"] == cats["retention"]["color"] == cats["billing"]["color"] is not None
    assert cats["experience"] == {"group": None, "color": None, "overlaps_with": []}
    assert cats["retention"]["overlaps_with"] == ["sales", "billing"]
    assert {(p["a"], p["b"]) for p in r["pairs"] if p["overlaps"]} == {("retention", "sales"), ("billing", "retention")}

    listed = {c["name"]: c for c in client.get("/trackers").json()}
    assert listed["sales"]["color"] == cats["sales"]["color"] and listed["experience"]["color"] is None

    # Cached: asking again doesn't call Jev.
    assert client.post("/overlap").json()["asked"] == 0 and len(engine.requests) == 1
    # Changing a tracker re-asks only its pairs.
    client.put("/trackers/experience/signals/asked_for_human", json={**HUMAN_Q, "instructions": "Asked for a person?"})
    assert len(client.get("/overlap").json()["unchecked"]) == 3
    assert client.post("/overlap").json()["asked"] == 3
    assert client.post("/overlap", params={"trackers": "sales,nope"}).status_code == 422

    # Free for the customer: nothing reaches usage.
    assert client.get("/usage").json()["totals"]["billed_input_tokens"] == 0

    with_engine(None)
    assert client.post("/overlap").status_code == 503


def test_signal_cap_applies_to_overlap_pairs(client, with_engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_signals_per_request", 2)
    engine = with_engine(PairEngine(set()))
    setup_trackers(client, {n: [HUMAN_Q] for n in ("a", "b", "c", "d")})  # 6 pairs
    assert client.post("/overlap").json()["asked"] == 6
    assert sorted(len(r) for r in engine.requests) == [2, 2, 2]


def test_import_runs_the_overlap_check(client, with_engine):
    with_engine(PairEngine({("outcome", "experience")}))
    r = client.post("/trackers/import", content=SAMPLE_TRACKERS.read_bytes()).json()
    assert r["overlap"]["asked"] == 3 and r["overlap_error"] is None
    colours = {c["name"]: c["color"] for c in r["trackers"]}
    assert colours["outcome"] == colours["experience"] is not None and colours["compliance"] is None
