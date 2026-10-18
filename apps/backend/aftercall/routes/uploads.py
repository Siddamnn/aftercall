"""Uploads (with the dry run), their results and CSV, single calls, and deleting them."""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel

from aftercall import billing, call_events, data_version, ingest, latest, llm, results, storage, tasks, tokens, usage, worker
from aftercall.billing import token_cost
from aftercall.config import get_settings, large_call_message, over_limit_message
from aftercall.deps import ProjectDep, StoreDep, Who, require
from aftercall.errors import not_found
from aftercall.ingest import CallIn, Parsed, UploadError, read_upload
from aftercall.models import Answer, Call, Project, Run, Signal, Tracker, Upload, utcnow
from aftercall.planner import estimate
from aftercall.signals import Condition
from aftercall.store import Store

router = APIRouter()
Analyst = Annotated[Who, require("analyse")]

AUDIO_ESTIMATE_NOTE = "estimated after transcription"
AUDIO_NEEDS_GEMINI = "Audio uploads need Gemini, which isn't configured on this server"
QUEUE_FAILED_MESSAGE = "Couldn't be queued for analysis"


class Flagged(BaseModel):
    """A call the customer should see before running it (dry run) and in the results."""

    row: int
    external_id: str | None
    flag: str  # "large": split into several requests, uses a multiple of the tokens · "over_limit": not run
    transcript_tokens: int
    requests: int
    estimated_tokens: int
    multiplier: float | None
    message: str


class EstimateOut(BaseModel):
    """Pricing is per token: the customer pays for the tokens used, nothing else."""

    requests: int | None  # null for a recording: it can't be counted before it's transcribed
    tokens: int | None
    price_per_million_tokens: float | None
    cost: float | None  # null until prices are set
    note: str | None = None


class ChargeOut(BaseModel):
    """Queued calls hold their estimated tokens: Pro's included tokens first, then credits.
    Estimates are the most the calls can use; each call is charged for the tokens it actually
    used when it runs, and the rest of its hold comes back."""

    plan: str
    included_tokens: int
    cost: float  # from credits
    balance: float  # before this upload
    balance_after: float
    shortfall: float  # 0 when the balance covers it; a real upload is then refused (402)
    message: str | None = None  # what to do about a shortfall, for the customer


class UploadOut(BaseModel):
    upload_id: str | None
    dry_run: bool
    filename: str
    trackers: list[str]  # the trackers that will run
    # The chosen trackers that run only on calls where their condition holds. With any of
    # these, the estimate is the most the upload can use: every condition holding.
    conditional: list[str]
    signals: int  # active signals across those trackers
    received: int
    queued: int
    over_limit: int
    large: int
    duplicates: int
    estimate: EstimateOut
    over_limit_message: str | None = None
    flagged: list[Flagged]
    # What the upload holds from the account; null while billing is off.
    charge: ChargeOut | None = None
    # How the file was read (B51), and what was in it (B6).
    format: dict[str, Any]
    skipped: list[dict[str, Any]] = []
    warnings: list[str] = []
    sample: dict[str, Any] | None = None
    channels: dict[str, int] = {}
    metadata_keys: list[str] = []


def _charge_out(acc: billing.Account, q: billing.Quote) -> ChargeOut:
    return ChargeOut(
        plan=acc.plan, included_tokens=q.included_tokens, cost=billing.to_usd(q.micros),
        balance=billing.to_usd(q.balance_micros), balance_after=billing.to_usd(q.balance_micros - q.micros),
        shortfall=billing.to_usd(q.shortfall_micros),
        message=billing.shortfall_message(q) if q.shortfall_micros else None,
    )


def _estimate_out(requests: int | None, n_tokens: int | None, note: str | None = None) -> EstimateOut:
    return EstimateOut(requests=requests, tokens=n_tokens, price_per_million_tokens=billing.plans()["payg"].price_per_million,
                       cost=token_cost(n_tokens) if n_tokens is not None else None, note=note)


