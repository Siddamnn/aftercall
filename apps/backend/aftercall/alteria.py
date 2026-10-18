"""alteria, aftercall's built-in AI. It drafts; the user reviews before anything is saved.

Three drafts (B38, docs/alteria.md): conversations from raw transcripts, trackers from a goal,
and a signal from a question. Each request
1. is routed by Jev to the cheapest model tier that's enough (router.py),
2. is answered as JSON by Gemini (llm.py),
3. is checked with the same validation as a real upload or tracker import. Converted
   conversations must also quote the input word for word. A draft that fails goes one tier
   up with its problems listed, until the strongest tier has had a second go.

Nothing the user sent is stored or logged: alteria_requests keeps only the route, the model,
tokens and estimated cost.
"""

import json
import re
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ValidationError

from aftercall import router, tokens
from aftercall.catalog import CatalogError, ImportTracker, parse_trackers
from aftercall.config import get_settings
from aftercall.ingest import CallIn, UploadError, parse_upload
from aftercall.jev import Engine
from aftercall.llm import LLM, LLMError, ThinkingLevel, tier_models
from aftercall.models import AlteriaRequest
from aftercall.signals import SignalSpec, condition_problem
from aftercall.store import Store

DRAFT_MAX_TOKENS = 4_000
# Gemini 3 thinks before it answers, and thinking counts against max_output_tokens (and is billed as
# output). The simple and standard tiers think a little (LOW); the complex tier keeps the model's default.
# Every request gets the tier's headroom on top of the answer budget its caller asks for, so a small
# budget never comes back empty; LOW thinking uses a few hundred tokens, so its margin is wide.
TIER_THINKING: dict[str, ThinkingLevel | None] = {"simple": ThinkingLevel.LOW, "standard": ThinkingLevel.LOW, "complex": None}
THINKING_HEADROOM: dict[str, int] = {"simple": 3_000, "standard": 3_000, "complex": 8_000}
MAX_TRACKERS, MAX_SIGNALS = 4, 4
# Share of the input's words the converted conversations must keep (the rest is labels,
# timestamps and headings). Below it, the model probably dropped part of a conversation.
MIN_KEPT = 0.5


class AlteriaError(Exception):
    """alteria couldn't produce a valid draft. The message is for the customer."""


class InputError(Exception):
    """The input can't be used (too long, empty). The message is for the customer."""


