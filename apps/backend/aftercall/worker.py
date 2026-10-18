"""Run one call: claim it, transcribe it if it's a recording, run the active signals of its chosen
trackers through Jev, store the merged result. Cloud Tasks (or tasks.py, in-process) calls `run_call`.

Trackers with a condition (`run_if`) run in a later stage, after the tracker they depend on,
and only when the condition holds on that call's answer.
"""

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, NamedTuple

from aftercall import billing, call_events, data_version, latest, tokens, transcribe
from aftercall.config import get_settings, over_limit_message
from aftercall.jev import Engine, EngineError, JevClient, Normalized, normalize
from aftercall.models import Answer, Call, Run, RunRequest, Signal, Tracker, aware, utcnow
from aftercall.planner import Groups, estimate, is_over_limit, plan_requests, request_tokens
from aftercall.signals import Condition, SignalSpec, jev_key
from aftercall.store import Store
from aftercall.transcribe import TranscriptionError

log = logging.getLogger("aftercall.worker")

CLAIMABLE = ("queued", "transcribing")
# A call "processing" for longer than this was left by a task that died; a redelivery takes it over.
STALE_AFTER = timedelta(minutes=15)
TRANSCRIBING_MESSAGE = "Transcribing the recording"


class VersionRef(NamedTuple):
    id: str | None
    version: int


@dataclass(frozen=True)
class Selected:
    """An active signal picked to run, with the key it's sent to Jev under."""

    tracker: str
    version: VersionRef
    spec: SignalSpec

    @property
    def key(self) -> str:
        return jev_key(self.tracker, self.spec.name)


def active_signals(store: Store, project_id: str, trackers: Iterable[str] | None = None) -> list[Selected]:
    """Active signals in the project's active trackers; only the given trackers when `trackers` is set."""
    found = store.find(Signal, ("project_id", "==", project_id), ("is_active", "==", True), ("tracker_active", "==", True))
    wanted = None if trackers is None else set(trackers)
    chosen = sorted(
        (s for s in found if s.active_spec and (wanted is None or s.tracker_name in wanted)),
        key=lambda s: (s.tracker_seq, s.seq),
    )
    return [
        Selected(s.tracker_name, VersionRef(s.active_version_id, s.active_version or 1), SignalSpec.model_validate(s.active_spec))
        for s in chosen
    ]


def tracker_conditions(store: Store, project_id: str, names: Iterable[str]) -> dict[str, Condition | None]:
    wanted = set(names)
    rows = store.find(Tracker, ("project_id", "==", project_id))
    return {t.name: Condition.model_validate(t.run_if) if t.run_if else None for t in rows if t.name in wanted}


def stages(selected: list[Selected], conditions: dict[str, Condition | None]) -> list[list[Selected]]:
    """Signals grouped by stage: unconditional trackers first, then each conditional tracker
    one stage after the tracker its condition is on. A condition on a tracker that isn't
    running puts the tracker in the first stage, where its condition then fails."""
    running = {q.tracker for q in selected}
    depth: dict[str, int] = {}

    def depth_of(cat: str, seen: frozenset[str] = frozenset()) -> int:
        if cat not in depth:
            cond = conditions.get(cat)
            parent = cond.tracker if cond else None
            # Loops are rejected when a condition is saved; `seen` only guards against bad data.
            ok = parent in running and parent not in seen
            depth[cat] = depth_of(parent, seen | {cat}) + 1 if ok else 0
        return depth[cat]

    by_stage: dict[int, list[Selected]] = {}
    for q in selected:
        by_stage.setdefault(depth_of(q.tracker), []).append(q)
    return [by_stage[d] for d in sorted(by_stage)]


def stage_groups(selected: Iterable[Selected]) -> Groups:
    groups: Groups = {}
    for q in selected:
        groups.setdefault(q.tracker, {})[q.key] = tokens.signal_tokens(q.spec.to_jev())
    return groups


def plan_stages(store: Store, project_id: str, selected: list[Selected]) -> list[Groups]:
    """For estimates: every stage, as if every condition holds."""
    conditions = tracker_conditions(store, project_id, {q.tracker for q in selected})
    return [stage_groups(stage) for stage in stages(selected, conditions)]


