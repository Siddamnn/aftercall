"""Trackers, signals, import and overlap on the in-memory store.

Runs against a small app holding only the trackers router (with the real auth dependencies), so it
doesn't depend on the other routes.
"""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from aftercall import workspaces
from aftercall.deps import get_engine
from aftercall.jev import EngineResult
from aftercall.models import Answer, Project, Signal, SignalVersion, Tracker, TrackerOverlap
from aftercall.routes import trackers as routes

OUTCOME_Q = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
             "criteria": {"booked": "Booked a slot", "declined": "Said no", "other": "Anything else"}}
HUMAN_Q = {"name": "asked_for_human", "type": "yes_no", "instructions": "Did the caller ask for a human?"}
FRUSTRATION_Q = {"name": "frustration", "type": "score", "instructions": "How frustrated?",
                 "criteria": ["calm", "irritated", "angry"]}
TRACKERS = {"sales": [OUTCOME_Q], "experience": [HUMAN_Q, FRUSTRATION_Q]}
SAMPLE_TRACKERS = Path(__file__).resolve().parents[3] / "samples" / "trackers_booking.json"


class PairEngine:
    """Answers overlap signals: yes for the given pairs, no for the rest. Records requests."""

    name = "pairs"

    def __init__(self, overlapping: set[tuple[str, str]]):
        self.overlapping = {tuple(sorted(p)) for p in overlapping}
        self.requests: list[dict] = []

    def evaluate(self, state, signals):
        self.requests.append(signals)
        answers = {k: {"type": "noul", "noul": 0.93 if tuple(sorted(k.split("__"))) in self.overlapping else 0.08}
                   for k in signals}
        return EngineResult(model="fake-1", answers=answers, input_tokens=50 * len(signals), output_tokens=1, latency_ms=1)


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_engine] = lambda: None
    return app


@pytest.fixture
def client(app, store, tenant):
    with TestClient(app) as c:
        c.headers["X-API-Key"] = tenant.api_key
        yield c


@pytest.fixture
def with_engine(app):
    def use(engine):
        app.dependency_overrides[get_engine] = lambda: engine
        return engine

    return use


@pytest.fixture
def other_project(store, tenant) -> Project:
    """A second project in the same workspace."""
    project = Project(tenant_id=tenant.id, name="Other")
    store.put(project)
    return project


def cond(tracker, signal, op, value):
    return {"tracker": tracker, "signal": signal, "op": op, "value": value}


def setup_trackers(client, trackers=TRACKERS) -> None:
    for name, signals in trackers.items():
        assert client.post("/trackers", json={"name": name}).status_code == 201
        for q in signals:
            assert client.post(f"/trackers/{name}/signals", json=q).status_code == 201


def names(items) -> list[str]:
    return [i["name"] for i in items]


# ── Trackers and signals ─────────────────────────────────────────────────────


def test_requires_api_key(client):
    assert client.get("/trackers", headers={"X-API-Key": "nope"}).status_code == 401


def test_create_list_update_and_deactivate(client):
    setup_trackers(client)
    assert client.post("/trackers", json={"name": "sales"}).status_code == 409
    assert client.post("/trackers", json={"name": "bad__name"}).status_code == 422
    assert names(client.get("/trackers").json()) == ["sales", "experience"]  # creation order

    assert client.put("/trackers/sales", json={"name": "other"}).status_code == 422
    assert client.put("/trackers/nope", json={"name": "nope"}).status_code == 404
    edited = client.put("/trackers/sales", json={"name": "sales", "description": "Did the call sell?"}).json()
    assert edited["description"] == "Did the call sell?"

    off = client.delete("/trackers/sales").json()
    assert off["active"] is False and names(off["signals"]) == ["outcome"]
    assert names(client.get("/trackers").json()) == ["experience"]
    assert names(client.get("/trackers", params={"include_inactive": True}).json()) == ["sales", "experience"]

    assert client.put("/trackers/sales", json={"name": "sales"}).json()["active"] is True
    assert names(client.get("/trackers").json()) == ["sales", "experience"]


