"""A call's latest run, copied onto the call (`Call.latest_answers`, `Call.latest_run`).

Insights, results and Ask alteria read the conversations in a scope. Firestore bills a read per
document, so those views read the Call docs alone: no Answer or Run docs. The copies are written when
a run finishes (`apply`), changed by a review (`set_review`) and dropped when the call is erased
(`drop`). Answer docs keep the history, and are what exports of a whole run read.
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status

from aftercall import data_version
from aftercall.errors import not_found
from aftercall.models import Answer, AnswerView, Call, Run, RunSummary, aware, utcnow
from aftercall.store import Store

REVIEW_ATTEMPTS = 5


def view_of(answer: Answer) -> AnswerView:
    return AnswerView.model_validate(answer.model_dump(include=set(AnswerView.model_fields)))


def apply(call: Call, run: Run, answers: list[Answer]) -> None:
    """Point the call at this run and copy its answers and totals. The caller saves the call."""
    call.latest_run_id = run.id
    call.latest_run = RunSummary.model_validate(run.model_dump(include=set(RunSummary.model_fields)))
    call.latest_answers = [view_of(a) for a in answers]
    _recount(call)
    call.min_confidence = min((a.confidence for a in call.latest_answers), default=None)


def drop(call: Call) -> None:
    """The call's content is erased: no answers, no run totals, nothing waiting for a person."""
    call.latest_answers, call.latest_run = [], None
    call.needs_review, call.needs_review_count, call.min_confidence = False, 0, None


def _recount(call: Call) -> None:
    waiting = sum(a.awaits_review for a in call.latest_answers)
    call.needs_review_count, call.needs_review = waiting, waiting > 0


def _after(previous: datetime) -> datetime:
    """Now, but always later than `previous`: updated_at is what a review checks nobody else wrote since."""
    return max(utcnow(), aware(previous) + timedelta(microseconds=1))


def find(call: Call, tracker: str, signal: str) -> AnswerView | None:
    return next((a for a in call.latest_answers if (a.tracker_name, a.signal_name) == (tracker, signal)), None)


def set_review(store: Store, call: Call, tracker: str, signal: str, **review: Any) -> AnswerView:
    """Save a person's correction (or clear it, with None values) on the answer and on the call's copy.

    The copy is changed only if nobody else changed the call since it was read, and re-read otherwise,
    so two reviewers of one call's different signals both keep their correction."""
    store.update(Answer, Answer.make_id(call.latest_run_id, tracker, signal), **review)
    for _ in range(REVIEW_ATTEMPTS):
        view = find(call, tracker, signal)
        if view is None:
            raise not_found("Answer")
        for field, value in review.items():
            setattr(view, field, value)
        _recount(call)
        changes = {"latest_answers": [a.model_dump() for a in call.latest_answers], "needs_review": call.needs_review,
                   "needs_review_count": call.needs_review_count, "updated_at": _after(call.updated_at)}
        if store.claim(Call, call.id, {"updated_at": call.updated_at}, changes) is not None:
            return view
        fresh = store.get(Call, call.id)
        if fresh is None or fresh.deleted:
            raise not_found("Call")
        call = fresh
    raise HTTPException(status.HTTP_409_CONFLICT, "Someone else just changed this conversation; try again")


def backfill(store: Store) -> int:
    """Copy the latest run onto calls analysed before the copies existed; the number of calls changed.
    Safe to repeat: calls that already carry a copy are left alone."""
    projects: set[str] = set()
    changed = 0
    for call in store.find(Call, ("deleted", "==", False)):
        run = store.get(Run, call.latest_run_id) if call.latest_run_id and call.latest_run is None else None
        if run is None:
            continue
        answers = store.find(Answer, ("call_id", "==", call.id), ("run_id", "==", run.id))
        apply(call, run, sorted(answers, key=lambda a: (a.created_at, a.id)))
        store.put(call)
        projects.add(call.project_id)
        changed += 1
    data_version.bump_all(store, projects)
    return changed