def occurred_at(started_at: str | None) -> datetime:
    """started_at when it reads as a date or time, else now: what date filters and trends use."""
    try:
        parsed = datetime.fromisoformat(started_at.strip()) if started_at else None
    except ValueError:
        parsed = None
    if parsed is None:
        return utcnow()
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class _Tally:
    def __init__(self) -> None:
        self.queued = self.over = self.large = self.dupes = self.requests = self.tokens = 0
        self.flagged: list[Flagged] = []
        self.calls: list[Call] = []  # what to store, when this isn't a dry run

    @property
    def to_run(self) -> list[Call]:
        return [c for c in self.calls if c.status == "queued"]


def _plan_call(row: int, c: CallIn, stage_groups: list, tally: _Tally):
    settings = get_settings()
    n_tokens = tokens.count(c.transcript)
    est = estimate(n_tokens, stage_groups, settings.token_budget, settings.max_signals_per_request)
    if est is None:
        tally.over += 1
        tally.flagged.append(Flagged(row=row, external_id=c.external_id, flag="over_limit", transcript_tokens=n_tokens,
                                     requests=0, estimated_tokens=0, multiplier=None, message=over_limit_message()))
        return n_tokens, None
    tally.queued += 1
    tally.requests += est.requests
    tally.tokens += est.tokens
    if est.is_large:
        tally.large += 1
        tally.flagged.append(Flagged(
            row=row, external_id=c.external_id, flag="large", transcript_tokens=n_tokens, requests=est.requests,
            estimated_tokens=est.tokens, multiplier=round(est.multiplier, 2),
            message=large_call_message(n_tokens, est.requests, est.tokens, est.multiplier),
        ))
    return n_tokens, est


def _new_call(upload: Upload, who: Who, row: int, c: CallIn, chosen: list[str], n_tokens: int, est) -> Call:
    return Call(
        tenant_id=upload.tenant_id, project_id=upload.project_id, upload_id=upload.id, created_by=who.user.id,
        source="upload", external_id=c.external_id, agent_id=c.agent_id, agent_version=c.agent_version,
        started_at=c.started_at, occurred_at=occurred_at(c.started_at), channel=c.channel, meta=c.metadata,
        transcript=c.transcript, transcript_tokens=n_tokens, trackers=chosen, seq=row,
        estimated_requests=est.requests if est else None, estimated_tokens=est.tokens if est else None,
        estimated_unsplit_requests=est.unsplit_requests if est else None,
        estimated_unsplit_tokens=est.unsplit_tokens if est else None,
        status="queued" if est else "over_limit", message=None if est else over_limit_message(),
    )


def _existing_ids(store: Store, project: Project, parsed: Parsed) -> set[str]:
    ids = [c.external_id for c in parsed.calls if c.external_id]
    found: set[str] = set()
    for batch in results.chunks(ids):
        found.update(c.external_id for c in store.find(
            Call, ("project_id", "==", project.id), ("source", "==", "upload"), ("external_id", "in", batch)))
    return found


def _hold(store: Store, who: Who, upload: Upload | None, tally: _Tally) -> ChargeOut | None:
    if not billing.enabled():
        return None
    acc = billing.account(store, who.workspace.id, lock=upload is not None)
    q = billing.quote(acc, [c.estimated_tokens or 0 for c in tally.to_run])
    if upload is not None:
        usage.check(store, who.workspace, who.user.id, who.role, q.micros)
        try:
            billing.hold(store, acc, upload.id, tally.to_run, q)
        except billing.NotEnoughCredits as exc:
            raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, str(exc)) from None
    return _charge_out(acc, q)


def _enqueue(store: Store, calls: list[Call]) -> None:
    """Hand the calls to the queue; one that can't be queued fails with a message instead of waiting forever."""
    unqueued = set(tasks.enqueue_calls([c.id for c in calls]))
    for call in calls:
        if call.id in unqueued:
            worker.fail_call(store, call, QUEUE_FAILED_MESSAGE)