class Invalid(Exception):
    """A draft that failed validation. The problems go back to the model on the next try."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def _tiers_from(start: str) -> list[str]:
    """The tiers to try: from the routed one up, with the strongest getting a second go."""
    tiers = list(router.TIERS[router.TIERS.index(start):])
    return tiers + [tiers[-1]] if len(tiers) == 1 else tiers


def _parse_json(text: str) -> dict[str, Any]:
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text.strip())  # some models fence their JSON
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Invalid([f"Not valid JSON: {exc}"]) from None
    if not isinstance(data, dict):
        raise Invalid(["Answer with one JSON object"])
    return data


def run[T](
    store: Store, tenant_id: str, llm: LLM, engine: Engine | None, task: str, request_text: str,
    system: str, user: str, check: Callable[[dict[str, Any]], T], max_tokens: int = DRAFT_MAX_TOKENS,
) -> T:
    """Route, ask, check, and go a tier up until a draft passes. Saves a log row whatever the
    outcome. Raises AlteriaError if no draft passed."""
    route = router.route(engine, task, request_text)
    log = AlteriaRequest(
        tenant_id=tenant_id, task=task, is_draft=not task.startswith("ask"), routed_tier=route.tier,
        route_probabilities=route.probabilities, jev_tokens=route.jev_tokens,
    )
    try:
        return _ask_up_the_tiers(llm, route.tier, system, user, check, max_tokens, log)
    finally:
        store.put(log)


def _ask_up_the_tiers[T](
    llm: LLM, start: str, system: str, user: str, check: Callable[[dict[str, Any]], T], max_tokens: int,
    log: AlteriaRequest,
) -> T:
    problems: list[str] = []
    for tier in _tiers_from(start):
        prompt = user
        if problems:
            prompt += ("\n\nYour previous answer was rejected:\n- " + "\n- ".join(problems[:20])
                       + "\nFix every problem and answer again with the whole JSON object.")
        log.tier = tier
        log.attempts += 1
        try:
            done = llm.complete(system, prompt, tier_models(tier), max_tokens + THINKING_HEADROOM[tier], TIER_THINKING[tier])
        except LLMError as exc:
            problems, log.error = [], f"{tier}: {exc}"[:2000]
            continue
        log.model = done.model
        log.input_tokens += done.input_tokens
        log.output_tokens += done.output_tokens
        log.cost_usd += done.cost_usd
        log.latency_ms += done.latency_ms
        try:
            value = check(_parse_json(done.text))
        except Invalid as exc:
            problems = exc.problems
            log.error = f"{tier}: {'; '.join(problems)}"[:2000]
            continue
        log.ok, log.error = True, None
        return value
    raise AlteriaError("alteria couldn't draft this. Try rewording it, or try again in a minute.")


def _problems(exc: ValidationError, prefix: str) -> list[str]:
    return [f"{prefix}{'.' + '.'.join(map(str, e['loc'])) if e['loc'] else ''}: {e['msg'].removeprefix('Value error, ')}"
            for e in exc.errors()]


def _notes(data: dict[str, Any], key: str = "notes") -> list[str]:
    notes = data.get(key) or []
    if not isinstance(notes, list) or not all(isinstance(n, str) for n in notes):
        raise Invalid([f'"{key}" must be a list of sentences'])
    return notes


def _unique(name: str, taken: set[str]) -> str:
    n = 2
    candidate = name
    while candidate in taken:
        suffix = f"_{n}"
        candidate, n = name[: 64 - len(suffix)] + suffix, n + 1
    return candidate


def _words(name: str) -> str:
    return name.replace("_", " ").capitalize()


# ── Signal ─────────────────────────────────────────────────────────────────

_SIGNAL_RULES = """\
A signal is one question that a classifier answers about every conversation. The classifier
is narrow: it picks from options you describe, so describe them well. It can't do dates,
arithmetic, exact numbers or indirect meaning.

A signal is a JSON object:
- "name": snake_case (lowercase letters, digits and _), starting with a letter, at most 64 characters.
- "type": "yes_no" for did/does/is questions, "score" for how-much questions on a scale,
  "choice" for which/why/how-did-it-end questions.
- "instructions": what to decide, whose words count ("the caller" or "the agent"), and what
  to answer when the conversation doesn't show it. At most 2000 characters.
- "criteria":
  - choice: an object of 2-10 options with snake_case keys. Each description says what the
    conversation contains when the option applies, with typical phrases customers use
    (in other languages too, if the goal suggests them). Always include "other"; for "why"
    questions also include "not_stated".
  - score: a list of 2-10 level descriptions, lowest first.
  - yes_no: leave it out, or {"true": "...", "false": "..."}.
- One condition per yes_no signal: split "X and Y" into two signals.
- No placeholders like {policy}: write real text."""

SIGNAL_SYSTEM = f"""\
You are alteria, the assistant inside aftercall, which analyses customer conversations
(calls and chats, with people or AI agents). You turn the user's question into one signal.

{_SIGNAL_RULES}

Answer with one JSON object: {{"signal": {{...}}, "notes": ["..."]}}. "notes" are short
sentences telling the user what you assumed or couldn't infer (for example, placeholder
options they should edit). Leave it empty if there's nothing to say."""


class SignalDraft(BaseModel):
    signal: SignalSpec
    notes: list[str]


def draft_signal(
    store: Store, tenant_id: str, llm: LLM, engine: Engine | None,
    text: str, tracker: str, type_hint: str | None, existing: list[str],
) -> SignalDraft:
    user = (f"Tracker: {tracker}\nSignals already in it: {', '.join(existing) or 'none'}\n"
            f"Type hint: {type_hint or 'none'}\n\nQuestion:\n{text}")

    def check(data: dict[str, Any]) -> SignalDraft:
        try:
            spec = SignalSpec.model_validate(data.get("signal"))
        except ValidationError as exc:
            raise Invalid(_problems(exc, "signal")) from None
        notes = _notes(data)
        if spec.name in existing:
            new = _unique(spec.name, set(existing))
            notes.append(f"{_words(spec.name)} is already in {_words(tracker)}, so this one is {_words(new)}.")
            spec = spec.model_copy(update={"name": new})
        return SignalDraft(signal=spec, notes=notes)

    return run(store, tenant_id, llm, engine, "signal", text, SIGNAL_SYSTEM, user, check)


