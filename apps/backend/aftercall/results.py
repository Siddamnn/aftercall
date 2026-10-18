"""A call's result as the API shows it, and CSV exports of many."""

import csv
import io
from collections.abc import Iterable, Iterator, Sequence
from typing import Any

from fastapi.responses import StreamingResponse

from aftercall.billing import token_cost
from aftercall.config import large_call_message
from aftercall.models import AnswerView, Call
from aftercall.store import Filter, Store

# BOM so Excel opens Hinglish/Devanagari text correctly.
BOM = "﻿"
IN_LIMIT = 30  # Firestore's `in` takes at most 30 values


def chunks(items: Sequence[str]) -> list[list[str]]:
    return [list(items[i : i + IN_LIMIT]) for i in range(0, len(items), IN_LIMIT)]


def find_calls(store: Store, *where: Filter) -> list[Call]:
    """Calls without their transcripts: the big field stays on the server (Call.transcript is "" here)."""
    return store.find(Call, *where, select=[name for name in Call.model_fields if name != "transcript"])


def call_results(calls: Iterable[Call]) -> list[dict[str, Any]]:
    return [call_result(c) for c in calls]


def _is_large(call: Call) -> bool:
    """The token budget split the call further than its stages and the signal cap did."""
    return bool(call.estimated_requests and call.estimated_requests > (call.estimated_unsplit_requests or 1))


def _large_warning(call: Call) -> str | None:
    if not _is_large(call):
        return None
    return large_call_message(call.transcript_tokens, call.estimated_requests, call.estimated_tokens,
                              call.estimated_tokens / call.estimated_unsplit_tokens)


def answer_out(a: AnswerView) -> dict[str, Any]:
    out = {
        "type": a.type,
        "value": a.value_num if a.type == "score" else a.value_text,
        **({"probability_yes": a.value_num} if a.type == "yes_no" else {}),
        "confidence": round(a.confidence, 4),
        "needs_review": a.needs_review,
        "probabilities": a.probabilities,
        "signal_version": str(a.signal_version),
        "version_number": a.signal_version,
    }
    if a.review_value is not None:
        out["review"] = {"value": a.review_value, "by": a.reviewed_by, "at": a.reviewed_at,
                         "agrees": a.review_value == answer_key(a)}
    return out


def answer_key(a: AnswerView) -> str:
    """The key an answer is counted under: an option key, yes/no, or a score's rounded level."""
    return str(round(a.value_num)) if a.type == "score" and a.value_num is not None else a.value_text


def call_result(call: Call) -> dict[str, Any]:
    """A call as the API shows it, from the call alone (its latest run's answers and totals are copied onto it)."""
    run = call.latest_run
    # Grouped by tracker: {tracker: {signal: answer}}.
    by_tracker: dict[str, dict[str, Any]] = {}
    if run is not None and call.status == "done":
        for a in call.latest_answers:
            by_tracker.setdefault(a.tracker_name, {})[a.signal_name] = answer_out(a)
    return {
        "call_id": call.id,
        "external_id": call.external_id,
        "agent_id": call.agent_id,
        "agent_version": call.agent_version,
        "started_at": call.started_at,
        "channel": call.channel,
        "metadata": call.meta or {},
        "trackers": call.trackers,
        "status": call.status,
        "message": call.message,
        "tokens": {
            "transcript": call.transcript_tokens,
            "billed_input": run.tokens_input if run else 0,
            "output": run.tokens_output if run else 0,
        },
        "requests": run.n_requests if run else 0,
        "estimate": {
            "requests": call.estimated_requests,
            "tokens": call.estimated_tokens,
            "cost": token_cost(call.estimated_tokens) if call.estimated_tokens else None,
        },
        # Billed: the tokens Jev actually used × price. Null until prices are set, or if not run.
        "cost": token_cost(run.tokens_input) if run and run.status == "done" else None,
        "large": _is_large(call),
        "warning": _large_warning(call),
        "model": run.model if run else None,
        "answers": by_tracker,
        # Each conditional tracker: whether it ran on this call, the answer it was checked on,
        # and why not. Trackers that didn't run have no entry in `answers`.
        "conditions": (run.conditions or {}) if run is not None else {},
    }


def signal_columns(results: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """Every (tracker, signal) answered in these results, in first-seen order."""
    return list(dict.fromkeys((t, s) for r in results for t, signals in r["answers"].items() for s in signals))


def meta_keys(results: list[dict[str, Any]]) -> list[str]:
    return list(dict.fromkeys(k for r in results for k in r["metadata"]))


def answer_cells(r: dict[str, Any], names: list[tuple[str, str]]) -> list[Any]:
    cells: list[Any] = []
    for t, s in names:
        a = r["answers"].get(t, {}).get(s)
        cells += [a["value"], a["confidence"], a["needs_review"]] if a else ["", "", ""]
    return cells


def answer_headers(names: list[tuple[str, str]]) -> list[str]:
    return [col for t, s in names for col in (f"{t}.{s}", f"{t}.{s}_confidence", f"{t}.{s}_needs_review")]


def csv_response(rows: Iterable[list[Any]], filename: str) -> StreamingResponse:
    def lines() -> Iterator[str]:
        yield BOM
        for row in rows:
            buf = io.StringIO()
            csv.writer(buf).writerow(row)
            yield buf.getvalue()

    return StreamingResponse(lines(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
