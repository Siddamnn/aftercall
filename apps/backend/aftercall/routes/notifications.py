"""The bell (B52): your notifications in this workspace, newest first."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from aftercall import people
from aftercall.deps import MemberDep, StoreDep, Who
from aftercall.models import Notification, User, aware
from aftercall.store import Store

router = APIRouter()
PAGE = 30
IN_LIMIT = 30  # Firestore's cap on an `in` filter


def _mine(who: Who) -> list[tuple[str, str, Any]]:
    return [("tenant_id", "==", who.workspace.id), ("user_id", "==", who.user.id)]


def _unread(store: Store, who: Who) -> int:
    return store.count(Notification, *_mine(who), ("read", "==", False))


def _out(n: Notification, actors: dict[str, User]) -> dict[str, Any]:
    actor = actors.get(n.actor_id or "")
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "href": n.href,
            "actor": people.person_out(actor) if actor else None, "project_id": n.project_id,
            "created_at": n.created_at, "read": n.read}


@router.get("/notifications")
def list_notifications(who: MemberDep, store: StoreDep, unread: bool = False, cursor: str | None = None) -> dict[str, Any]:
    where = _mine(who)
    if unread:
        where.append(("read", "==", False))
    if cursor:
        where.append(("created_at", "<", aware(datetime.fromisoformat(cursor))))
    items = store.find(Notification, *where, order_by="created_at", descending=True, limit=PAGE + 1)
    page = items[:PAGE]
    actors = people.users_by_id(store, [n.actor_id for n in page if n.actor_id])
    return {"items": [_out(n, actors) for n in page], "unread": _unread(store, who),
            "next_cursor": page[-1].created_at.isoformat() if len(items) > PAGE else None}


class ReadIn(BaseModel):
    ids: list[str] | None = Field(default=None, max_length=200)
    all: bool = False


def _to_mark(store: Store, who: Who, body: ReadIn) -> list[Notification]:
    if body.all:
        return store.find(Notification, *_mine(who), ("read", "==", False))
    ids = list(dict.fromkeys(body.ids or []))
    found = [n for start in range(0, len(ids), IN_LIMIT)
             for n in store.find(Notification, *_mine(who), ("id", "in", ids[start:start + IN_LIMIT]))]
    return [n for n in found if not n.read]


@router.post("/notifications/read")
def mark_read(body: ReadIn, who: MemberDep, store: StoreDep) -> dict[str, int]:
    """Marks some read, or all of them. Returns the unread count after."""
    unread = _to_mark(store, who, body)
    for n in unread:
        n.read = True
    store.put_many(unread)
    return {"unread": _unread(store, who)}
