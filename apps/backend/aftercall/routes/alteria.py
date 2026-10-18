"""alteria, the built-in AI: drafts (B38), Ask alteria (B39) and its saved, shareable chats (B41, B43, B44)."""

from collections.abc import Callable
from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from aftercall import alteria, ask, billing, insights, notify, threads, usage, workspaces
from aftercall.config import get_settings
from aftercall.deps import (
    EngineDep,
    LLMDep,
    MemberDep,
    ProjectDep,
    StoreDep,
    Who,
    require,
)
from aftercall.errors import invalid, plan_required, role_required
from aftercall.llm import LLM
from aftercall.models import AlteriaRequest, Project, Signal, Thread, ThreadMessage, Tracker
from aftercall.signals import SignalType
from aftercall.store import Store

router = APIRouter(prefix="/alteria")
Asker = Annotated[Who, require("ask")]
Drafter = Annotated[Who, require("trackers.edit")]
ALTERIA_MAX_BYTES = 5 * 1024 * 1024
MAX_THREADS = 200
SEARCHED_THREADS = 50
NOT_CONFIGURED = "alteria isn't set up on this server yet (Gemini isn't configured: set GEMINI_API_KEY, or GOOGLE_GENAI_USE_VERTEXAI on GCP)"


def _ready(store: Store, who: Who, llm: LLM | None) -> LLM:
    """alteria is configured, and the plan includes it or the free drafts aren't used up."""
    if llm is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED)
    if billing.enabled() and not billing.plans()[billing.account(store, who.workspace.id).plan].alteria:
        tries = get_settings().alteria_trial_requests
        used = store.count(AlteriaRequest, ("tenant_id", "==", who.workspace.id), ("ok", "==", True), ("is_draft", "==", True))
        if used >= tries:
            raise plan_required(f"alteria comes with Pro. You've used your {tries} free alteria drafts; start Pro to keep using it.", "alteria")
    return llm


def _call[T](draft: Callable[[], T]) -> T:
    """Run a draft, turning alteria's failures into responses."""
    try:
        return draft()
    except alteria.InputError as exc:
        raise invalid(str(exc)) from None
    except alteria.AlteriaError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from None


# ── Drafts (B38) ─────────────────────────────────────────────────────────────


class SignalDraftIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    tracker: str
    type: SignalType | None = None


@router.post("/signal", response_model_exclude_none=True)
def draft_signal(body: SignalDraftIn, who: Drafter, project: ProjectDep, store: StoreDep, engine: EngineDep, llm: LLMDep) -> alteria.SignalDraft:
    """Draft one signal from a question. Nothing is saved; the name is unique in the tracker."""
    ready = _ready(store, who, llm)
    tracker = store.first(Tracker, ("project_id", "==", project.id), ("name", "==", body.tracker))
    existing = [q.name for q in store.find(Signal, ("tracker_id", "==", tracker.id))] if tracker else []
    return _call(lambda: alteria.draft_signal(store, project.tenant_id, ready, engine, body.text, body.tracker, body.type, existing))


class TrackersDraftIn(BaseModel):
    goal: str = Field(min_length=1, max_length=1000)
    existing: list[str] = []


@router.post("/trackers", response_model_exclude_none=True)
def draft_trackers(body: TrackersDraftIn, who: Drafter, project: ProjectDep, store: StoreDep, engine: EngineDep, llm: LLMDep) -> alteria.TrackersDraft:
    """Draft 1-4 trackers for a goal, in the import format. Nothing is saved; names don't clash
    with the project's trackers or `existing`."""
    ready = _ready(store, who, llm)
    names = set(body.existing) | {t.name for t in store.find(Tracker, ("project_id", "==", project.id))}
    return _call(lambda: alteria.draft_trackers(store, project.tenant_id, ready, engine, body.goal, sorted(names)))


