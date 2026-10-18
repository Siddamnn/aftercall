"""Insights over conversations (B6-B12, B36), dashboards, and usage, on the in-memory store.

The data is written straight through the store (what the worker leaves behind: trackers, signals,
done calls with their runs and answers), and the routers are mounted on a small app, so these tests
don't depend on the upload path or on the rest of the API.
"""

import csv
import io
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from aftercall import latest, usage, workspaces
from aftercall.errors import Problem, problem_handler
from aftercall.models import Answer, Call, Run, Signal, SignalVersion, Tenant, Tracker
from aftercall.routes import dashboards, insights, usage as usage_routes
from aftercall.signals import SignalSpec

OUTCOME_Q = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
             "criteria": {"booked": "Booked a slot", "declined": "Said no", "other": "Anything else"}}
HUMAN_Q = {"name": "asked_for_human", "type": "yes_no", "instructions": "Did the caller ask for a human?"}
FRUSTRATION_Q = {"name": "frustration", "type": "score", "instructions": "How frustrated?",
                 "criteria": ["calm", "irritated", "angry"]}
TRACKERS = {"sales": [OUTCOME_Q], "experience": [HUMAN_Q, FRUSTRATION_Q]}

CALLS = [
    {"external_id": "a", "channel": "call", "meta": {"rep": "Meera"}, "agent_version": "v12",
     "day": datetime(2026, 9, 1, 10, tzinfo=UTC), "human": True},
    {"external_id": "b", "channel": "chat", "meta": {"rep": "Arjun"}, "agent_version": "v13",
     "day": datetime(2026, 9, 2, tzinfo=UTC), "human": False},
    {"external_id": "c", "channel": "chat", "meta": {"rep": "Meera"}, "agent_version": "v13",
     "day": datetime(2026, 9, 3, tzinfo=UTC), "human": True},
]


@pytest.fixture
def client(store, tenant):
    app = FastAPI()
    app.add_exception_handler(Problem, problem_handler)
    for area in (insights, dashboards, usage_routes):
        app.include_router(area.router)
    with TestClient(app) as c:
        c.headers["X-API-Key"] = tenant.api_key
        yield c


@pytest.fixture
def project(store, tenant):
    return workspaces.default_project(store, store.get(Tenant, tenant.id))


def add_signals(store, project) -> dict[str, str]:
    """The trackers and signals; returns each signal's id by "tracker.signal"."""
    ids = {}
    for t_seq, (name, specs) in enumerate(TRACKERS.items()):
        tracker = Tracker(tenant_id=project.tenant_id, project_id=project.id, name=name, seq=t_seq)
        store.put(tracker)
        for seq, spec in enumerate(specs):
            signal = Signal(tenant_id=project.tenant_id, project_id=project.id, tracker_id=tracker.id, tracker_name=name,
                            name=spec["name"], tracker_seq=t_seq, seq=seq)
            version = SignalVersion(signal_id=signal.id, version=1, spec=SignalSpec.model_validate(spec).model_dump(mode="json"))
            signal.activate(version)
            store.put_many([signal, version])
            ids[f"{name}.{spec['name']}"] = signal.id
    return ids


def answers_for(call: Call, run: Run, human: bool) -> list[Answer]:
    """What the fake engine answers: sure (0.9) when a human was asked for, unsure (0.55) otherwise."""
    def make(tracker, signal, type_, text, num, confidence, threshold=0.6):
        return Answer.for_call(call, run_id=run.id, tracker_name=tracker, signal_name=signal, signal_version=1, type=type_,
                               value_text=text, value_num=num, confidence=confidence, needs_review=confidence < threshold)
    return [
        make("sales", "outcome", "choice", "booked", None, 0.8),
        make("experience", "asked_for_human", "yes_no", "yes", 0.9 if human else 0.55, 0.9 if human else 0.55),
        make("experience", "frustration", "score", "1", 1.1, 0.5),
    ]


def add_call(store, project, *, external_id, day, human, channel=None, meta=None, agent_version=None, status="done") -> Call:
    call = Call(tenant_id=project.tenant_id, project_id=project.id, external_id=external_id, status=status, occurred_at=day,
                channel=channel, meta=meta or {}, agent_version=agent_version, transcript="caller: hello", transcript_tokens=10,
                trackers=list(TRACKERS), started_at=day.isoformat())
    run = Run(call_id=call.id, tenant_id=project.tenant_id, project_id=project.id, engine="fake", status="done",
              n_requests=1, tokens_input=200, tokens_output=5, created_at=day, model="fake-1")
    rows = answers_for(call, run, human)
    latest.apply(call, run, rows)
    store.put_many([call, run, *rows])
    return call