def check_condition(
    cond: Condition, answers: dict[tuple[str, str], Normalized], types: dict[tuple[str, str], str], not_run: set[str]
) -> dict[str, Any]:
    """Whether a conditional tracker runs on this call, and why. Returned in results as `conditions`."""
    out: dict[str, Any] = {"run_if": cond.model_dump(), "condition": cond.describe(), "met": False, "value": None, "reason": None}
    gate = (cond.tracker, cond.signal)
    if cond.tracker in not_run:
        out["reason"] = f"{cond.tracker!r} didn't run on this call, so this tracker didn't either"
    elif gate not in answers:
        out["reason"] = f"No answer for {cond.tracker}.{cond.signal} on this call"
    else:
        a = answers[gate]
        out["value"] = a.value_num if types[gate] == "score" else a.value_text
        out["met"] = cond.holds(a.value_text, a.value_num)
        if not out["met"]:
            out["reason"] = f"{cond.tracker}.{cond.signal} was {out['value']!r}, so {cond.describe()!r} doesn't hold"
    return out


def process_call(store: Store, call: Call, engine: Engine) -> Run:
    settings = get_settings()
    run = Run(call_id=call.id, tenant_id=call.tenant_id, project_id=call.project_id, upload_id=call.upload_id,
              engine=engine.name, status="running", tokens_transcript=call.transcript_tokens)
    answers: list[Answer] = []

    if is_over_limit(call.transcript_tokens, settings.token_budget):
        call.status, call.message = "over_limit", over_limit_message()
        run.status = "skipped"
        billing.settle(store, call, 0)
        return _finish(store, call, run, answers)

    signals = active_signals(store, call.project_id, call.trackers)
    if not signals:
        return _fail(store, call, run, answers, f"No active signals in the chosen trackers: {', '.join(call.trackers)}")

    by_key = {q.key: q for q in signals}
    wires = {key: q.spec.to_jev() for key, q in by_key.items()}
    conditions = tracker_conditions(store, call.project_id, {q.tracker for q in signals})
    # Answers so far, for checking later stages' conditions.
    answered: dict[tuple[str, str], Normalized] = {}
    types = {(q.tracker, q.spec.name): q.spec.type for q in signals}
    not_run: set[str] = set()
    checked: dict[str, dict[str, Any]] = {}

    try:
        for stage in stages(signals, conditions):
            for cat in dict.fromkeys(q.tracker for q in stage):
                if (cond := conditions.get(cat)) is not None:
                    checked[cat] = check_condition(cond, answered, types, not_run)
                    if not checked[cat]["met"]:
                        not_run.add(cat)
            groups = stage_groups(q for q in stage if q.tracker not in not_run)
            q_tokens = {k: t for g in groups.values() for k, t in g.items()}
            run.tokens_signals += sum(q_tokens.values())
            for names in plan_requests(call.transcript_tokens, groups, settings.token_budget, settings.max_signals_per_request):
                estimated = request_tokens(call.transcript_tokens, names, q_tokens)
                result = engine.evaluate(call.transcript, {n: wires[n] for n in names})
                run.model = result.model
                run.n_requests += 1
                run.tokens_estimated += estimated
                run.tokens_input += result.input_tokens
                run.tokens_output += result.output_tokens
                run.latency_ms += result.latency_ms
                run.requests.append(RunRequest(
                    signal_names=names, tokens_estimated=estimated, tokens_input=result.input_tokens,
                    tokens_output=result.output_tokens, latency_ms=result.latency_ms,
                ))
                for name in names:
                    if name not in result.answers:
                        raise EngineError(f"Jev returned no answer for {name!r}")
                    q = by_key[name]
                    norm = normalize(result.answers[name])
                    answered[(q.tracker, q.spec.name)] = norm
                    answers.append(_answer(call, run, q, norm))
    except EngineError as exc:
        # Answers from requests that did succeed stay attached to the failed run for debugging.
        run.conditions = checked
        return _fail(store, call, run, answers, str(exc))

    run.conditions = checked
    run.jev_cost_usd = run.tokens_input * settings.jev_price_per_mtok_input / 1_000_000
    run.status = "done"
    call.status, call.message = "done", None
    billing.settle(store, call, run.tokens_input)
    return _finish(store, call, run, answers)


def _answer(call: Call, run: Run, q: Selected, norm: Normalized) -> Answer:
    spec = q.spec
    threshold = spec.review_threshold if spec.review_threshold is not None else get_settings().default_review_threshold
    return Answer.for_call(
        call, run_id=run.id, signal_version_id=q.version.id, signal_version=q.version.version,
        tracker_name=q.tracker, signal_name=spec.name, type=spec.type, value_text=norm.value_text,
        value_num=norm.value_num, probabilities=norm.probabilities, confidence=norm.confidence,
        needs_review=norm.confidence < threshold,
    )