# ── Trackers ───────────────────────────────────────────────────────────────

TRACKERS_SYSTEM = f"""\
You are alteria, the assistant inside aftercall, which analyses customer conversations
(calls and chats, with people or AI agents). You design trackers for the user's goal.

A tracker groups related signals, such as "outcome" or "compliance". Design 1-{MAX_TRACKERS}
trackers with 1-{MAX_SIGNALS} signals each: the fewest that answer the goal. Prefer the words
the user's customers would use.

A tracker is a JSON object:
- "name": snake_case, starting with a letter, at most 64 characters, no "__".
- "description": one sentence, at most 500 characters.
- "signals": a list of signals.
- "run_if" (optional): only when a tracker makes sense for some conversations, e.g. reasons
  for declining only when the outcome was declined:
  {{"tracker": "<another tracker in your answer>", "signal": "<its signal>", "op": "in" | "not_in"
  (choice or yes_no answers, with "value" a list of option keys, or "yes"/"no") | "gte" | "lte"
  (score, with "value" a level number from 0), "value": ...}}.

{_SIGNAL_RULES}

Don't reuse the names of the user's existing trackers. Answer with one JSON object:
{{"trackers": [...], "notes": ["..."]}}. "notes" are short sentences telling the user what
you assumed. Leave it empty if there's nothing to say."""


class TrackersDraft(BaseModel):
    trackers: list[ImportTracker]
    notes: list[str]


def draft_trackers(
    store: Store, tenant_id: str, llm: LLM, engine: Engine | None, goal: str, existing: list[str],
) -> TrackersDraft:
    user = f"The user's existing trackers: {', '.join(existing) or 'none'}\n\nGoal:\n{goal}"

    def check(data: dict[str, Any]) -> TrackersDraft:
        raw = data.get("trackers")
        try:
            trackers = parse_trackers(raw if isinstance(raw, list) else [])
        except CatalogError as exc:
            raise Invalid(exc.errors) from None
        problems = []
        if len(trackers) > MAX_TRACKERS:
            problems.append(f"At most {MAX_TRACKERS} trackers (got {len(trackers)})")
        for t in trackers:
            if not 1 <= len(t.signals) <= MAX_SIGNALS:
                problems.append(f"{t.name}: needs 1-{MAX_SIGNALS} signals (got {len(t.signals)})")
        by_name = {t.name: t for t in trackers}
        for t in trackers:
            if t.run_if is None:
                continue
            parent = by_name.get(t.run_if.tracker)
            signal = parent and next((s for s in parent.signals if s.name == t.run_if.signal), None)
            if signal is None:
                problems.append(f"{t.name}.run_if: no signal {t.run_if.signal!r} in a tracker "
                                f"{t.run_if.tracker!r} in this answer")
            elif problem := condition_problem(t.run_if, signal):
                problems.append(f"{t.name}.run_if: {problem}")
        if problems:
            raise Invalid(problems)

        notes = _notes(data)
        taken = set(existing) | set(by_name)
        renamed = {}
        for t in trackers:
            if t.name in existing:
                renamed[t.name] = _unique(t.name, taken)
                taken.add(renamed[t.name])
                notes.append(f"You already have {_words(t.name)}, so this one is {_words(renamed[t.name])}.")
        if renamed:
            trackers = [_rename(t, renamed) for t in trackers]
        return TrackersDraft(trackers=trackers, notes=notes)

    return run(store, tenant_id, llm, engine, "trackers", goal, TRACKERS_SYSTEM, user, check)


def _rename(t: ImportTracker, renamed: dict[str, str]) -> ImportTracker:
    update: dict[str, Any] = {"name": renamed.get(t.name, t.name)}
    if t.run_if is not None and t.run_if.tracker in renamed:
        update["run_if"] = t.run_if.model_copy(update={"tracker": renamed[t.run_if.tracker]})
    return t.model_copy(update=update)


# ── Conversations ─────────────────────────────────────────────────────────