@pytest.fixture
def analysed(client, store, project):
    add_signals(store, project)
    for row in CALLS:
        add_call(store, project, **row)
    return client


def test_dimensions(analysed):
    dims = analysed.get("/insights/dimensions").json()
    assert dims["channels"] == ["chat", "call"]
    assert dims["metadata"] == {"rep": ["Meera", "Arjun"]}
    assert dims["agents"] == []  # no agent_id in these calls
    assert dims["date_range"] == ["2026-09-01", "2026-09-03"]


def test_calls_that_are_not_done_or_were_deleted_stay_out(analysed, store, project):
    add_call(store, project, external_id="q", day=datetime(2026, 9, 4, tzinfo=UTC), human=True, status="queued")
    gone = add_call(store, project, external_id="d", day=datetime(2026, 9, 4, tzinfo=UTC), human=True)
    store.update(Call, gone.id, deleted=True)
    assert analysed.get("/insights/signals").json()["scope"]["calls"] == 3
    assert analysed.get("/calls").json()["total"] == 3


def test_signal_distributions_and_filters(analysed):
    body = analysed.get("/insights/signals").json()
    assert body["scope"]["calls"] == 3 and body["scope"]["tokens"] == 600 and body["scope"]["cost"] is None
    human = next(s for s in body["signals"] if s["signal"] == "asked_for_human")
    assert human["counts"] == {"yes": 3, "no": 0} and human["answered"] == 3 and human["needs_review"] == 1
    assert sum(human["confidence"]["bins"]) == 3 and human["confidence"]["threshold"] == 0.6
    frustration = next(s for s in body["signals"] if s["signal"] == "frustration")
    assert frustration["counts"]["1"] == 3 and frustration["mean"] == pytest.approx(1.1)
    assert frustration["levels"] == {"0": "calm", "1": "irritated", "2": "angry"}
    assert [s["tracker"] for s in body["signals"]] == ["sales", "experience", "experience"]

    chats = analysed.get("/insights/signals", params={"channel": "chat"}).json()
    assert chats["scope"]["calls"] == 2
    said_no = analysed.get("/insights/signals", params={"where": "experience.asked_for_human:no"}).json()
    assert said_no["scope"]["calls"] == 0
    meera = analysed.get("/insights/signals", params={"meta.rep": "Meera", "from": "2026-09-02", "to": "2026-09-03"}).json()
    assert meera["scope"]["calls"] == 1 and meera["scope"]["calls_previous"] == 1

    assert analysed.get("/insights/signals", params={"where": "nope.nothing:yes"}).status_code == 422
    assert analysed.get("/insights/signals", params={"where": "bad"}).status_code == 422


def test_scope_by_upload_and_agent(analysed, store, project):
    add_call(store, project, external_id="u", day=datetime(2026, 9, 4, tzinfo=UTC), human=True)
    first = store.first(Call, ("external_id", "==", "u"))
    store.update(Call, first.id, upload_id="up-1", agent_id="bot")
    for a in store.find(Answer, ("call_id", "==", first.id)):
        store.update(Answer, a.id, upload_id="up-1", agent_id="bot")
    assert analysed.get("/insights/signals", params={"uploads": "up-1"}).json()["scope"]["calls"] == 1
    assert analysed.get("/insights/signals", params={"agent_id": "bot"}).json()["scope"]["calls"] == 1
    assert analysed.get("/insights/signals", params={"uploads": "up-2"}).json()["scope"]["calls"] == 0


def test_calls_across_uploads(analysed):
    page = analysed.get("/calls", params={"limit": 2}).json()
    assert page["total"] == 3 and len(page["calls"]) == 2 and page["next_cursor"] == "2"
    assert [c["external_id"] for c in page["calls"]] == ["c", "b"]
    rest = analysed.get("/calls", params={"limit": 2, "cursor": "2"}).json()
    assert [c["external_id"] for c in rest["calls"]] == ["a"] and rest["next_cursor"] is None
    assert "transcript" not in page["calls"][0]
    assert page["calls"][0]["answers"]["experience"]["asked_for_human"]["value"] == "yes"

    oldest = analysed.get("/calls", params={"sort": "started_at"}).json()
    assert [c["external_id"] for c in oldest["calls"]] == ["a", "b", "c"]
    review = analysed.get("/calls", params={"needs_review": True}).json()
    assert review["total"] == 3  # the frustration answers are all unsure