def test_signal_lifecycle_and_versions(client, store):
    setup_trackers(client)
    assert client.post("/trackers/sales/signals", json=OUTCOME_Q).status_code == 409
    assert client.post("/trackers/nope/signals", json=OUTCOME_Q).status_code == 404
    # The same signal name can live in two trackers.
    assert client.post("/trackers/experience/signals", json=OUTCOME_Q).status_code == 201

    edited = {**HUMAN_Q, "instructions": "Did the caller ask for a real person?"}
    r = client.put("/trackers/experience/signals/asked_for_human", json=edited)
    assert r.json()["version"] == 2 and r.json()["tracker"] == "experience"
    assert client.put("/trackers/experience/signals/asked_for_human", json={**edited, "name": "x"}).status_code == 422
    assert client.get("/trackers/experience/signals/nope").status_code == 404

    versions = store.find(SignalVersion, ("project_id", "!=", None), ("signal_name", "==", "asked_for_human"))
    assert sorted((v.version, v.version_number) for v in versions) == [(1, 1), (2, 2)]
    signal = store.first(Signal, ("tracker_name", "==", "experience"), ("name", "==", "asked_for_human"))
    assert signal.active_version == 2 and signal.active_spec["instructions"] == "Did the caller ask for a real person?"
    assert signal.active_version_id == f"{signal.id}:2"

    client.delete("/trackers/experience/signals/frustration")
    exp = client.get("/trackers/experience").json()
    assert names(exp["signals"]) == ["asked_for_human", "outcome"]
    assert exp["signal_tokens"] == sum(q["tokens"] for q in exp["signals"]) > 0
    assert names(client.get("/trackers/experience/signals", params={"include_inactive": True}).json()) == [
        "asked_for_human", "frustration", "outcome"]


def test_list_signals_is_flat_in_tracker_order(client):
    setup_trackers(client)
    client.delete("/trackers/experience/signals/frustration")
    client.delete("/trackers/sales")
    assert [(q["tracker"], q["name"]) for q in client.get("/signals").json()] == [("experience", "asked_for_human")]
    every = client.get("/signals", params={"include_inactive": True}).json()
    assert [(q["tracker"], q["name"]) for q in every] == [
        ("sales", "outcome"), ("experience", "asked_for_human"), ("experience", "frustration")]


def test_signals_copy_their_tracker_and_follow_it(client, store):
    setup_trackers(client)
    sales = store.first(Tracker, ("name", "==", "sales"))
    signal = store.first(Signal, ("name", "==", "outcome"))
    assert (signal.project_id, signal.tracker_name, signal.tracker_seq, signal.seq) == (sales.project_id, "sales", sales.seq, 1)
    assert signal.tracker_active is True and signal.active_spec["type"] == "choice"

    client.delete("/trackers/sales")
    assert store.get(Signal, signal.id).tracker_active is False
    assert {q["tracker"] for q in client.get("/signals").json()} == {"experience"}
    client.put("/trackers/sales", json={"name": "sales"})
    assert store.get(Signal, signal.id).tracker_active is True


def test_condition_is_checked_when_saved(client, store):
    setup_trackers(client)
    ok = client.post("/trackers", json={"name": "retention", "run_if": cond("sales", "outcome", "in", ["declined"])})
    assert ok.status_code == 201 and ok.json()["run_if"]["value"] == ["declined"]
    stored = store.first(Tracker, ("name", "==", "retention"))
    assert (stored.condition_tracker, stored.condition_signal) == ("sales", "outcome")

    bad = {
        "no such signal": cond("sales", "nope", "in", ["declined"]),
        "no such tracker": cond("nope", "outcome", "in", ["declined"]),
        "not an option": cond("sales", "outcome", "in", ["maybe"]),
        "gte on a choice": cond("sales", "outcome", "gte", 1),
        "in on a score": cond("experience", "frustration", "in", ["1"]),
        "yes_no takes yes/no": cond("experience", "asked_for_human", "in", ["true"]),
    }
    for why, run_if in bad.items():
        assert client.post("/trackers", json={"name": "x", "run_if": run_if}).status_code == 422, why
    assert client.post("/trackers", json={"name": "angry", "run_if": cond("experience", "frustration", "gte", 2)}).status_code == 201

    # sales → retention → sales would loop.
    client.post("/trackers/retention/signals", json=HUMAN_Q)
    loop = client.put("/trackers/sales", json={"name": "sales", "run_if": cond("retention", "asked_for_human", "in", ["yes"])})
    assert loop.status_code == 422 and "each other" in loop.text
    # Leaving run_if out of a PUT removes the condition, and its copies.
    assert client.put("/trackers/retention", json={"name": "retention"}).json()["run_if"] is None
    stored = store.first(Tracker, ("name", "==", "retention"))
    assert (stored.condition_tracker, stored.condition_signal) == (None, None)


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


