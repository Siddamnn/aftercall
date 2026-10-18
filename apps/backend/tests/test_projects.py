"""Projects (B37), the X-Project header, and (once those routers are ported) trackers and dashboards in them.

The project tests mount only the project routes on a small app; `TestWithTheFullApi` needs `aftercall.api`.
"""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from test_people import app, client, firebase, teammate  # noqa: F401  (fixtures)

from aftercall.deps import ProjectDep
from aftercall.models import (
    Answer,
    Call,
    Dashboard,
    Project,
    Run,
    Signal,
    SignalVersion,
    Thread,
    ThreadMessage,
    ThreadPin,
    Tracker,
    TrackerOverlap,
    Upload,
    utcnow,
)

WIDGETS = [{"id": "w1", "kind": "kpi", "metric": "experience.asked_for_human", "value": "yes", "size": 1}]
SIGNAL = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
          "criteria": {"booked": "Booked a slot", "declined": "Said no", "other": "Anything else"}}


@pytest.fixture
def probe(app: FastAPI) -> FastAPI:  # noqa: F811
    """The project routes plus a route that reports the project `X-Project` picks."""

    @app.get("/which-project")
    def which(project: ProjectDep) -> dict:
        return {"id": project.id}

    return app


def new_project(client, name="Support chats"):
    res = client.post("/projects", json={"name": name, "description": "WhatsApp"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def fill(store, tenant_id: str, project_id: str) -> dict[str, int]:
    """One of everything a project holds; returns how many docs each collection should lose."""
    tracker = Tracker(tenant_id=tenant_id, project_id=project_id, name="sales")
    signal = Signal(tenant_id=tenant_id, project_id=project_id, tracker_id=tracker.id, tracker_name="sales", name="outcome")
    version = SignalVersion(signal_id=signal.id, version=1, spec={})
    call = Call(tenant_id=tenant_id, project_id=project_id, transcript="caller: hi", transcript_tokens=3, status="done",
                external_id="a", channel="voice", meta={"k": "v"}, needs_review=True)
    run = Run(call_id=call.id, tenant_id=tenant_id, project_id=project_id, engine="fake", status="done", error="x",
              conditions={"t": {"met": True}}, tokens_input=100)
    answer = Answer.for_call(call, run_id=run.id, tracker_name="sales", signal_name="outcome", signal_version=1,
                             type="choice", value_text="booked", confidence=0.9, needs_review=False)
    thread = Thread(tenant_id=tenant_id, project_id=project_id, owner_id="u", title="chat")
    store.put_many([
        tracker, signal, version, call, run, answer, thread,
        ThreadMessage(thread_id=thread.id, role="user", text="hi"), ThreadPin(thread_id=thread.id, user_id="u"),
        Dashboard(tenant_id=tenant_id, project_id=project_id, name="Board"),
        Upload(tenant_id=tenant_id, project_id=project_id, filename="a.json"),
        TrackerOverlap(tenant_id=tenant_id, project_id=project_id, tracker_a="a", tracker_b="b", fingerprint_a="1",
                       fingerprint_b="2", overlaps=False, probability=0.1, confidence=0.9),
    ])
    return {"call": call.id, "run": run.id}


def test_requests_without_a_header_use_the_default_project(client, store):
    projects = client.get("/projects").json()
    assert len(projects) == 1 and projects[0]["counts"] == {"trackers": 0, "signals": 0, "conversations": 0, "dashboards": 0}
    assert client.get("/account").json() == {"name": "Test Co", "plan": "payg", "project_limit": None, "projects": 1}


def test_counts_cover_trackers_signals_conversations_and_dashboards(client, store, tenant):
    pid = client.get("/projects").json()[0]["id"]
    fill(store, tenant.id, pid)
    store.put(Call(tenant_id=tenant.id, project_id=pid, transcript="", transcript_tokens=0, status="deleted", deleted=True))
    assert client.get("/projects").json()[0]["counts"] == {"trackers": 1, "signals": 1, "conversations": 1, "dashboards": 1}


def test_the_project_header_picks_a_project(probe, store, tenant):
    c = TestClient(probe, headers={"X-API-Key": tenant.api_key})
    default = c.get("/which-project").json()["id"]
    pid = new_project(c)
    assert c.get("/which-project", headers={"X-Project": pid}).json()["id"] == pid
    assert c.get("/which-project", headers={"X-Project": "nope"}).status_code == 404
    assert c.get("/which-project").json()["id"] == default
    foreign = Project(tenant_id="w-other", name="Foreign")
    store.put(foreign)
    assert c.get("/which-project", headers={"X-Project": foreign.id}).status_code == 404


def test_names_are_unique_per_workspace_ignoring_case(client):
    pid = new_project(client)
    assert pid == "support-chats" and new_project(client, "Support Chats 2") == "support-chats-2"
    clash = client.post("/projects", json={"name": "support CHATS"})
    assert clash.status_code == 409 and "already have a project" in clash.text
    assert client.post("/projects", json={"name": "   "}).status_code == 422
    assert client.put(f"/projects/{pid}", json={"name": "SUPPORT chats", "description": " new "}).json()["description"] == "new"
    other = new_project(client, "Sales")
    assert client.put(f"/projects/{other}", json={"name": "support chats"}).status_code == 409
    assert [p["name"] for p in client.get("/projects").json()] == ["Test Co", "SUPPORT chats", "Support Chats 2", "Sales"]


def test_same_names_in_two_workspaces_are_fine(client, store):
    from aftercall import workspaces

    other, _ = workspaces.create(store, "Other", None)
    store.put(Project(tenant_id=other.id, name="Support chats"))
    assert client.post("/projects", json={"name": "Support chats"}).status_code == 201


def test_deleting_a_project_empties_it(client, store, tenant):
    pid = new_project(client)
    ids = fill(store, tenant.id, pid)
    survivor = fill(store, tenant.id, client.get("/projects").json()[0]["id"])
    assert client.delete(f"/projects/{pid}").status_code == 204

    for model in (Tracker, Signal, Dashboard, Upload, Thread, TrackerOverlap, Answer):
        assert store.count(model, ("project_id", "==", pid)) == 0, model
    assert store.count(ThreadMessage, ("role", "==", "user")) == 1 and store.count(ThreadPin) == 1
    assert store.count(SignalVersion) == 1
    call = store.get(Call, ids["call"])
    assert (call.deleted, call.status, call.transcript, call.meta, call.needs_review, call.external_id) == (True, "deleted", "", {}, False, None)
    run = store.get(Run, ids["run"])
    assert (run.conditions, run.error, run.tokens_input) == ({}, None, 100)  # usage survives, content doesn't
    assert store.get(Call, survivor["call"]).transcript == "caller: hi"
    assert store.get(Project, pid).deleted_at is not None
    assert [p["id"] for p in client.get("/projects").json()] != [] and pid not in [p["id"] for p in client.get("/projects").json()]
    assert client.delete(f"/projects/{pid}").status_code == 404
    assert client.get("/account").json()["projects"] == 1


def test_a_call_being_analysed_blocks_deleting_its_project(client, store, tenant):
    pid = new_project(client)
    fill(store, tenant.id, pid)
    store.update(Call, store.first(Call, ("project_id", "==", pid)).id, status="processing")
    assert client.delete(f"/projects/{pid}").status_code == 409
    assert store.count(Tracker, ("project_id", "==", pid)) == 1  # nothing was touched


def test_the_only_project_cant_be_deleted_and_the_default_moves(client, store):
    only = client.get("/projects").json()[0]["id"]
    assert client.delete(f"/projects/{only}").status_code == 409
    pid = new_project(client)
    assert client.delete(f"/projects/{only}").status_code == 204
    assert store.get(Project, pid).is_default and not store.get(Project, only).is_default
    assert client.delete(f"/projects/{pid}").status_code == 409


def test_members_cant_manage_projects(app, firebase, store, tenant):  # noqa: F811
    member = teammate(app, firebase, store, tenant, "member")
    assert member.post("/projects", json={"name": "Mine"}).status_code == 403
    assert member.get("/projects").status_code == 200


class TestWithTheFullApi:
    """Trackers and dashboards live in other route modules; these run once they import."""

    @pytest.fixture
    def full(self, store, tenant):
        try:
            from aftercall.api import app as full_app
        except ImportError as exc:
            pytest.skip(f"routes not importable yet: {exc}")
        with TestClient(full_app, headers={"X-API-Key": tenant.api_key}) as c:
            yield c

    def test_projects_keep_their_own_trackers(self, full):
        assert full.post("/trackers", json={"name": "sales"}).status_code == 201
        pid = new_project(full)
        other = {"X-Project": pid}
        assert full.get("/trackers", headers=other).json() == []
        assert full.post("/trackers", json={"name": "sales"}, headers=other).status_code == 201  # free in another project
        assert full.get("/trackers", headers={"X-Project": "nope"}).status_code == 404

    def test_copying_trackers_from_another_project(self, full):
        full.post("/trackers", json={"name": "sales"})
        assert full.post("/trackers/sales/signals", json=SIGNAL).status_code == 201
        source = full.get("/projects").json()[0]["id"]
        pid = new_project(full)
        params = {"from_project": source, "trackers": "sales", "dry_run": "true"}
        dry = full.post("/trackers/import", params=params, headers={"X-Project": pid}).json()
        assert dry["created"] == ["sales"] and dry["signals_created"] == 1
        full.post("/trackers/import", params=params | {"dry_run": "false"}, headers={"X-Project": pid})
        copied = full.get("/trackers", headers={"X-Project": pid}).json()
        assert [(t["name"], t["signals"][0]["version"]) for t in copied] == [("sales", 1)]
        assert full.post("/trackers/import", params={"from_project": pid}, headers={"X-Project": pid}).status_code == 422

    def test_dashboards(self, full):
        d = full.post("/dashboards", json={"name": "Weekly overview", "description": None, "params": "range=30", "widgets": WIDGETS}).json()
        assert d["widgets"] == WIDGETS
        again = full.post("/dashboards", json={"name": "Weekly overview"}).json()
        assert again["id"] != d["id"]
        saved = full.put(f"/dashboards/{d['id']}", json={"name": "Renamed", "params": "", "widgets": []}).json()
        assert saved["name"] == "Renamed" and saved["updated_at"] >= d["updated_at"]
        assert {x["id"] for x in full.get("/dashboards").json()} == {d["id"], again["id"]}
        assert full.post("/dashboards", json={"name": "Big", "widgets": WIDGETS * 41}).status_code == 422
        assert full.post("/dashboards", json={"name": ""}).status_code == 422
        assert full.delete(f"/dashboards/{d['id']}").status_code == 204
        assert full.get(f"/dashboards/{d['id']}").status_code == 404
