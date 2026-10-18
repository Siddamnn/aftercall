"""Projects (B37): separate spaces per use case, and the workspace's account summary."""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from aftercall import billing
from aftercall.deps import MemberDep, StoreDep, Who, require
from aftercall.errors import invalid, not_found
from aftercall.models import (
    Call,
    Dashboard,
    Project,
    Signal,
    Thread,
    ThreadMessage,
    ThreadPin,
    Tracker,
    TrackerOverlap,
    Upload,
    slugify,
    utcnow,
)
from aftercall.routes.trackers import remove_tracker
from aftercall.routes.uploads import erase_calls
from aftercall.store import Store

router = APIRouter()
Manager = Annotated[Who, require("projects.manage")]


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    counts: dict[str, int]


def _live(store: Store, tenant_id: str) -> list[Project]:
    """The workspace's projects that aren't deleted, oldest first (sorted here: no index needed)."""
    found = store.find(Project, ("tenant_id", "==", tenant_id), ("deleted_at", "==", None))
    return sorted(found, key=lambda p: p.created_at)


def _out(store: Store, p: Project) -> ProjectOut:
    in_project = ("project_id", "==", p.id)
    return ProjectOut(id=p.id, name=p.name, description=p.description, created_at=p.created_at, counts={
        "trackers": store.count(Tracker, in_project),
        "signals": store.count(Signal, in_project),
        "conversations": store.count(Call, in_project, ("deleted", "==", False)),
        "dashboards": store.count(Dashboard, in_project),
    })


@router.get("/account")
def account(who: MemberDep, store: StoreDep) -> dict[str, Any]:
    acc = billing.account(store, who.workspace.id)
    return {"name": who.workspace.name, "plan": acc.plan, "project_limit": billing.limits(acc, 0)["projects"],
            "projects": len(_live(store, who.workspace.id))}


@router.get("/projects")
def list_projects(who: MemberDep, store: StoreDep) -> list[ProjectOut]:
    """Oldest first."""
    return [_out(store, p) for p in _live(store, who.workspace.id)]


def _check_name(store: Store, tenant_id: str, name: str, project_id: str | None = None) -> str:
    name = name.strip()
    if not name:
        raise invalid("A project needs a name")
    if any(p.name_lower == name.lower() and p.id != project_id for p in _live(store, tenant_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, {"errors": [f"You already have a project called {name}"]})
    return name


def _free_id(store: Store, name: str) -> str:
    base = slugify(name, "project")
    candidate, n = base, 2
    while store.get(Project, candidate) is not None:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectIn, who: Manager, store: StoreDep) -> ProjectOut:
    name = _check_name(store, who.workspace.id, body.name)
    p = Project(id=_free_id(store, name), tenant_id=who.workspace.id, name=name, description=(body.description or "").strip() or None)
    store.put(p)
    return _out(store, p)


def _get(store: Store, who: Who, project_id: str) -> Project:
    p = store.get(Project, project_id)
    if p is None or p.tenant_id != who.workspace.id or p.deleted_at is not None:
        raise not_found("Project")
    return p


@router.put("/projects/{project_id}")
def update_project(project_id: str, body: ProjectIn, who: Manager, store: StoreDep) -> ProjectOut:
    p = _get(store, who, project_id)
    p.name = _check_name(store, who.workspace.id, body.name, p.id)
    p.description = (body.description or "").strip() or None
    p.name_lower = p.name.lower()
    store.put(p)
    return _out(store, p)


def _erase_conversations(store: Store, project_id: str) -> None:
    erase_calls(store, store.find(Call, ("project_id", "==", project_id), ("deleted", "==", False)))


def _remove_trackers(store: Store, project_id: str) -> None:
    for t in store.find(Tracker, ("project_id", "==", project_id)):
        remove_tracker(store, t)
    store.delete_where(TrackerOverlap, ("project_id", "==", project_id))


def _remove_threads(store: Store, project_id: str) -> None:
    for t in store.find(Thread, ("project_id", "==", project_id)):
        store.delete_where(ThreadMessage, ("thread_id", "==", t.id))
        store.delete_where(ThreadPin, ("thread_id", "==", t.id))
    store.delete_where(Thread, ("project_id", "==", project_id))


def _empty(store: Store, p: Project) -> None:
    """Everything in the project, for good. Not atomic: a failure part-way is finished by deleting again."""
    _erase_conversations(store, p.id)
    _remove_trackers(store, p.id)
    _remove_threads(store, p.id)
    store.delete_where(Dashboard, ("project_id", "==", p.id))
    store.delete_where(Upload, ("project_id", "==", p.id))


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, who: Manager, store: StoreDep) -> Response:
    """Deletes the project and everything in it. 409 for the workspace's only project."""
    p = _get(store, who, project_id)
    others = [o for o in _live(store, who.workspace.id) if o.id != p.id]
    if not others:
        raise HTTPException(status.HTTP_409_CONFLICT, "This is your only project. Create another before deleting it.")
    _empty(store, p)
    store.update(Project, p.id, deleted_at=utcnow(), is_default=False)
    if p.is_default:
        store.update(Project, others[0].id, is_default=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
