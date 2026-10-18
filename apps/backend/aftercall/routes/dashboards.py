"""Dashboards (B35): named pages of charts per project. Widgets are stored as given; the UI owns their shape."""

import json
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field
from aftercall.deps import ProjectDep, StoreDep, Who, require
from aftercall.errors import invalid, not_found
from aftercall.models import Dashboard, Project, slugify, utcnow
from aftercall.store import Store

router = APIRouter()
Editor = Annotated[Who, require("dashboards.edit")]
MAX_WIDGETS = 40
MAX_WIDGETS_BYTES = 64 * 1024


class DashboardIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    params: str = ""
    widgets: list[dict[str, Any]] = []


class DashboardOut(DashboardIn):
    id: str
    created_at: datetime
    updated_at: datetime


def _out(d: Dashboard) -> DashboardOut:
    return DashboardOut(id=d.id, name=d.name, description=d.description, params=d.params, widgets=d.widgets,
                        created_at=d.created_at, updated_at=d.updated_at)


def _check(body: DashboardIn) -> None:
    if not body.name.strip():
        raise invalid("A dashboard needs a name")
    if len(body.widgets) > MAX_WIDGETS:
        raise invalid(f"A dashboard holds at most {MAX_WIDGETS} charts")
    if len(json.dumps(body.widgets)) > MAX_WIDGETS_BYTES:
        raise invalid("The dashboard is too big to save; remove some charts")


def get_dashboard_or_404(store: Store, project: Project, dashboard_id: str) -> Dashboard:
    d = store.get(Dashboard, dashboard_id)
    if d is None or d.project_id != project.id:
        raise not_found("Dashboard")
    return d


def _free_id(store: Store, name: str) -> str:
    base = slugify(name, "dashboard")
    candidate, n = base, 2
    while store.get(Dashboard, candidate) is not None:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


@router.get("/dashboards")
def list_dashboards(project: ProjectDep, store: StoreDep) -> list[DashboardOut]:
    rows = store.find(Dashboard, ("project_id", "==", project.id), order_by="updated_at", descending=True)
    return [_out(d) for d in rows]


@router.post("/dashboards", status_code=status.HTTP_201_CREATED)
def create_dashboard(body: DashboardIn, _: Editor, project: ProjectDep, store: StoreDep) -> DashboardOut:
    _check(body)
    d = Dashboard(id=_free_id(store, body.name), tenant_id=project.tenant_id, project_id=project.id,
                  **body.model_dump() | {"name": body.name.strip()})
    store.put(d)
    return _out(d)


@router.get("/dashboards/{dashboard_id}")
def get_dashboard(dashboard_id: str, project: ProjectDep, store: StoreDep) -> DashboardOut:
    return _out(get_dashboard_or_404(store, project, dashboard_id))


@router.put("/dashboards/{dashboard_id}")
def save_dashboard(dashboard_id: str, body: DashboardIn, _: Editor, project: ProjectDep, store: StoreDep) -> DashboardOut:
    """Replaces the whole dashboard."""
    _check(body)
    d = get_dashboard_or_404(store, project, dashboard_id)
    d.name, d.description, d.params, d.widgets = body.name.strip(), body.description, body.params, body.widgets
    d.updated_at = utcnow()
    store.put(d)
    return _out(d)


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: str, _: Editor, project: ProjectDep, store: StoreDep) -> Response:
    store.delete(Dashboard, get_dashboard_or_404(store, project, dashboard_id).id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
