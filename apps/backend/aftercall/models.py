"""Every record aftercall keeps: pydantic `Doc`s, one Firestore collection each (see store.py).

All ids are strings. Random ones are `<prefix>-<12 hex>` (`new_id`). Records that were keyed by a
composite or unique key get a deterministic id built from it, so a write is idempotent and a lookup
is a plain `store.get`; they compute it themselves when you leave `id` out:

    Member(tenant_id=t, user_id=u, role="admin").id        == "<t>:<u>"
    SignalVersion(signal_id=s, version=3, ...).id          == "<s>:3"
    Answer(run_id=r, tracker_name="a", signal_name="b").id == "<r>:a:b"

There are no relationships: a record keeps the ids it points at, and what a page reads together
is copied onto the record it filters on (documented per class, and in docs/google-cup/models.md).
Money is gone (billing is off), so there are no accounts, ledgers, invoices or discounts.
"""

import re
import secrets
from datetime import UTC, datetime
from typing import Any, ClassVar

from pydantic import BaseModel, Field, model_validator

from aftercall.store import Doc


def utcnow() -> datetime:
    return datetime.now(UTC)


def aware(dt: datetime) -> datetime:
    """A datetime without a timezone is UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(6)}"


def slugify(text: str, fallback: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40].strip("-") or fallback


def _new(prefix: str) -> Any:
    """A field default: a fresh id with this prefix."""
    return Field(default_factory=lambda: new_id(prefix))


def _now() -> Any:
    return Field(default_factory=utcnow)


class Keyed(Doc):
    """A Doc whose id is its key fields joined with ":" (names are `[a-z0-9_]`, ids have no ":")."""

    id: str = ""
    key_fields: ClassVar[tuple[str, ...]]

    @classmethod
    def make_id(cls, *parts: object) -> str:
        return ":".join(str(p) for p in parts)

    @model_validator(mode="before")
    @classmethod
    def _derive_id(cls, data: Any) -> Any:
        if isinstance(data, dict) and not data.get("id"):
            return {**data, "id": cls.make_id(*(data[f] for f in cls.key_fields))}
        return data


# ── Workspaces and people ────────────────────────────────────────────────────


class Tenant(Doc):
    """A workspace: one company or team, with its people and projects. Id: `w-…`."""

    collection: ClassVar[str] = "tenants"

    id: str = _new("w")
    name: str
    # SHA-256 of the workspace's API key; the key itself is shown once, when it's made.
    api_key_hash: str | None = None
    slug: str
    logo_url: str | None = None
    allowed_domains: list[str] = Field(default_factory=list)
    join_by_domain: bool = False
    default_role: str = "member"
    # The workspace's own display currency; null follows the visitor's country.
    currency: str | None = None
    # {basis, monthly_usd, roles: {member, viewer}, overrides: {user_id: share}}; stored, not enforced (billing is off).
    allowance_policy: dict[str, Any] | None = None
    created_at: datetime = _now()


class User(Doc):
    """A person. Signs in with Firebase (Google); the same person can belong to several workspaces.

    A person who signed in with Firebase has id `u-<firebase uid>`, so a first sign-in is one idempotent
    write. People made another way (the CLI's owner, API-key workspaces) get a random `u-…`."""

    collection: ClassVar[str] = "users"

    id: str = _new("u")
    name: str = ""
    email: str | None = None
    email_verified: bool = False
    avatar_url: str | None = None
    firebase_uid: str | None = None
    google: bool = False
    # {low_balance, weekly_digest, shared_chats, run_finished}
    notifications: dict[str, bool] = Field(default_factory=dict)
    created_at: datetime = _now()


class Member(Keyed):
    """A person in a workspace. Id: `<tenant_id>:<user_id>`."""

    collection: ClassVar[str] = "members"
    key_fields: ClassVar[tuple[str, ...]] = ("tenant_id", "user_id")

    tenant_id: str
    user_id: str
    role: str  # owner | admin | member | viewer
    joined_at: datetime = _now()
    last_active_at: datetime | None = None


class Invite(Doc):
    collection: ClassVar[str] = "invites"

    id: str = _new("i")
    tenant_id: str
    email: str
    role: str
    invited_by: str
    # The secret in the invite link; look an invite up by it with find(Invite, ("token", "==", t)).
    token: str
    created_at: datetime = _now()
    expires_at: datetime


class Project(Doc):
    """A separate space per use case: its own trackers, conversations, insights, dashboards and chats."""

    collection: ClassVar[str] = "projects"

    id: str = _new("p")
    tenant_id: str
    name: str
    # Lower-cased name, for the duplicate-name check (Firestore has no case-insensitive match).
    name_lower: str = ""
    description: str | None = None
    is_default: bool = False
    # Deleted projects keep their record so deleted calls still point somewhere; usage stays counted.
    deleted_at: datetime | None = None
    # Changes whenever the project's conversations or their answers do (a call finishes, a review, a
    # delete, a tracker or signal edit): insights caches its scoped lists per version. See data_version.py.
    data_version: int = 0
    created_at: datetime = _now()

    @model_validator(mode="after")
    def _lower_name(self) -> "Project":
        self.name_lower = self.name.lower()
        return self


# ── Trackers and signals ─────────────────────────────────────────────────────


class Tracker(Doc):
    """A parent group of signals (e.g. outcome, compliance). Uploads choose which trackers run.
    Names are unique per project and never change; check with first(Tracker, project_id, name)."""

    collection: ClassVar[str] = "trackers"

    id: str = _new("t")
    tenant_id: str
    project_id: str
    name: str
    description: str | None = None
    is_active: bool = True
    # Condition (signals.Condition) on another tracker's answer; the tracker runs only when it holds.
    run_if: dict[str, Any] | None = None
    # run_if's tracker and signal, so "who depends on this tracker" is a query.
    condition_tracker: str | None = None
    condition_signal: str | None = None
    # Creation order within the project (orders lists; ids are random).
    seq: int = 0
    created_at: datetime = _now()


class Signal(Doc):
    """One question in a tracker. Names are unique per tracker and never change.

    Copied from the tracker: `project_id`, `tracker_name`. Copied from the active version:
    `active_version` and `active_spec`, so a project's runnable signals are one query
    (find(Signal, project_id ==, is_active ==)) with no per-signal version reads. Set them with `activate`."""

    collection: ClassVar[str] = "signals"

    id: str = _new("s")
    tenant_id: str
    project_id: str
    tracker_id: str
    tracker_name: str
    name: str
    is_active: bool = True
    # Copied from the tracker, so the runnable signals are one query; update on tracker toggle.
    tracker_active: bool = True
    tracker_seq: int = 0
    # Creation order within the tracker.
    seq: int = 0
    active_version_id: str | None = None
    active_version: int | None = None
    active_spec: dict[str, Any] | None = None
    created_at: datetime = _now()

    def activate(self, version: "SignalVersion") -> None:
        self.active_version_id, self.active_version, self.active_spec = version.id, version.version, version.spec


class SignalVersion(Keyed):
    """Immutable once created; editing a signal adds a new version. Id: `<signal_id>:<version>`."""

    collection: ClassVar[str] = "signal_versions"
    key_fields: ClassVar[tuple[str, ...]] = ("signal_id", "version")

    signal_id: str
    version: int
    # The same number, for display; filled from `version`.
    version_number: int = 0
    tenant_id: str | None = None
    project_id: str | None = None
    tracker_name: str | None = None
    signal_name: str | None = None
    spec: dict[str, Any]
    created_at: datetime = _now()

    @model_validator(mode="after")
    def _number(self) -> "SignalVersion":
        self.version_number = self.version
        return self


# ── Uploads, calls and results ───────────────────────────────────────────────


class Upload(Doc):
    collection: ClassVar[str] = "uploads"

    id: str = _new("up")
    tenant_id: str
    project_id: str
    created_by: str | None = None
    filename: str
    # Tracker names chosen for this upload.
    trackers: list[str] = Field(default_factory=list)
    # Set once every call has run and the uploader has been told (notifications).
    finished_at: datetime | None = None
    # Calls per status ({queued, processing, done, failed, over_limit}); the worker keeps it in step.
    counts: dict[str, int] = Field(default_factory=dict)
    created_at: datetime = _now()


class AnswerView(BaseModel):
    """What a signal answered, and what a person said about it. The value fields of `Answer`, and the
    shape of each entry in `Call.latest_answers` (which insights, results and Ask alteria read)."""

    tracker_name: str
    signal_name: str
    # The signal's version number when it answered (not the SignalVersion id).
    signal_version: int
    type: str
    value_text: str
    value_num: float | None = None
    probabilities: dict[str, float] = Field(default_factory=dict)
    confidence: float
    needs_review: bool
    # A person's correction: the right answer, who gave it and when.
    review_value: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None

    @property
    def ref(self) -> str:
        return f"{self.tracker_name}.{self.signal_name}"

    @property
    def awaits_review(self) -> bool:
        return self.needs_review and self.review_value is None


class RunSummary(BaseModel):
    """The parts of a call's latest run that results and insights read; copied to `Call.latest_run`."""

    status: str
    model: str | None = None
    n_requests: int = 0
    tokens_input: int = 0
    tokens_output: int = 0
    # Per conditional tracker, as on Run.conditions.
    conditions: dict[str, Any] = Field(default_factory=dict)


class Call(Doc):
    """One conversation. `status` doubles as the job queue: queued -> processing -> done | failed; or over_limit.
    The worker takes a call with `store.claim(Call, id, {"status": "queued"}, {"status": "processing"})`.

    Unique per (project_id, source, external_id): look it up before inserting (ids can hold "/", so
    that key isn't the doc id). `updated_at` is yours to set; nothing does it on write.

    Audio uploads keep the recording in `audio_uri` (gs:// or a local path) and the text Gemini
    transcribed in `transcript` (speaker-labelled turns, one per line).
    The `latest_run_id` is the run whose answers count; its answers are copied onto Answer docs, and
    onto the call itself (`latest_answers`, `latest_run`) so insights and results read calls alone."""

    collection: ClassVar[str] = "calls"

    id: str = _new("c")
    tenant_id: str
    project_id: str
    upload_id: str | None = None
    created_by: str | None = None
    source: str = "upload"
    external_id: str | None = None
    agent_id: str | None = None
    agent_version: str | None = None
    started_at: str | None = None
    # started_at parsed, else received_at: what date filters and trend buckets use.
    occurred_at: datetime = _now()
    channel: str | None = None
    meta: dict[str, str] = Field(default_factory=dict)
    # Empty in the transcript-less reads insights and results make (results.find_calls).
    transcript: str = ""
    transcript_tokens: int = 0
    audio_uri: str | None = None
    audio_content_type: str | None = None
    language: str | None = None
    duration_seconds: float | None = None
    # Trackers to run on this call; the worker sends their active signals when it runs.
    trackers: list[str] = Field(default_factory=list)
    # Estimate made at upload, for the signals active then. Null for over_limit calls.
    # With conditional trackers it's the most the call can use (every condition holding).
    estimated_requests: int | None = None
    estimated_tokens: int | None = None
    # The same plan without the token budget; more requests than this means the call is "large".
    estimated_unsplit_requests: int | None = None
    estimated_unsplit_tokens: int | None = None
    latest_run_id: str | None = None
    # The latest run's answers (in the order they were made) and totals, kept in step by latest.py.
    latest_answers: list[AnswerView] = Field(default_factory=list)
    latest_run: RunSummary | None = None
    status: str
    message: str | None = None
    # Position in its upload (row index); orders an upload's calls. Calls elsewhere order by created time.
    seq: int = 0
    # Set when the customer deletes it (transcript and answers are gone), instead of a status.
    deleted: bool = False
    # From the latest run's answers, so lists filter and sort on the call alone.
    needs_review: bool = False
    needs_review_count: int = 0
    min_confidence: float | None = None
    received_at: datetime = _now()
    updated_at: datetime = _now()


class RunRequest(BaseModel):
    """One Jev request inside a run. Embedded in `Run.requests`, not a document."""

    # Jev keys ("tracker__signal") sent in this request.
    signal_names: list[str]
    tokens_estimated: int
    tokens_input: int = 0
    tokens_output: int = 0
    latency_ms: int = 0


class Run(Doc):
    """One analysis of one call: one or more Jev requests merged into a single result.

    Kept as its own doc (a retried call gets another run; usage sums runs by workspace). Its requests are
    embedded. `tenant_id`, `project_id` and `upload_id` are copied from the call for usage and exports."""

    collection: ClassVar[str] = "runs"

    id: str = _new("r")
    call_id: str
    tenant_id: str
    project_id: str
    upload_id: str | None = None
    engine: str
    model: str | None = None
    status: str
    error: str | None = None
    n_requests: int = 0
    tokens_transcript: int = 0
    tokens_signals: int = 0
    tokens_estimated: int = 0
    tokens_input: int = 0
    tokens_output: int = 0
    # What Jev charges us (internal).
    jev_cost_usd: float = 0.0
    latency_ms: int = 0
    # Per conditional tracker: {"run_if", "condition", "met", "value", "reason"}. See worker.process_call.
    conditions: dict[str, Any] = Field(default_factory=dict)
    requests: list[RunRequest] = Field(default_factory=list)
    created_at: datetime = _now()


class Answer(Keyed, AnswerView):
    """One signal's answer on one call, in one run. Id: `<run_id>:<tracker_name>:<signal_name>`.

    The history behind `Call.latest_answers`: every run keeps its answers here. What exports and
    reviews need is copied from the call: `project_id`, `upload_id`, `call_id`, `occurred_at`,
    `channel`, `agent_id`, `agent_version`, `meta`. An answer counts when `run_id` is its call's
    `latest_run_id`. A review writes here and to the call's copy."""

    collection: ClassVar[str] = "answers"
    key_fields: ClassVar[tuple[str, ...]] = ("run_id", "tracker_name", "signal_name")

    run_id: str
    call_id: str
    tenant_id: str
    project_id: str
    upload_id: str | None = None
    occurred_at: datetime = _now()
    channel: str | None = None
    agent_id: str | None = None
    agent_version: str | None = None
    meta: dict[str, str] = Field(default_factory=dict)
    # Null once the signal is permanently deleted; the answer keeps its names and version number.
    signal_version_id: str | None = None
    created_at: datetime = _now()

    @classmethod
    def for_call(cls, call: Call, **fields: Any) -> "Answer":
        """An answer carrying the call fields it is filtered on."""
        return cls(
            call_id=call.id, tenant_id=call.tenant_id, project_id=call.project_id, upload_id=call.upload_id,
            occurred_at=call.occurred_at, channel=call.channel, agent_id=call.agent_id,
            agent_version=call.agent_version, meta=dict(call.meta), **fields,
        )


# ── Usage, notifications, dashboards, chats ──────────────────────────────────


class UsageEvent(Doc):
    """One thing someone did that counts: an analysed call, or a question to alteria. Tokens only (billing is off)."""

    collection: ClassVar[str] = "usage_events"

    id: str = _new("ue")
    tenant_id: str
    project_id: str | None = None
    user_id: str | None = None
    kind: str  # analysis | alteria_ask | alteria_draft
    tokens: int = 0
    ref: str | None = None
    created_at: datetime = _now()


class Notification(Doc):
    collection: ClassVar[str] = "notifications"

    id: str = _new("n")
    tenant_id: str
    user_id: str
    kind: str
    title: str
    body: str | None = None
    href: str | None = None
    actor_id: str | None = None
    project_id: str | None = None
    read: bool = False
    created_at: datetime = _now()


class Dashboard(Doc):
    collection: ClassVar[str] = "dashboards"

    id: str = _new("d")
    tenant_id: str
    project_id: str
    name: str
    description: str | None = None
    params: str = ""
    # Stored as given: only the UI reads widgets.
    widgets: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime = _now()
    updated_at: datetime = _now()


class Thread(Doc):
    """A saved Ask alteria chat: private to its owner until shared with the project."""

    collection: ClassVar[str] = "threads"

    id: str = _new("th")
    tenant_id: str
    project_id: str
    owner_id: str
    title: str
    # A title the owner typed is never replaced.
    title_by_user: bool = False
    shared_at: datetime | None = None
    # {id, title, by: user id} when it's a copy of a shared chat.
    copied_from: dict[str, str] | None = None
    draft: dict[str, Any] | None = None
    saved_dashboard_id: str | None = None
    # Copied so the chat list needs no reads of messages, pins or the owner.
    shared: bool = False
    pinned_by: list[str] = Field(default_factory=list)
    message_count: int = 0
    last_question: str = ""
    owner_name: str = ""
    owner_avatar_url: str | None = None
    created_at: datetime = _now()
    updated_at: datetime = _now()


class ThreadMessage(Doc):
    """A message in a chat; read a chat's messages ordered by `created_at`."""

    collection: ClassVar[str] = "thread_messages"

    id: str = _new("tm")
    thread_id: str
    role: str  # user | alteria
    # Message index in the chat: orders messages that share a timestamp.
    seq: int = 0
    text: str
    answer: dict[str, Any] | None = None
    error: str | None = None
    scope: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = _now()


class ThreadPin(Keyed):
    """Pins are per person, so a shared chat can be pinned by each teammate. Id: `<thread_id>:<user_id>`."""

    collection: ClassVar[str] = "thread_pins"
    key_fields: ClassVar[tuple[str, ...]] = ("thread_id", "user_id")

    thread_id: str
    user_id: str


class DocFeedback(Doc):
    collection: ClassVar[str] = "doc_feedback"

    id: str = _new("df")
    slug: str
    helpful: bool
    comment: str | None = None
    # A hash of the sender's address, for rate limiting only.
    sender: str
    created_at: datetime = _now()


# ── Internal records ─────────────────────────────────────────────────────────


class AuditEntry(Doc):
    collection: ClassVar[str] = "audit_log"

    id: str = _new("a")
    tenant_id: str | None = None
    actor: str
    action: str
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = _now()


class AlteriaRequest(Doc):
    """One alteria request: how Jev routed it, which model answered and what it cost us.
    Never what the user sent or what the model wrote."""

    collection: ClassVar[str] = "alteria_requests"

    id: str = _new("ar")
    tenant_id: str
    task: str
    routed_tier: str
    route_probabilities: dict[str, float] | None = None
    # The tier and model that gave the accepted draft (or the last tried, if none was).
    tier: str | None = None
    model: str | None = None
    # Model calls made; more than one means a draft failed validation and went a tier up.
    attempts: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    is_draft: bool = False  # task isn't an "ask": drafts and asks have separate trial counts
    cost_usd: float = 0.0  # the model provider's charge to us
    jev_tokens: int = 0  # routing
    latency_ms: int = 0
    ok: bool = False
    error: str | None = None
    created_at: datetime = _now()


class TrackerOverlap(Keyed):
    """Jev's answer to "do these two trackers overlap?", cached against both definitions.

    Id: `<project_id>:<tracker_a>:<tracker_b>:<fingerprint_a>:<fingerprint_b>`, so a cached answer is one get.
    A changed tracker gets a new fingerprint, so its old answers stop applying. Tokens are
    recorded for our costs only: overlap checks are never billed to the customer."""

    collection: ClassVar[str] = "tracker_overlaps"
    key_fields: ClassVar[tuple[str, ...]] = ("project_id", "tracker_a", "tracker_b", "fingerprint_a", "fingerprint_b")

    tenant_id: str
    project_id: str
    # tracker_a < tracker_b
    tracker_a: str
    tracker_b: str
    tracker_names: list[str] = Field(default_factory=list)  # [a, b], for array-contains when a tracker is removed
    fingerprint_a: str
    fingerprint_b: str
    overlaps: bool
    probability: float
    confidence: float
    model: str | None = None
    tokens_input: int = 0
    jev_cost_usd: float = 0.0
    created_at: datetime = _now()