def test_permanent_delete_removes_signals_and_keeps_answers(client, store):
    setup_trackers(client)
    client.put("/trackers/experience/signals/asked_for_human", json={**HUMAN_Q, "instructions": "Again?"})
    signal = store.first(Signal, ("name", "==", "asked_for_human"))
    answer = Answer(
        run_id="r-1", call_id="c-1", tenant_id=signal.tenant_id, project_id=signal.project_id,
        signal_version_id=f"{signal.id}:2", signal_version=2, tracker_name="experience", signal_name="asked_for_human",
        type="yes_no", value_text="yes", confidence=0.9, needs_review=False,
    )
    store.put(answer)

    assert client.delete("/trackers/experience/signals/asked_for_human", params={"permanent": True}).status_code == 204
    assert store.get(Signal, signal.id) is None
    assert store.find(SignalVersion, ("signal_id", "==", signal.id)) == []
    kept = store.get(Answer, answer.id)
    assert kept.signal_version_id is None and kept.signal_version == 2
    # The name can be used again, starting at version 1.
    assert client.post("/trackers/experience/signals", json=HUMAN_Q).json()["version"] == 1

    assert client.delete("/trackers/experience", params={"permanent": True}).status_code == 204
    assert client.get("/trackers/experience").status_code == 404
    assert store.find(Signal, ("tracker_name", "==", "experience")) == []
    assert store.find(SignalVersion, ("tracker_name", "==", "experience")) == []
    assert store.get(Answer, answer.id) is not None
    assert client.post("/trackers", json={"name": "experience"}).status_code == 201


def test_trackers_are_per_project(client, other_project):
    setup_trackers(client)
    elsewhere = {"X-Project": other_project.id}
    assert client.get("/trackers", headers=elsewhere).json() == []
    assert client.post("/trackers", json={"name": "sales"}, headers=elsewhere).status_code == 201
    assert len(client.get("/trackers").json()) == 2


# ── Import ───────────────────────────────────────────────────────────────────


def test_import_trackers_from_json(client, store):
    raw = SAMPLE_TRACKERS.read_bytes()
    dry = client.post("/trackers/import", params={"dry_run": True}, content=raw)
    assert dry.status_code == 201 and dry.json()["created"] == ["outcome", "compliance", "experience"]
    assert [len(c["signals"]) for c in dry.json()["trackers"]] == [2, 1, 2]
    assert client.get("/trackers").json() == []  # dry run saved nothing
    assert store.find(Signal, ("name", "!=", "")) == []

    r = client.post("/trackers/import", content=raw).json()
    assert (r["created"], r["signals_created"]) == (["outcome", "compliance", "experience"], 5)
    assert r["overlap"] is None and "TYPESAFE_API_KEY" in r["overlap_error"]
    assert names(client.get("/trackers/outcome").json()["signals"]) == ["call_outcome", "decline_reason"]
    assert names(client.get("/trackers").json()) == ["outcome", "compliance", "experience"]

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


def test_import_update_reactivates_a_tracker_and_its_signals(client, store):
    raw = SAMPLE_TRACKERS.read_bytes()
    client.post("/trackers/import", content=raw)
    client.delete("/trackers/outcome")
    assert all(not s.tracker_active for s in store.find(Signal, ("tracker_name", "==", "outcome")))
    client.post("/trackers/import", params={"on_conflict": "update"}, content=raw)
    assert all(s.tracker_active for s in store.find(Signal, ("tracker_name", "==", "outcome")))
    assert client.get("/trackers/outcome").json()["active"] is True


def test_import_is_all_or_nothing_with_every_error_listed(client, store):
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
    assert store.find(Tracker, ("name", "!=", "")) == [] and store.find(Signal, ("name", "!=", "")) == []
    # A branch listed before its gate in the file still works.
    ok = [{**bad[4], "run_if": cond("good", "outcome", "in", ["booked"])}, bad[0]]
    assert client.post("/trackers/import", json=ok).json()["created"] == ["branch", "good"]
    assert client.get("/trackers/branch").json()["run_if"]["tracker"] == "good"
    assert client.post("/trackers/import", content=b"{not json").status_code == 422