@router.post("/uploads", status_code=status.HTTP_201_CREATED)
def create_upload(
    who: Analyst, project: ProjectDep, store: StoreDep,
    file: Annotated[UploadFile, File()],
    dry_run: Annotated[bool, Query(description="Only estimate: nothing is stored or run")] = False,
    trackers: Annotated[
        list[str] | None,
        Query(description="Trackers to run: repeat the parameter or comma-separate. Omit to run every active tracker"),
    ] = None,
) -> UploadOut:
    """Upload calls (a transcript file) or one recording (mp3, wav, m4a, ogg, webm, flac) and choose which
    trackers run on them. With dry_run=true, returns what running them would use, which calls are large
    (split into several requests) or over the limit (not run), and how the file was read, without storing
    anything. A recording is transcribed first, so its estimate is empty until then."""
    chosen = _resolve_trackers(store, project, trackers)
    signals = worker.active_signals(store, project.id, chosen)
    if not signals:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Create at least one tracker with a signal before uploading calls")
    filename = file.filename or "upload"
    if ingest.is_audio(filename):
        return _create_audio_upload(who, project, store, file, filename, chosen, len(signals), dry_run)
    try:
        parsed = read_upload(filename, file.file.read())
    except UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": exc.errors}) from None

    upload = None if dry_run else Upload(
        tenant_id=project.tenant_id, project_id=project.id, created_by=who.user.id, filename=filename, trackers=chosen)
    tally = _queue(store, who, upload, parsed, project, chosen, worker.plan_stages(store, project.id, signals))
    charge = _hold(store, who, upload, tally)
    if upload is not None:
        store.put(upload)
        store.put_many(tally.calls)
        _enqueue(store, tally.to_run)
    conditions = worker.tracker_conditions(store, project.id, chosen)
    return UploadOut(
        upload_id=upload.id if upload else None, dry_run=dry_run, filename=filename,
        trackers=chosen, conditional=[c for c in chosen if conditions.get(c)], signals=len(signals),
        received=len(parsed.calls), queued=tally.queued, over_limit=tally.over, large=tally.large,
        duplicates=tally.dupes, estimate=_estimate_out(tally.requests, tally.tokens),
        over_limit_message=over_limit_message() if tally.over else None, flagged=tally.flagged, charge=charge,
        format=parsed.format, skipped=parsed.skipped, warnings=parsed.warnings,
        sample=parsed.calls[0].model_dump() if parsed.calls else None,
        channels=parsed.channels, metadata_keys=parsed.metadata_keys,
    )


def _create_audio_upload(
    who: Who, project: Project, store: Store, file: UploadFile, filename: str, chosen: list[str], n_signals: int, dry_run: bool,
) -> UploadOut:
    """One recording is one call, queued as "transcribing"; the worker transcribes it, then analyses it."""
    if llm.default_client() is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, AUDIO_NEEDS_GEMINI)
    try:
        data = file.file.read(ingest.MAX_AUDIO_BYTES + 1)
        mime = ingest.check_audio(filename, file.content_type or "", data)
    except UploadError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": exc.errors}) from None
    upload_id = None
    if not dry_run:
        upload = Upload(tenant_id=project.tenant_id, project_id=project.id, created_by=who.user.id, filename=filename, trackers=chosen)
        call = Call(
            tenant_id=project.tenant_id, project_id=project.id, upload_id=upload.id, created_by=who.user.id,
            source="audio", external_id=filename, transcript="", transcript_tokens=0, trackers=chosen, seq=1,
            audio_uri=storage.save_upload(data, filename, mime), audio_content_type=mime, status="transcribing",
        )
        store.put(upload)
        store.put(call)
        _enqueue(store, [call])
        upload_id = upload.id
    conditions = worker.tracker_conditions(store, project.id, chosen)
    return UploadOut(
        upload_id=upload_id, dry_run=dry_run, filename=filename, trackers=chosen,
        conditional=[c for c in chosen if conditions.get(c)], signals=n_signals,
        received=1, queued=1, over_limit=0, large=0, duplicates=0,
        estimate=_estimate_out(None, None, AUDIO_ESTIMATE_NOTE), flagged=[],
        format={"adapter": "audio", "label": f"Audio recording ({mime})", "confidence": 1.0},
    )