@router.post("/conversations", response_model_exclude_none=True)
async def convert_conversations(
    who: Annotated[Who, require("analyse")], store: StoreDep, engine: EngineDep, llm: LLMDep,
    text: Annotated[str | None, Form()] = None, file: Annotated[UploadFile | None, File()] = None,
) -> alteria.ConversationsDraft:
    """Turn raw transcripts (pasted `text`, or a .txt, .md, .csv, .json or .jsonl `file`) into
    conversations in the upload format, never changing what was said. Nothing is stored. Input
    that's already a valid upload comes back unchanged without using alteria."""
    if file is not None:
        raw, filename = await file.read(), file.filename or ""
    elif text is not None:
        raw, filename = text.encode(), ""
    else:
        raise invalid('Send "text" or a "file"')
    if len(raw) > ALTERIA_MAX_BYTES:
        raise invalid("alteria takes files up to 5 MB")
    if (same := alteria.as_upload(filename, raw)) is not None:
        return same
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise invalid("The file must be UTF-8 text") from None
    ready = _ready(store, who, llm)
    return await run_in_threadpool(_call, lambda: alteria.convert_conversations(store, who.workspace.id, ready, engine, decoded))


# ── Ask alteria (B39) ────────────────────────────────────────────────────────


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    scope: dict[str, Any] = {}
    thread_id: str | None = None
    draft: dict[str, Any] | None = None


def _spend_trial(store: Store, who: Who) -> None:
    """Pay as you go gets a few free questions, counted here so they can't be reset (B49)."""
    acc = billing.account(store, who.workspace.id)
    if not billing.enabled() or acc.plan == "pro":
        return
    free = get_settings().ask_trial_questions
    if usage.count(store, who.workspace.id, "alteria_ask") >= free:
        raise plan_required(f"You've used your {free} free questions. Ask alteria is part of Pro.", "ask")


@router.post("/ask")
def ask_alteria(body: AskIn, who: Asker, project: ProjectDep, store: StoreDep, engine: EngineDep, llm: LLMDep) -> dict[str, Any]:
    """Answers from every conversation in the project, with the conversations it used. The chat is
    kept: no thread_id starts a new one."""
    if llm is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NOT_CONFIGURED)
    t = threads.get(store, project, who, body.thread_id) if body.thread_id else None
    if t is not None:
        threads.only_owner(t, who, "ask in")
    _spend_trial(store, who)
    scope = insights.scope_from_dict(body.scope)
    t = t or threads.new(store, project, who.user, ask.title_for(body.question))
    if body.draft is not None:
        threads.change(store, t, draft=body.draft)
    history = threads.history(store, t)
    question = threads.add_message(store, t, "user", body.question, body.scope)
    asked = ask.Asked(store, project, llm, engine, scope)
    try:
        answer, title = ask.answer(asked, body.question, history, t.draft)
    except alteria.AlteriaError as exc:
        store.update(ThreadMessage, question.id, error=str(exc))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from None
    if t.message_count == 1 and not t.title_by_user:
        threads.change(store, t, title=title)
    if answer.get("dashboard"):
        threads.change(store, t, draft=answer["dashboard"])
    reply = threads.add_message(store, t, "alteria", answer["text"], body.scope, answer=answer)
    usage.record(store, who.workspace.id, "alteria_ask", user_id=who.user.id, project_id=project.id, ref=t.id)
    return answer | {"thread_id": t.id, "message_id": reply.id, "title": t.title}


# ── Saved chats (B41, B43, B44) ─────────────────────────────────────────────


def _mentions(store: Store, t: Thread, needle: str) -> bool:
    return needle in t.title.lower() or any(needle in m.text.lower() for m in threads.messages(store, t))


def _search(store: Store, found: list[Thread], q: str) -> list[Thread]:
    """Chats whose title or messages contain `q`. Firestore has no text search, so the newest
    SEARCHED_THREADS are read and matched here; older ones match on their title only."""
    needle = q.strip().lower()
    recent, older = found[:SEARCHED_THREADS], found[SEARCHED_THREADS:]
    return [t for t in recent if _mentions(store, t, needle)] + [t for t in older if needle in t.title.lower()]