def _fail(store: Store, call: Call, run: Run, answers: list[Answer], message: str) -> Run:
    run.status, run.error = "failed", message
    call.status, call.message = "failed", message
    billing.settle(store, call, 0)
    log.warning("call %s failed: %s", call.id, message)
    return _finish(store, call, run, answers)


def _finish(store: Store, call: Call, run: Run, answers: list[Answer]) -> Run:
    """Run and answers first, then the call that points at them and carries copies of them (latest.py),
    so a reader never sees a done call without answers. Then the project's data version moves on
    (coalesced: a big upload finishes many calls a second)."""
    latest.apply(call, run, answers)
    call.updated_at = utcnow()
    store.put(run)
    store.put_many(answers)
    store.put(call)
    data_version.bump_coalesced(store, call.project_id)
    call_events.finished(store, call, run)
    return run


def claim(store: Store, call_id: str) -> Call | None:
    """Take the call for this delivery, atomically: None if it's gone, finished, or another delivery has it."""
    call = store.get(Call, call_id)
    if call is None or call.deleted:
        return None
    changes: dict[str, Any] = {"status": "processing", "updated_at": utcnow()}
    if call.status in CLAIMABLE:
        changes["message"] = TRANSCRIBING_MESSAGE if _needs_transcript(call) else None
        return store.claim(Call, call_id, {"status": call.status}, changes)
    if call.status == "processing" and utcnow() - aware(call.updated_at) > STALE_AFTER:
        return store.claim(Call, call_id, {"status": "processing", "updated_at": call.updated_at}, changes)
    return None


def _needs_transcript(call: Call) -> bool:
    return bool(call.audio_uri) and not call.transcript


def transcribe_call(store: Store, call: Call) -> Call:
    """Speech to speaker-labelled text, then the token count and the estimate an audio upload couldn't give."""
    result = transcribe.transcribe_uri(call.audio_uri or "", call.audio_content_type or "")
    text = result.as_text()
    if not text.strip():
        raise TranscriptionError("No speech was found in the recording")
    call.transcript, call.transcript_tokens = text, tokens.count(text)
    call.language, call.duration_seconds = result.language or None, result.duration_seconds or None
    call.message, call.updated_at = None, utcnow()
    _estimate(store, call)
    store.put(call)
    return call


def _estimate(store: Store, call: Call) -> None:
    settings = get_settings()
    signals = active_signals(store, call.project_id, call.trackers)
    if not signals:
        return
    est = estimate(call.transcript_tokens, plan_stages(store, call.project_id, signals), settings.token_budget,
                   settings.max_signals_per_request)
    if est is not None:
        call.estimated_requests, call.estimated_tokens = est.requests, est.tokens
        call.estimated_unsplit_requests, call.estimated_unsplit_tokens = est.unsplit_requests, est.unsplit_tokens


def fail_call(store: Store, call: Call, message: str) -> None:
    """End a call that never got a run (transcription failed, the worker crashed)."""
    call.status, call.message, call.updated_at = "failed", message, utcnow()
    billing.settle(store, call, 0)
    store.update(Call, call.id, status=call.status, message=message, updated_at=call.updated_at)
    call_events.finished(store, call, None)


def run_call(store: Store, engine: Engine | None, call_id: str) -> bool:
    """Run one call. False when this delivery didn't run it (already taken or finished, or deleted):
    that's a success for Cloud Tasks. Never leaves a claimed call in "processing"."""
    call = claim(store, call_id)
    if call is None:
        return False
    try:
        if engine is None:
            raise EngineError("Jev isn't configured (set TYPESAFE_API_KEY)")
        if _needs_transcript(call):
            call = transcribe_call(store, call)
        process_call(store, call, engine)
    except (TranscriptionError, EngineError) as exc:
        fail_call(store, call, str(exc))
    except Exception as exc:  # never leave a call stuck in "processing"
        log.exception("call %s crashed", call_id)
        fail_call(store, store.get(Call, call_id) or call, f"internal error: {type(exc).__name__}")
    return True


def default_engine() -> Engine | None:
    s = get_settings()
    if not s.typesafe_api_key:
        return None
    return JevClient(s.typesafe_api_key, s.jev_model, s.typesafe_base_url, s.jev_timeout_seconds)