def _queue(store: Store, who: Who, upload: Upload | None, parsed: Parsed, project: Project,
           chosen: list[str], stage_groups: list) -> _Tally:
    """Plans every call, skipping duplicates, and builds the calls to store when this isn't a dry run."""
    existing = _existing_ids(store, project, parsed)
    tally = _Tally()
    for row, c in enumerate(parsed.calls, start=1):
        if c.external_id and c.external_id in existing:
            tally.dupes += 1
            continue
        if c.external_id:
            existing.add(c.external_id)
        n_tokens, est = _plan_call(row, c, stage_groups, tally)
        if upload is not None:
            tally.calls.append(_new_call(upload, who, row, c, chosen, n_tokens, est))
    return tally


def _resolve_trackers(store: Store, project: Project, requested: list[str] | None) -> list[str]:
    """The requested names (deduplicated, in order), checked to be active and to have signals.
    A conditional tracker needs the tracker its condition is on to be chosen too.
    None means every active tracker that has an active signal (and whose condition can be checked)."""
    ordered = sorted(store.find(Tracker, ("project_id", "==", project.id)), key=lambda t: (t.seq, t.created_at))
    active = {t.name for t in ordered if t.is_active}
    with_signals = {s.tracker_name for s in store.find(Signal, ("project_id", "==", project.id), ("is_active", "==", True))} & active
    run_if = {t.name: t.run_if for t in ordered}
    if requested is None:
        chosen = [t.name for t in ordered if t.name in active and t.name in with_signals]
        # Drop trackers whose condition is on a tracker that isn't running, until none are left.
        while dropped := [n for n in chosen if run_if[n] and run_if[n]["tracker"] not in chosen]:
            chosen = [n for n in chosen if n not in dropped]
        return chosen
    chosen = list(dict.fromkeys(n.strip() for item in requested for n in item.split(",") if n.strip()))
    if not chosen:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose at least one tracker")
    errors = [f"Tracker {n!r} doesn't exist or is inactive" for n in chosen if n not in active]
    errors += [f"Tracker {n!r} has no active signals" for n in chosen if n in active and n not in with_signals]
    errors += [
        f"Tracker {n!r} runs only if {Condition.model_validate(run_if[n]).describe()}; choose {run_if[n]['tracker']!r} as well"
        for n in chosen if n in active and run_if[n] and run_if[n]["tracker"] not in chosen
    ]
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": errors})
    return chosen


def get_upload_or_404(store: Store, project: Project, upload_id: str) -> Upload:
    upload = store.get(Upload, upload_id)
    if upload is None or upload.project_id != project.id:
        raise not_found("Upload")
    return upload


@router.get("/uploads")
def list_uploads(project: ProjectDep, store: StoreDep) -> list[dict[str, Any]]:
    """The project's uploads, newest first, each shaped like GET /uploads/{id}."""
    uploads = store.find(Upload, ("project_id", "==", project.id), order_by="created_at", descending=True)
    return [_upload_status(store, u) for u in uploads]


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: str, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    return _upload_status(store, get_upload_or_404(store, project, upload_id))


def _upload_status(store: Store, upload: Upload) -> dict[str, Any]:
    """A finished upload's counts were saved when it finished; until then they're counted live."""
    counts = upload.counts if upload.finished_at is not None and upload.counts else call_events.upload_counts(store, upload.id)
    pending = sum(counts.get(s, 0) for s in call_events.PENDING)
    return {
        "upload_id": upload.id, "filename": upload.filename, "trackers": upload.trackers,
        "created_at": upload.created_at, "complete": pending == 0,
        "counts": {s: counts.get(s, 0) for s in call_events.STATUSES},
    }


def _upload_results(store: Store, upload: Upload) -> list[dict[str, Any]]:
    """One read per call of the upload, nothing else: the latest run's answers are on the call."""
    calls = sorted(results.find_calls(store, ("upload_id", "==", upload.id)), key=lambda c: (c.seq, c.received_at))
    return results.call_results(calls)


@router.get("/uploads/{upload_id}/results")
def upload_results(upload_id: str, project: ProjectDep, store: StoreDep) -> list[dict[str, Any]]:
    return _upload_results(store, get_upload_or_404(store, project, upload_id))


