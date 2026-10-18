"""What follows a call finishing: usage, and telling the uploader when their whole upload is done."""

from aftercall import data_version, notify, usage
from aftercall.models import Call, Run, Tenant, Upload, utcnow
from aftercall.store import Store

STATUSES = ("queued", "transcribing", "processing", "done", "failed", "over_limit")
PENDING = ("queued", "transcribing", "processing")


def upload_counts(store: Store, upload_id: str) -> dict[str, int]:
    """Calls per status, counted live: parallel tasks can't lose each other's updates this way."""
    return {s: store.count(Call, ("upload_id", "==", upload_id), ("status", "==", s)) for s in STATUSES}


def finished(store: Store, call: Call, run: Run | None) -> None:
    """After a call is done, failed or skipped. `run` is None when no run was made (crash, transcription)."""
    if run is not None and run.status == "done":
        usage.record(store, call.tenant_id, "analysis", user_id=call.created_by, project_id=call.project_id,
                     tokens=run.tokens_input, ref=call.id)
        tenant = store.get(Tenant, call.tenant_id)
        if call.created_by and tenant is not None:
            usage.notice_thresholds(store, tenant, call.created_by)
    if call.upload_id:
        _upload_finished(store, store.get(Upload, call.upload_id))


def _upload_finished(store: Store, upload: Upload | None) -> None:
    if upload is None or upload.finished_at is not None:
        return
    counts = upload_counts(store, upload.id)
    if any(counts[s] for s in PENDING):
        return
    # Only one of several tasks finishing together gets to announce it.
    won = store.claim(Upload, upload.id, expect={"finished_at": None}, changes={"finished_at": utcnow(), "counts": counts})
    if won is not None:  # the last call's bump may have been coalesced away
        data_version.bump(store, upload.project_id)
    if won is None or upload.created_by is None:  # saved counts spare later polls the live count; no one to tell
        return
    review = store.count(Call, ("upload_id", "==", upload.id), ("needs_review", "==", True))
    done, failed = counts["done"], counts["failed"]
    kind, title = ("run_failed", f"{failed} conversations in {upload.filename} couldn't be analysed") if failed \
        else ("run_finished", f"{upload.filename} is analysed")
    body = f"{done} conversations · {review} need review" if review else f"{done} conversations · all confident"
    notify.send(store, upload.tenant_id, kind, title, [upload.created_by], body=body,
                href=f"/results/{upload.id}", project_id=upload.project_id)
