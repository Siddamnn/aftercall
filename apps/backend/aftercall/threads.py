"""Saved Ask alteria chats (B41) and sharing them with the project (B43).

A chat is private to whoever started it until they share it with the project; sharing can't be
undone. Only the owner asks in, renames or changes the draft of a chat. Pins are per person.

The chat list reads only thread docs: `shared`, `pinned_by`, `message_count`, `last_question` and the
owner's name are copied onto the Thread and kept in step by the functions here (`add_message`,
`set_pinned`, `share`). Everything is written with partial updates so a rename never undoes a new message.
"""

from typing import Any

from aftercall import billing, people, permissions
from aftercall.deps import Who
from aftercall.errors import not_found, plan_required, role_required
from aftercall.models import Project, Thread, ThreadMessage, User, utcnow
from aftercall.store import Store

PREVIEW_CHARS = 120
PRO_SHARE = "Sharing chats with your team is part of Pro."
LIST_LIMIT = 500


def visible(t: Thread, who: Who) -> bool:
    return t.owner_id == who.user.id or t.shared


def get(store: Store, project: Project, who: Who, thread_id: str) -> Thread:
    t = store.get(Thread, thread_id)
    if t is None or t.project_id != project.id or not visible(t, who):
        raise not_found("Chat")
    return t


def visible_threads(store: Store, project: Project, who: Who) -> list[Thread]:
    """Your chats and the project's shared ones, newest first (two queries: Firestore has no OR across fields)."""
    in_project = ("project_id", "==", project.id)
    mine = store.find(Thread, in_project, ("owner_id", "==", who.user.id), order_by="updated_at", descending=True, limit=LIST_LIMIT)
    shared = store.find(Thread, in_project, ("shared", "==", True), order_by="updated_at", descending=True, limit=LIST_LIMIT)
    return sorted({t.id: t for t in (*mine, *shared)}.values(), key=lambda t: t.updated_at, reverse=True)


def change(store: Store, t: Thread, **fields: Any) -> None:
    """Set fields on the chat, in memory and in the store."""
    for name, value in fields.items():
        setattr(t, name, value)
    store.update(Thread, t.id, **fields)


def messages(store: Store, t: Thread) -> list[ThreadMessage]:
    """A chat's messages in the order they were sent (sorted here: a chat is small, so no index)."""
    return sorted(store.find(ThreadMessage, ("thread_id", "==", t.id)), key=lambda m: (m.seq, m.created_at))


def history(store: Store, t: Thread) -> list[tuple[str, str]]:
    return [(m.role, m.text) for m in messages(store, t) if not m.error]


def add_message(store: Store, t: Thread, role: str, text: str, scope: dict[str, Any], answer: dict[str, Any] | None = None) -> ThreadMessage:
    """Append a message and keep the chat's count, preview and update time in step."""
    message = ThreadMessage(thread_id=t.id, role=role, seq=t.message_count, text=text, answer=answer, scope=scope)
    store.put(message)
    question = {"last_question": text[:PREVIEW_CHARS]} if role == "user" else {}
    change(store, t, message_count=t.message_count + 1, updated_at=utcnow(), **question)
    return message


def pinned(t: Thread, who: Who) -> bool:
    return who.user.id in t.pinned_by


def set_pinned(store: Store, t: Thread, who: Who, pin: bool) -> None:
    if pin == pinned(t, who):
        return
    others = [uid for uid in t.pinned_by if uid != who.user.id]
    change(store, t, pinned_by=[*others, who.user.id] if pin else others)


def share(store: Store, t: Thread) -> None:
    change(store, t, shared=True, shared_at=utcnow())


def summary(store: Store, t: Thread, who: Who) -> dict[str, Any]:
    copied = t.copied_from
    by = store.get(User, copied["by"]) if copied else None
    return {
        "id": t.id, "title": t.title, "pinned": pinned(t, who), "created_at": t.created_at,
        "updated_at": t.updated_at, "message_count": t.message_count, "preview": t.last_question or None,
        "owner": {"id": t.owner_id, "name": t.owner_name, "avatar_url": t.owner_avatar_url},
        "mine": t.owner_id == who.user.id, "shared_at": t.shared_at,
        "copied_from": {"id": copied["id"], "title": copied["title"], "by": people.person_out(by)} if copied and by else None,
    }


def message_out(m: ThreadMessage) -> dict[str, Any]:
    out = {"id": m.id, "role": m.role, "text": m.text, "scope": m.scope, "created_at": m.created_at}
    return out | {k: v for k, v in (("answer", m.answer), ("error", m.error)) if v is not None}


def full(store: Store, t: Thread, who: Who) -> dict[str, Any]:
    return summary(store, t, who) | {"messages": [message_out(m) for m in messages(store, t)], "draft": t.draft,
                                      "saved_dashboard_id": t.saved_dashboard_id}


def only_owner(t: Thread, who: Who, action: str) -> None:
    if t.owner_id != who.user.id:
        raise role_required(f"Only {t.owner_name or 'its owner'} can {action} this chat. Continue in a copy to ask more.")


def delete_refusal(t: Thread, who: Who) -> str | None:
    """Your own private chat, or any chat for owners and admins: a shared chat belongs to the team."""
    if permissions.is_admin(who.role or ""):
        return None
    if t.owner_id != who.user.id:
        return f"Only {t.owner_name or 'its owner'} or an admin can delete this chat."
    if t.shared:
        return "This chat is shared with the team, so only an admin can delete it."
    return None


def share_refusal(t: Thread, who: Who) -> str | None:
    if t.owner_id != who.user.id:
        return f"Only {t.owner_name or 'its owner'} can share this chat."
    if who.role == "viewer":
        return "Viewers can't share chats."
    return None


def require_sharing(store: Store, who: Who) -> None:
    if not billing.features(billing.account(store, who.workspace.id))["share_chats"]:
        raise plan_required(PRO_SHARE, "share_chats")


def new(store: Store, project: Project, owner: User, title: str) -> Thread:
    t = Thread(tenant_id=project.tenant_id, project_id=project.id, owner_id=owner.id, title=title,
               owner_name=owner.name, owner_avatar_url=owner.avatar_url)
    store.put(t)
    return t


def copy(store: Store, source: Thread, who: Who) -> Thread:
    project = store.get(Project, source.project_id)
    t = new(store, project, who.user, source.title)
    originals = messages(store, source)
    copies = [ThreadMessage(thread_id=t.id, role=m.role, seq=i, text=m.text, answer=m.answer, error=m.error,
                            scope=m.scope, created_at=m.created_at) for i, m in enumerate(originals)]
    store.put_many(copies)
    questions = [m.text for m in originals if m.role == "user"]
    change(store, t, draft=source.draft, copied_from={"id": source.id, "title": source.title, "by": source.owner_id},
           message_count=len(copies), last_question=questions[-1][:PREVIEW_CHARS] if questions else "")
    return t


def remove(store: Store, t: Thread) -> None:
    store.delete_where(ThreadMessage, ("thread_id", "==", t.id))
    store.delete(Thread, t.id)