@router.get("/uploads/{upload_id}/export.csv")
def upload_export(upload_id: str, project: ProjectDep, store: StoreDep):
    upload = get_upload_or_404(store, project, upload_id)
    rows = _upload_results(store, upload)
    names = results.signal_columns(rows)
    keys = results.meta_keys(rows)
    # One "ran" column per conditional tracker: true, false, or empty if the call wasn't run.
    conditional = list(dict.fromkeys(c for r in rows for c in r["conditions"]))
    fixed = ["call_id", "external_id", "channel", "agent_id", "agent_version", "trackers", "status", "message",
             "transcript_tokens", "billed_input_tokens", "requests", "cost", "large", "warning"]
    header = fixed + [f"meta.{k}" for k in keys] + results.answer_headers(names) + [f"{c}.ran" for c in conditional]

    def lines():
        yield header
        for r in rows:
            yield ([r["call_id"], r["external_id"], r["channel"], r["agent_id"], r["agent_version"], "|".join(r["trackers"]),
                    r["status"], r["message"], r["tokens"]["transcript"], r["tokens"]["billed_input"], r["requests"],
                    r["cost"], r["large"], r["warning"]]
                   + [r["metadata"].get(k, "") for k in keys] + results.answer_cells(r, names)
                   + [r["conditions"][c]["met"] if c in r["conditions"] else "" for c in conditional])

    return results.csv_response(lines(), f"aftercall-upload-{upload.id}.csv")


def get_call_or_404(store: Store, project: Project, call_id: str) -> Call:
    call = store.get(Call, call_id)
    if call is None or call.project_id != project.id or call.deleted:
        raise not_found("Call")
    return call


@router.get("/calls/{call_id}")
def get_call(call_id: str, project: ProjectDep, store: StoreDep, include_transcript: bool = False) -> dict[str, Any]:
    call = get_call_or_404(store, project, call_id)
    result = results.call_result(call)
    if include_transcript:
        result["transcript"] = call.transcript
    return result


def erase_calls(store: Store, calls: list[Call]) -> None:
    """Delete the customer's content for these calls: transcripts, identifiers, answers and the
    answers recorded in condition checks. Runs keep their token counts so usage stays correct;
    nothing in them identifies the call."""
    if busy := [c.id for c in calls if c.status == "processing"]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Call {busy[0]} is being analysed right now; try again in a few seconds")
    for c in calls:
        if c.status in ("queued", "transcribing"):
            billing.settle(store, c, 0)
    uploads = {c.upload_id for c in calls if c.upload_id}
    for batch in results.chunks([c.id for c in calls]):
        store.delete_where(Answer, ("call_id", "in", batch))
        for run in store.find(Run, ("call_id", "in", batch)):
            store.update(Run, run.id, conditions={}, error=None)
    for c in calls:
        if c.audio_uri:
            storage.delete_upload(c.audio_uri)
        c.transcript, c.external_id, c.agent_id, c.agent_version, c.started_at = "", None, None, None, None
        c.channel, c.meta, c.message, c.upload_id, c.status = None, {}, None, None, "deleted"
        c.audio_uri, c.deleted = None, True
        latest.drop(c)
        c.updated_at = utcnow()
    store.put_many(calls)
    data_version.bump_all(store, {c.project_id for c in calls})
    for upload in filter(None, (store.get(Upload, u) for u in uploads)):
        if upload.finished_at is not None:
            store.update(Upload, upload.id, counts=call_events.upload_counts(store, upload.id))


@router.delete("/calls/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_call(call_id: str, _: Analyst, project: ProjectDep, store: StoreDep) -> None:
    """Permanently deletes the call's transcript and answers. A queued call won't be run. The tokens
    it already used stay in /usage. 409 while the call is being analysed."""
    erase_calls(store, [get_call_or_404(store, project, call_id)])


@router.delete("/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_upload(upload_id: str, _: Analyst, project: ProjectDep, store: StoreDep) -> None:
    """Permanently deletes the upload and every call in it (transcripts and answers). Queued calls
    won't be run. Tokens already used stay in /usage. 409 while any of its calls is being analysed."""
    upload = get_upload_or_404(store, project, upload_id)
    erase_calls(store, store.find(Call, ("upload_id", "==", upload.id)))
    store.delete(Upload, upload.id)