CONVERSATIONS_SYSTEM = """\
You are alteria, the assistant inside aftercall. You turn raw transcripts into aftercall's
upload format, without changing what anyone said.

Answer with one JSON object:
{"calls": [{"external_id": "...", "started_at": "...", "transcript": [{"speaker": "agent", "text": "..."}]}],
 "warnings": ["..."]}

Rules:
- Copy every line's words exactly as written: no translating, summarising, correcting or
  dropping filler. Mixed languages stay mixed. Leave out only the speaker label and any
  timestamp in front of a line.
- Keep every line of every conversation, in order.
- "speaker": "agent" for the business side (a person or an AI agent); "caller" for the other
  side on a call, "customer" in a chat. If there are other people, keep their name as written
  and add a warning.
- Split conversations on headings, separators, or timestamps that start again.
- "external_id": an ID from a heading (like "Call 1042"), copied exactly; otherwise null.
  "started_at": a date or time given for the conversation, copied exactly; otherwise null.
  Never invent IDs, dates or agents.
- Add a warning, in one short sentence, for anything you weren't sure about (for example,
  "Conversation 3 had no speaker labels, so each line's speaker is a guess")."""


class Turn(BaseModel):
    speaker: str
    text: str


class ConvertedCall(BaseModel):
    external_id: str | None = None
    started_at: str | None = None
    agent_id: str | None = None
    agent_version: str | None = None
    transcript: list[Turn] | str


class ConversationsDraft(BaseModel):
    calls: list[ConvertedCall]
    warnings: list[str]
    # True when the input was already in the upload format and no model was used.
    passthrough: bool = False


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def as_upload(filename: str, raw: bytes) -> ConversationsDraft | None:
    """The input as it is, when it's already a valid upload file (no model needed)."""
    name = filename.lower()
    if not name.endswith((".json", ".jsonl", ".csv")):
        name = "input.json" if raw.lstrip()[:1] in (b"{", b"[") else ""
    if not name:
        return None
    try:
        calls = parse_upload(name, raw)
    except UploadError:
        return None
    return ConversationsDraft(
        calls=[ConvertedCall(**c.model_dump()) for c in calls],
        warnings=["This is already in the upload format, so it's unchanged."],
        passthrough=True,
    )


def convert_conversations(
    store: Store, tenant_id: str, llm: LLM, engine: Engine | None, text: str,
) -> ConversationsDraft:
    n_tokens = tokens.count(text)
    limit = get_settings().alteria_max_input_tokens
    if not text.strip():
        raise InputError("There's nothing to convert")
    if n_tokens > limit:
        raise InputError(f"This is {n_tokens:,} tokens; alteria converts up to {limit:,} at a time. "
                         "Split it into smaller parts.")
    source = _squash(text)
    source_words = len(source.split())

    def check(data: dict[str, Any]) -> ConversationsDraft:
        raw_calls = data.get("calls")
        if not isinstance(raw_calls, list) or not raw_calls:
            raise Invalid(['"calls" must be a non-empty list'])
        problems: list[str] = []
        calls: list[ConvertedCall] = []
        kept = 0
        for i, item in enumerate(raw_calls):
            try:
                call = ConvertedCall.model_validate(item)
                CallIn.model_validate(call.model_dump())  # the upload's own check
            except ValidationError as exc:
                problems += _problems(exc, f"calls[{i}]")
                continue
            for field in ("external_id", "started_at", "agent_id", "agent_version"):
                value = getattr(call, field)
                if value and _squash(value) not in source:
                    problems.append(f"calls[{i}].{field}: not in the input; never invent it (use null)")
            turns = call.transcript if isinstance(call.transcript, list) else [Turn(speaker="", text=call.transcript)]
            for j, turn in enumerate(turns):
                if _squash(turn.text) not in source:
                    problems.append(f"calls[{i}].transcript[{j}]: the text isn't copied word for word from the input")
                kept += len(turn.text.split())
            calls.append(call)
        if not problems and kept < MIN_KEPT * source_words:
            problems.append("Lines are missing: keep every line of every conversation")
        if problems:
            raise Invalid(problems)
        return ConversationsDraft(calls=calls, warnings=_notes(data, "warnings"))

    max_tokens = min(32_000, int(n_tokens * 1.5) + 1_000)
    return run(store, tenant_id, llm, engine, "conversations", text, CONVERSATIONS_SYSTEM,
               f"Transcripts:\n\n{text}", check, max_tokens)