def test_series_and_breakdown(analysed):
    series = analysed.get("/insights/series", params={"signal": "experience.asked_for_human", "bucket": "day",
                                                      "from": "2026-09-01", "to": "2026-09-04"}).json()
    assert [p["calls"] for p in series["points"]] == [1, 1, 1, 0]
    assert series["points"][0]["counts"] == {"yes": 1}
    assert {"at": "2026-09-02", "kind": "agent_version", "label": "agent v13"} in series["events"]
    volume = analysed.get("/insights/series", params={"bucket": "week", "from": "2026-09-01", "to": "2026-09-06"}).json()
    assert volume["signal"] is None and [p["calls"] for p in volume["points"]] == [3]

    by_channel = analysed.get("/insights/breakdown", params={"signal": "experience.asked_for_human", "by": "channel"}).json()
    assert by_channel["groups"][0] == {"key": "chat", "answered": 2, "counts": {"yes": 2}, "mean": None}
    by_signal = analysed.get("/insights/breakdown", params={"signal": "experience.frustration", "by": "experience.asked_for_human"}).json()
    assert [g["key"] for g in by_signal["groups"]] == ["yes"] and by_signal["groups"][0]["mean"] == pytest.approx(1.1)
    count_only = analysed.get("/insights/breakdown", params={"by": "meta.rep"}).json()
    assert count_only["groups"][0] == {"key": "Meera", "answered": 2, "counts": {}, "mean": None}


def test_series_marks_a_new_signal_version(analysed, store, project):
    signal = store.first(Signal, ("project_id", "==", project.id), ("name", "==", "asked_for_human"))
    store.put(SignalVersion(signal_id=signal.id, version=2, spec=signal.active_spec, created_at=datetime(2026, 9, 2, 8, tzinfo=UTC)))
    series = analysed.get("/insights/series", params={"signal": "experience.asked_for_human", "from": "2026-09-01", "to": "2026-09-04"}).json()
    assert {"at": "2026-09-02", "kind": "signal_version", "label": "v2"} in series["events"]


def test_movers_need_a_period(analysed):
    assert analysed.get("/insights/movers").status_code == 422
    body = analysed.get("/insights/movers", params={"from": "2026-09-01", "to": "2026-09-03"}).json()
    assert body["previous"] == {"from": "2026-08-29", "to": "2026-08-31"} and body["movers"] == []  # under 30 answers


def test_conversations_csv(analysed):
    res = analysed.get("/calls/export.csv")
    rows = list(csv.DictReader(io.StringIO(res.text.lstrip("﻿"))))
    assert len(rows) == 3 and rows[0]["meta.rep"] and "experience.asked_for_human" in rows[0]
    assert rows[0]["external_id"] == "c"


def test_review_corrections_measure_accuracy(analysed, store):
    call_id = analysed.get("/calls").json()["calls"][0]["call_id"]
    path = f"/calls/{call_id}/answers/experience/asked_for_human/review"
    assert analysed.put(path, json={"value": "maybe"}).status_code == 422
    assert analysed.put("/calls/nope/answers/experience/asked_for_human/review", json={"value": "no"}).status_code == 404
    reviewed = analysed.put(path, json={"value": "no"}).json()
    assert reviewed["review"]["value"] == "no" and reviewed["review"]["agrees"] is False
    human = next(s for s in analysed.get("/insights/signals").json()["signals"] if s["signal"] == "asked_for_human")
    assert human["reviewed"] == 1 and human["accuracy"] == 0.0 and human["accuracy_by_version"] == {"1": 0.0}
    assert "review" not in analysed.delete(path).json()


def test_review_keeps_the_calls_review_count_in_step(analysed, store):
    unsure = store.first(Call, ("external_id", "==", "b"))  # asked_for_human 0.55 and frustration 0.5 await a person
    assert (unsure.needs_review, unsure.needs_review_count) == (True, 2)
    path = f"/calls/{unsure.id}/answers/experience/asked_for_human/review"
    analysed.put(path, json={"value": "yes"})
    assert store.get(Call, unsure.id).needs_review_count == 1
    analysed.put(f"/calls/{unsure.id}/answers/experience/frustration/review", json={"value": "2"})
    after = store.get(Call, unsure.id)
    assert (after.needs_review, after.needs_review_count) == (False, 0)
    analysed.delete(path)
    assert store.get(Call, unsure.id).needs_review_count == 1