@router.get("/threads")
def list_threads(
    who: MemberDep, project: ProjectDep, store: StoreDep,
    q: str | None = None, limit: Annotated[int, Query(ge=1, le=MAX_THREADS)] = 50, before: str | None = None,
) -> dict[str, Any]:
    """Your chats and the project's shared ones: pinned first, then the newest. `q` searches
    titles and messages; `before` is the `next` of the previous page."""
    found = threads.visible_threads(store, project, who)
    if q and q.strip():
        found = _search(store, found, q)
    rows = [threads.summary(store, t, who) for t in found]
    rows.sort(key=lambda s: (not s["pinned"], -s["updated_at"].timestamp()))
    at = int(before) if before and before.isdigit() else 0
    return {"threads": rows[at:at + limit], "next": str(at + limit) if at + limit < len(rows) else None}


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, who: MemberDep, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    return threads.full(store, threads.get(store, project, who, thread_id), who)


class ThreadPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    pinned: bool | None = None
    draft: dict[str, Any] | None = None
    saved_dashboard_id: str | None = None


@router.patch("/threads/{thread_id}")
def update_thread(thread_id: str, body: ThreadPatch, who: MemberDep, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """Rename, pin, or keep the dashboard draft. Pins are yours; the rest only the owner changes."""
    t = threads.get(store, project, who, thread_id)
    changes = body.model_fields_set
    if changes & {"title", "draft", "saved_dashboard_id"}:
        threads.only_owner(t, who, "change")
    fields: dict[str, Any] = {k: getattr(body, k) for k in ("draft", "saved_dashboard_id") if k in changes}
    if body.title is not None:
        fields |= {"title": body.title.strip(), "title_by_user": True}
    if fields:
        threads.change(store, t, **fields)
    if body.pinned is not None:
        threads.set_pinned(store, t, who, body.pinned)
    return threads.summary(store, t, who)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(thread_id: str, who: MemberDep, project: ProjectDep, store: StoreDep) -> Response:
    """Deletes it with its messages; a shared chat goes for everyone, and copies stay."""
    t = threads.get(store, project, who, thread_id)
    if why := threads.delete_refusal(t, who):
        raise role_required(why)
    threads.remove(store, t)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _share(store: Store, t: Thread, who: Who) -> None:
    if t.shared:
        return
    threads.share(store, t)
    team = [m.user_id for m in workspaces.members_of(store, who.workspace.id)]
    notify.send(store, who.workspace.id, "chat_shared", f"{who.user.name or 'A teammate'} shared a chat with the team",
                team, body=f"“{t.title}”", href=f"/ask/{t.id}", actor_id=who.user.id, project_id=t.project_id)


@router.post("/threads/{thread_id}/share")
def share_thread(thread_id: str, who: MemberDep, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """Shares the chat with the whole project team. It can't be undone; sharing again changes nothing."""
    t = threads.get(store, project, who, thread_id)
    if not t.shared:
        if why := threads.share_refusal(t, who):
            raise role_required(why)
        threads.require_sharing(store, who)
        _share(store, t, who)
    return threads.summary(store, t, who)


@router.post("/threads/{thread_id}/copy")
def copy_thread(thread_id: str, who: MemberDep, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """A private copy with every message so far and the dashboard draft."""
    t = threads.copy(store, threads.get(store, project, who, thread_id), who)
    return threads.summary(store, t, who)


class BulkIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=MAX_THREADS)
    action: Literal["delete", "pin", "unpin", "share"]


def _bulk_one(store: Store, project: Project, who: Who, thread_id: str, action: str) -> str | None:
    """Does one; returns why it couldn't, for the customer."""
    t = store.get(Thread, thread_id)
    if t is None or t.project_id != project.id or not threads.visible(t, who):
        return "Chat not found"
    if action == "delete":
        if why := threads.delete_refusal(t, who):
            return why
        threads.remove(store, t)
    elif action == "share":
        if not t.shared and (why := threads.share_refusal(t, who)):
            return why
        _share(store, t, who)
    else:
        threads.set_pinned(store, t, who, action == "pin")
    return None


@router.post("/threads/bulk")
def bulk_threads(body: BulkIn, who: MemberDep, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """One action on many chats. One refused chat never fails the rest."""
    if body.action == "share":
        threads.require_sharing(store, who)
    done, failed = [], []
    for thread_id in dict.fromkeys(body.ids):
        why = _bulk_one(store, project, who, thread_id, body.action)
        if why:
            failed.append({"id": thread_id, "detail": why})
        else:
            done.append(thread_id)
    return {"done": done, "failed": failed}
