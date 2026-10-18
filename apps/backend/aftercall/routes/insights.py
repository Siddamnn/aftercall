"""Insights (B6–B10), conversations across uploads (B11), the scope's CSV (B36) and review
corrections (B12). Every route takes the shared scope parameters (see insights.py)."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from aftercall import billing, data_version, insights, latest, results
from aftercall.deps import MemberDep, ProjectDep, StoreDep, Who, require
from aftercall.errors import invalid, not_found, plan_required
from aftercall.models import AnswerView, Call, Project, utcnow
from aftercall.store import Store

router = APIRouter()
Reviewer = Annotated[Who, require("analyse")]
MAX_PAGE = 200


@router.get("/insights/dimensions")
def dimensions(project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """What the scope bar can offer: channels, agents and versions, metadata keys and values, dates."""
    return insights.dimensions(store, project)


@router.get("/insights/signals")
def signals(request: Request, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """Every signal's answers over the scope, and the KPI totals."""
    return insights.signals(store, project, insights.query_scope(request))


@router.get("/insights/series")
def series(
    request: Request, project: ProjectDep, store: StoreDep,
    bucket: Literal["day", "week"] = "day", signal: str | None = None,
) -> dict[str, Any]:
    """A signal's answers per day or week, with markers where it or the agent changed. Without
    `signal`, the points count conversations."""
    return insights.series(store, project, insights.query_scope(request), signal, bucket)


@router.get("/insights/breakdown")
def breakdown(request: Request, project: ProjectDep, store: StoreDep, by: str, signal: str | None = None) -> dict[str, Any]:
    """A signal's answers per channel, agent, version, upload, metadata value or another signal's answer."""
    return insights.breakdown(store, project, insights.query_scope(request), signal, by)


@router.get("/insights/movers")
def movers(request: Request, project: ProjectDep, store: StoreDep, limit: Annotated[int, Query(ge=1, le=50)] = 5) -> dict[str, Any]:
    """What changed most against the previous period of the same length."""
    return insights.movers(store, project, insights.query_scope(request), limit)


def _min_confidence(v: insights.Conv) -> float:
    return min((a.confidence for a in v.answers.values()), default=1.0)


def _sorted(convs: list[insights.Conv], sort: str) -> list[insights.Conv]:
    """`convs` arrive newest first, which is also the tiebreak: sorts are stable."""
    if sort == "confidence":
        return sorted(convs, key=_min_confidence)
    return convs if sort == "-started_at" else convs[::-1]


@router.get("/calls")
def list_calls(
    request: Request, project: ProjectDep, store: StoreDep,
    needs_review: bool | None = None, limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    cursor: str | None = None, sort: Literal["started_at", "-started_at", "confidence"] = "-started_at",
) -> dict[str, Any]:
    """Conversations across uploads in the scope, without transcripts. The cursor is an offset into the sorted list."""
    convs = insights.conversations(store, project, insights.query_scope(request))
    if needs_review is not None:
        convs = [v for v in convs if any(a.needs_review for a in v.answers.values()) == needs_review]
    at = int(cursor) if cursor and cursor.isdigit() else 0
    page = _sorted(convs, sort)[at:at + limit]
    return {
        "calls": [results.call_result(v.call) for v in page],
        "next_cursor": str(at + limit) if at + limit < len(convs) else None, "total": len(convs),
    }


@router.get("/calls/export.csv")
def export_calls(request: Request, who: MemberDep, project: ProjectDep, store: StoreDep):
    """Every conversation in the scope, one row each, with its answers. Pro (B49)."""
    if not billing.features(billing.account(store, who.workspace.id))["bulk_export"]:
        raise plan_required("Exporting every conversation in a view is part of Pro.", "bulk_export")
    convs = insights.conversations(store, project, insights.query_scope(request))
    rows = [results.call_result(v.call) for v in convs]
    names = [(d.tracker, d.name) for d in insights.signal_defs(store, project)]
    keys = results.meta_keys(rows)

    def lines():
        yield (["call_id", "external_id", "channel", "agent_id", "agent_version", "started_at"]
               + [f"meta.{k}" for k in keys] + results.answer_headers(names))
        for r in rows:
            yield ([r["call_id"], r["external_id"], r["channel"], r["agent_id"], r["agent_version"], r["started_at"]]
                   + [r["metadata"].get(k, "") for k in keys] + results.answer_cells(r, names))

    return results.csv_response(lines(), f"aftercall-conversations-{utcnow().date().isoformat()}.csv")


# ── Review corrections (B12) ───────────────────────────────────────────────


class ReviewIn(BaseModel):
    value: str | int


def _live_call(store: Store, project: Project, call_id: str) -> Call:
    call = store.get(Call, call_id)
    if call is None or call.project_id != project.id or call.deleted:
        raise not_found("Call")
    return call


def _latest_answer(call: Call, tracker: str, signal: str) -> AnswerView:
    answer = latest.find(call, tracker, signal)
    if answer is None:
        raise not_found("Answer")
    return answer


def _check_review_value(store: Store, project: Project, tracker: str, signal: str, value: str) -> None:
    d = insights.signal_def(store, project, f"{tracker}.{signal}")
    if value not in d.answer_keys():
        raise invalid(f"{tracker}.{signal} can't answer {value!r}; its answers are {', '.join(d.answer_keys())}")


def _write_review(store: Store, call: Call, tracker: str, signal: str, **review: Any) -> dict[str, Any]:
    """Save the correction on the answer and the call's copy of it (which recounts what still awaits a person)."""
    answer = latest.set_review(store, call, tracker, signal, **review)
    data_version.bump(store, call.project_id)
    return results.answer_out(answer)


@router.put("/calls/{call_id}/answers/{tracker}/{signal}/review")
def review(call_id: str, tracker: str, signal: str, body: ReviewIn, who: Reviewer, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    """A person's answer for this call and signal: it counts toward the signal's measured accuracy."""
    value = str(body.value)
    _check_review_value(store, project, tracker, signal, value)
    call = _live_call(store, project, call_id)
    _latest_answer(call, tracker, signal)
    return _write_review(store, call, tracker, signal, review_value=value, reviewed_by=who.user.id, reviewed_at=utcnow())


@router.delete("/calls/{call_id}/answers/{tracker}/{signal}/review")
def clear_review(call_id: str, tracker: str, signal: str, _: Reviewer, project: ProjectDep, store: StoreDep) -> dict[str, Any]:
    call = _live_call(store, project, call_id)
    _latest_answer(call, tracker, signal)
    return _write_review(store, call, tracker, signal, review_value=None, reviewed_by=None, reviewed_at=None)