# ── Dashboards ───────────────────────────────────────────────────────────────


def test_dashboard_lifecycle(client):
    made = client.post("/dashboards", json={"name": "Weekly review", "widgets": [{"kind": "kpi"}]})
    assert made.status_code == 201 and made.json()["id"] == "weekly-review"
    assert client.post("/dashboards", json={"name": "Weekly review"}).json()["id"] == "weekly-review-2"
    assert client.post("/dashboards", json={"name": "x", "widgets": [{}] * 41}).status_code == 422
    saved = client.put("/dashboards/weekly-review", json={"name": "Daily", "params": "channel=chat"}).json()
    assert saved["name"] == "Daily" and saved["widgets"] == []
    assert [d["id"] for d in client.get("/dashboards").json()] == ["weekly-review", "weekly-review-2"]
    assert client.delete("/dashboards/weekly-review").status_code == 204
    assert client.get("/dashboards/weekly-review").status_code == 404


def test_dashboards_belong_to_their_project(client, store, tenant):
    client.post("/dashboards", json={"name": "Mine"})
    other = workspaces.create(store, "Other Co", None)[0]
    other_project = workspaces.default_project(store, other)
    assert client.get("/dashboards/mine", headers={"X-Project": other_project.id}).status_code == 404


# ── Usage ────────────────────────────────────────────────────────────────────


def test_usage_per_day_is_tokens_only(analysed, store, project):
    day = datetime(2026, 9, 3, 12, tzinfo=UTC)
    store.put(Call(tenant_id=project.tenant_id, project_id=project.id, status="over_limit", transcript="long", transcript_tokens=9000,
                   received_at=day))
    body = analysed.get("/usage", params={"start": "2026-09-02", "end": "2026-09-30"}).json()
    assert [d["date"] for d in body["days"]] == ["2026-09-02", "2026-09-03"]
    assert body["totals"] == {"calls_analyzed": 2, "jev_requests": 2, "billed_input_tokens": 400, "output_tokens": 10,
                              "over_limit_calls": 1, "over_limit_tokens": 9000, "cost": None}
    assert body["pricing"]["price"] is None


def test_usage_per_person_and_allowances(analysed, store, tenant):
    owner = workspaces.owner_of(store, store.get(Tenant, tenant.id))
    usage.record(store, tenant.id, "analysis", user_id=owner.id, project_id=None, tokens=300)
    usage.record(store, tenant.id, "alteria_ask", user_id=owner.id, project_id=None, tokens=50)
    usage.record(store, tenant.id, "analysis", user_id=None, project_id=None, tokens=7)

    mine = analysed.get("/usage/me").json()
    assert mine["workspace"] == {"tokens": 357, "spend": None, "conversations": 2}
    line = mine["members"][0]
    assert line["member"]["id"] == owner.id and line["member"]["role"] == "owner"
    assert (line["tokens"], line["conversations"], line["alteria_questions"], line["spend"]) == (350, 1, 1, None)
    assert line["allowance"]["monthly_usd"] is None and line["allowance"]["used_usd"] == 0

    assert len(analysed.get("/usage/members").json()["members"]) == 1
    saved = analysed.put("/usage/allowances", json={"budget": {"basis": "fixed", "monthly_usd": 100}, "roles": {"member": 0.4}}).json()
    assert saved["budget"] == {"basis": "fixed", "monthly_usd": 100, "effective_usd": None} and saved["roles"]["member"] == 0.4
    assert saved["people"][0]["effective_usd"] is None  # owners are unlimited
    assert analysed.put("/usage/allowances", json={"budget": {"basis": "fixed"}}).status_code == 422
    assert analysed.put("/usage/allowances", json={"overrides": {"u-nobody": 0.5}}).status_code == 422
    assert store.get(Tenant, tenant.id).allowance_policy["basis"] == "fixed"


def test_overview_counts_and_recent(analysed, store, project, tenant):
    analysed.post("/dashboards", json={"name": "Board"})
    owner = workspaces.owner_of(store, store.get(Tenant, tenant.id))
    usage.record(store, tenant.id, "analysis", user_id=owner.id, project_id=project.id, tokens=120)
    body = analysed.get("/account/overview").json()
    assert body["counts"] == {"projects": 1, "trackers": 2, "dashboards": 1, "conversations": 3, "chats": 0, "members": 1}
    assert body["month"] == {"tokens": 120, "spend": None, "conversations": 1}
    assert [r["kind"] for r in body["recent"]] == ["dashboard"]