def test_failed_update_import_changes_nothing(client):
    setup_trackers(client)
    client.post("/trackers", json={"name": "upsell", "run_if": cond("sales", "outcome", "in", ["booked"])})
    no_booked = {**OUTCOME_Q, "criteria": {"declined": "Said no", "other": "Anything else"}}
    r = client.post("/trackers/import", params={"on_conflict": "update"},
                    json=[{"name": "sales", "description": "changed", "signals": [no_booked]}])
    assert r.status_code == 422 and "this edit would break" in r.text
    sales = client.get("/trackers/sales").json()
    assert sales["description"] is None and sales["signals"][0]["version"] == 1


def test_import_copies_trackers_from_another_project(client, store, tenant, other_project):
    setup_trackers(client)
    client.delete("/trackers/experience/signals/frustration")
    source = store.first(Project, ("tenant_id", "==", tenant.id), ("is_default", "==", True))
    target = {"X-Project": other_project.id}

    r = client.post("/trackers/import", params={"from_project": source.id, "trackers": "experience"}, headers=target)
    assert r.status_code == 201 and r.json()["created"] == ["experience"]
    assert names(client.get("/trackers/experience", headers=target).json()["signals"]) == ["asked_for_human"]
    assert client.post("/trackers/import", params={"from_project": source.id}).status_code == 422
    assert client.post("/trackers/import", params={"from_project": "p-missing"}).status_code == 404


# ── Overlap ──────────────────────────────────────────────────────────────────


def test_overlap_check_colours_overlapping_trackers(client, store, with_engine):
    engine = with_engine(PairEngine({("sales", "retention"), ("retention", "billing")}))
    setup_trackers(client, {"sales": [OUTCOME_Q], "experience": [HUMAN_Q], "retention": [OUTCOME_Q], "billing": [FRUSTRATION_Q]})

    r = client.post("/overlap").json()
    assert r["asked"] == 6 and r["billed"] is False and len(engine.requests) == 1
    cats = r["trackers"]
    assert cats["sales"]["color"] == cats["retention"]["color"] == cats["billing"]["color"] is not None
    assert cats["experience"] == {"group": None, "color": None, "overlaps_with": []}
    assert cats["retention"]["overlaps_with"] == ["sales", "billing"]
    assert {(p["a"], p["b"]) for p in r["pairs"] if p["overlaps"]} == {("retention", "sales"), ("billing", "retention")}
    assert all(set(row.tracker_names) == {row.tracker_a, row.tracker_b} for row in store.find(TrackerOverlap, ("overlaps", "in", [True, False])))

    listed = {c["name"]: c for c in client.get("/trackers").json()}
    assert listed["sales"]["color"] == cats["sales"]["color"] and listed["experience"]["color"] is None

    # Cached: asking again doesn't call Jev.
    assert client.post("/overlap").json()["asked"] == 0 and len(engine.requests) == 1
    # Changing a tracker re-asks only its pairs.
    client.put("/trackers/experience/signals/asked_for_human", json={**HUMAN_Q, "instructions": "Asked for a person?"})
    assert len(client.get("/overlap").json()["unchecked"]) == 3
    assert client.post("/overlap").json()["asked"] == 3
    assert client.post("/overlap", params={"trackers": "sales,nope"}).status_code == 422

    with_engine(None)
    assert client.post("/overlap").status_code == 503


def test_deleting_a_tracker_drops_its_cached_overlaps(client, store, with_engine):
    with_engine(PairEngine(set()))
    setup_trackers(client, {"a": [HUMAN_Q], "b": [HUMAN_Q], "c": [HUMAN_Q]})
    client.post("/overlap")
    assert len(store.find(TrackerOverlap, ("overlaps", "in", [True, False]))) == 3
    client.delete("/trackers/a", params={"permanent": True})
    left = store.find(TrackerOverlap, ("overlaps", "in", [True, False]))
    assert [(r.tracker_a, r.tracker_b) for r in left] == [("b", "c")]


def test_signal_cap_applies_to_overlap_pairs(client, with_engine, monkeypatch):
    from aftercall.config import get_settings

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
