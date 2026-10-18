"""Ask alteria (B39): answers about a project's conversations, with the conversations behind them
and a chart; and dashboards built by chat.

Every number comes from the data, never from the model:
1. plan: a model reads the question and picks the signals, filters and split that answer it;
2. facts: the backend counts them over the scope (insights.py, the same numbers as Insights);
3. answer: a model writes the answer from those facts and picks a chart. An answer with a
   number that isn't in the facts is rejected and asked again.
Both model steps go through alteria.run: routed by Jev, validated, a tier up when they fail.
"""

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from aftercall import alteria, insights
from aftercall.insights import CONVERSATIONS, Scope, SignalDef, Where
from aftercall.jev import Engine
from aftercall.llm import LLM
from aftercall.models import Project
from aftercall.results import answer_key
from aftercall.store import Store

CHART_KINDS = ("kpi", "donut", "bar", "column", "table", "line", "stacked", "compare", "heatmap", "confidence")
NEEDS_BY = {"compare", "heatmap"}
WIDE = {"line", "stacked", "compare", "heatmap"}
DIMENSIONS = ("channel", "agent_id", "agent_version")
MAX_CITATIONS = 5
MAX_GROUPS = 8
MAX_FOLLOW_UPS = 3
MAX_DASHBOARD_WIDGETS = 40
HISTORY_MESSAGES = 6
TITLE_CHARS = 44
SMALL_NUMBERS = {str(n) for n in range(11)}
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")

NO_SIGNALS = "This project has no signals yet, so there's nothing to count. Set up a tracker first, then ask again."
NO_CONVERSATIONS = ("There are no analysed conversations in this project for this period yet. Analyse some on "
                    "**Analyse calls**, or widen the time range, then ask again.")


@dataclass
class Plan:
    kind: str  # answer | dashboard | untracked
    metrics: list[str]
    by: str | None
    where: list[Where]
    title: str | None


@dataclass
class Asked:
    """Everything alteria needs about the project, loaded once per question."""

    store: Store
    project: Project
    llm: LLM
    engine: Engine | None
    scope: Scope
    defs: dict[str, SignalDef] = field(default_factory=dict)
    dims: dict[str, Any] = field(default_factory=dict)

    def run(self, task: str, request: str, system: str, user: str, check, max_tokens: int = 2_000):
        return alteria.run(self.store, self.project.tenant_id, self.llm, self.engine, task, request, system, user, check, max_tokens)


def _words(key: str) -> str:
    return key.replace("_", " ").capitalize()


def _catalog(asked: Asked) -> str:
    lines = []
    for d in asked.defs.values():
        answers = {"yes_no": "yes, no"}.get(d.spec.type) or ", ".join(
            f"{k}={v}" for k, v in (d.levels() or {k: k for k in d.answer_keys()}).items())
        lines.append(f"- {d.ref} ({d.spec.type}): {d.spec.instructions[:200]} Answers: {answers}")
    meta = ", ".join(f"meta.{k}" for k in asked.dims.get("metadata", {}))
    splits = ", ".join(DIMENSIONS) + (f", {meta}" if meta else "")
    return f"Signals:\n{chr(10).join(lines) or '(none)'}\n\nSplits: {splits}, or another signal's ref."


def _history(history: list[tuple[str, str]]) -> str:
    recent = history[-HISTORY_MESSAGES:]
    return "\n".join(f"{'User' if role == 'user' else 'alteria'}: {text[:600]}" for role, text in recent) or "(new chat)"


# ── Checks shared by the steps ───────────────────────────────────────────────


def _check_by(asked: Asked, by: Any, metric: str | None) -> str | None:
    if by in (None, ""):
        return None
    valid = by in DIMENSIONS or (isinstance(by, str) and by.startswith("meta.") and by[5:] in asked.dims.get("metadata", {}))
    if not (valid or (by in asked.defs and by != metric)):
        raise alteria.Invalid([f"by: {by!r} isn't a split you can use"])
    return by


def _check_where(asked: Asked, raw: Any) -> list[Where]:
    if not isinstance(raw, list):
        raise alteria.Invalid(['"where" must be a list like ["tracker.signal:value"]'])
    out, problems = [], []
    for text in raw:
        m = insights.WHERE.match(str(text))
        d = asked.defs.get(f"{m[1]}.{m[2]}") if m else None
        value = m[3] if m else ""
        ok = d is not None and (value in d.answer_keys() or (d.spec.type == "score" and re.match(r"^(gte|lte):\d+$", value)))
        if ok:
            out.append(Where(m[1], m[2], value))
        else:
            problems.append(f"where: {text!r} isn't a signal ref and one of its answers")
    if problems:
        raise alteria.Invalid(problems)
    return out


def widget(asked: Asked, raw: Any, widget_id: str) -> dict[str, Any]:
    """A chart the dashboards can draw, checked against the project's signals."""
    if not isinstance(raw, dict):
        raise alteria.Invalid(["each chart must be an object"])
    kind, metric = raw.get("kind"), raw.get("metric")
    if kind not in CHART_KINDS:
        raise alteria.Invalid([f"kind: {kind!r} isn't one of {', '.join(CHART_KINDS)}"])
    if metric != CONVERSATIONS and metric not in asked.defs:
        raise alteria.Invalid([f"metric: {metric!r} isn't a signal ref or {CONVERSATIONS!r}"])
    by = _check_by(asked, raw.get("by"), metric)
    if kind in NEEDS_BY and by is None:
        raise alteria.Invalid([f"a {kind} chart needs \"by\""])
    d = asked.defs.get(metric)
    if kind == "donut" and d is not None and d.spec.type == "yes_no":
        raise alteria.Invalid(["a donut isn't for yes/no signals: use a kpi with value \"yes\""])
    value = raw.get("value")
    if value is not None and (d is None or str(value) not in d.answer_keys()):
        raise alteria.Invalid([f"value: {value!r} isn't an answer of {metric}"])
    size = raw.get("size") if raw.get("size") in (1, 2, 3) else 3 if kind in WIDE else 2
    out = {"id": widget_id, "kind": kind, "metric": metric, "size": size}
    out |= {k: v for k, v in (("by", by), ("value", str(value) if value is not None else None), ("title", raw.get("title"))) if v}
    return out


def _follow_ups(data: dict[str, Any]) -> list[str]:
    raw = data.get("follow_ups") or []
    if not isinstance(raw, list) or not all(isinstance(q, str) for q in raw):
        raise alteria.Invalid(['"follow_ups" must be a list of short questions'])
    return raw[:MAX_FOLLOW_UPS]


# ── 1. Plan ─────────────────────────────────────────────────────────────────

PLAN_SYSTEM = """\
You are alteria, inside aftercall, which analyses customer conversations (calls and chats). You
don't answer the user's question: you plan how the data answers it.

Answer with one JSON object:
{"kind": "answer" | "dashboard" | "untracked",
 "metrics": ["<signal ref>" or "conversations", ...],   // 1-3, most relevant first
 "by": null or a split,                                    // when the question compares groups
 "where": ["<signal ref>:<answer>", ...],                  // filters to the subset asked about
 "title": "a 2-6 word name for the chat"}

- "dashboard": the user asks to build, make or create a dashboard, or a dashboard draft is open
  and they ask to add, remove, rename or change charts in it.
- "untracked": none of the signals can answer it (for example it asks about something no signal
  covers). Don't stretch a signal to fit.
- "conversations" as a metric is volume: how many conversations.
- Only use refs, answers and splits from the lists given."""


def _plan(asked: Asked, question: str, history: list[tuple[str, str]], has_draft: bool) -> Plan:
    user = (f"{_catalog(asked)}\n\nA dashboard draft is open: {'yes' if has_draft else 'no'}\n\n"
            f"Chat so far:\n{_history(history)}\n\nQuestion:\n{question}")

    def check(data: dict[str, Any]) -> Plan:
        kind = data.get("kind")
        if kind not in ("answer", "dashboard", "untracked"):
            raise alteria.Invalid(['"kind" must be "answer", "dashboard" or "untracked"'])
        metrics = [m for m in data.get("metrics") or [] if m == CONVERSATIONS or m in asked.defs]
        if kind == "answer" and not metrics:
            raise alteria.Invalid(['"metrics" needs at least one signal ref from the list, or "conversations"'])
        first = next((m for m in metrics if m != CONVERSATIONS), None)
        title = data.get("title") if isinstance(data.get("title"), str) else None
        return Plan(kind, metrics[:3], _check_by(asked, data.get("by"), first), _check_where(asked, data.get("where") or []), title)

    return asked.run("ask_plan", question, PLAN_SYSTEM, user, check, max_tokens=800)


# ── 2. Facts ────────────────────────────────────────────────────────────────


def _percent(n: int, of: int) -> int:
    return round(100 * n / of) if of else 0


def _shares(d: SignalDef, counts: dict[str, int], answered: int) -> dict[str, Any]:
    names = d.levels() or {}
    return {names.get(k, k): {"count": n, "percent": _percent(n, answered)} for k, n in counts.items() if n}


def _signal_fact(d: SignalDef, dist: dict[str, Any]) -> dict[str, Any]:
    fact = {"answered": dist["answered"], "answers": _shares(d, dist["counts"], dist["answered"])}
    if dist["mean"] is not None:
        fact["mean"] = round(dist["mean"], 2)
    return fact


def _group_facts(asked: Asked, scope: Scope, metric: str | None, by: str) -> list[dict[str, Any]]:
    data = insights.breakdown(asked.store, asked.project, scope, metric, by)
    d = asked.defs.get(metric) if metric else None
    groups = []
    for g in data["groups"][:MAX_GROUPS]:
        row: dict[str, Any] = {"group": g["key"], "conversations" if d is None else "answered": g["answered"]}
        if d is not None:
            row["answers"] = _shares(d, g["counts"], g["answered"])
            if g["mean"] is not None:
                row["mean"] = round(g["mean"], 2)
        groups.append(row)
    return groups


def facts(asked: Asked, plan: Plan, total: int) -> tuple[dict[str, Any], Scope]:
    """The numbers that answer the plan, and the narrowed scope they're counted over."""
    scope = Scope(asked.scope.start, asked.scope.end, asked.scope.lists, asked.scope.meta, asked.scope.where + plan.where, asked.scope.version)
    data = insights.signals(asked.store, asked.project, scope)
    by_ref = {f"{s['tracker']}.{s['signal']}": s for s in data["signals"]}
    out: dict[str, Any] = {"conversations_in_period": total, "conversations_matching": data["scope"]["calls"],
                           "filters": [f"{w.tracker}.{w.signal}:{w.value}" for w in plan.where]}
    out["signals"] = {ref: _signal_fact(asked.defs[ref], by_ref[ref]) for ref in plan.metrics if ref in by_ref}
    if plan.by:
        metric = next((m for m in plan.metrics if m in asked.defs), None)
        out["split"] = {"by": plan.by, "of": metric or CONVERSATIONS, "groups": _group_facts(asked, scope, metric, plan.by)}
    return out, scope


def _why(conv: insights.Conv, refs: list[str], asked: Asked) -> str:
    parts = []
    for ref in refs:
        d = asked.defs.get(ref)
        a = conv.answers.get((d.tracker, d.name)) if d else None
        if a is not None:
            key = answer_key(a)
            parts.append(f"{_words(d.name)}: {key}" if d.spec.type == "yes_no" else _words((d.levels() or {}).get(key, key)))
    channel = [_words(conv.call.channel)] if conv.call.channel else []
    return " · ".join(dict.fromkeys(channel + parts)) or "In scope"


def citations(asked: Asked, plan: Plan, scope: Scope) -> list[dict[str, Any]]:
    """The conversations behind the answer: those with the most common answer of the first signal
    first, then the rest of the scope."""
    convs = insights.conversations(asked.store, asked.project, scope)
    metric = asked.defs.get(next((m for m in plan.metrics if m in asked.defs), ""))
    if metric is not None:
        keys = Counter(answer_key(a) for v in convs if (a := v.answers.get((metric.tracker, metric.name))))
        top = keys.most_common(1)[0][0] if keys else None
        typical = [v for v in convs if (a := v.answers.get((metric.tracker, metric.name))) and answer_key(a) == top]
        convs = typical + [v for v in convs if v not in typical]
    refs = [f"{w.tracker}.{w.signal}" for w in plan.where] + ([metric.ref] if metric else [])
    return [{"call_id": v.call.id, "external_id": v.call.external_id, "why": _why(v, refs, asked)} for v in convs[:MAX_CITATIONS]]


# ── 3. Answer ───────────────────────────────────────────────────────────────

ANSWER_SYSTEM = f"""\
You are alteria, inside aftercall, which analyses customer conversations. Answer the user's
question from FACTS: counts over their analysed conversations.

Answer with one JSON object:
{{"text": "...", "chart": {{"kind": "...", "metric": "...", "by": "...", "value": "...", "title": "..."}},
  "follow_ups": ["...", "...", "..."]}}

- "text": 2-6 sentences, plain words, markdown-light (**bold**, and lines starting "- " for lists).
  Use only numbers that appear in FACTS (counts, percents, means). Never estimate, add up or invent one.
  Say what the numbers mean for the user, and if the data can't fully answer, say so.
- "chart": one chart that shows the answer. kind is one of {", ".join(CHART_KINDS)}. metric is a
  signal ref or "conversations". compare and heatmap need "by" (a split). A kpi or line on a
  yes/no or choice signal takes "value" (the answer to follow). A donut isn't for yes/no.
- "follow_ups": 3 short questions the user could ask next, answerable from the signals."""


def _allowed_numbers(*texts: str, data: Any) -> set[str]:
    found = set(SMALL_NUMBERS)
    for text in (*texts, json.dumps(data)):
        found |= {_normal(n) for n in NUMBER.findall(text)}
    return found


def _normal(number: str) -> str:
    n = number.replace(",", "")
    return n.rstrip("0").rstrip(".") if "." in n else n


def _answer(asked: Asked, question: str, history: list[tuple[str, str]], fact: dict[str, Any]) -> dict[str, Any]:
    allowed = _allowed_numbers(question, _history(history), data=fact)
    user = f"{_catalog(asked)}\n\nChat so far:\n{_history(history)}\n\nFACTS:\n{json.dumps(fact, indent=1)}\n\nQuestion:\n{question}"

    def check(data: dict[str, Any]) -> dict[str, Any]:
        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            raise alteria.Invalid(['"text" must be the answer'])
        if made_up := sorted({n for n in NUMBER.findall(text) if _normal(n) not in allowed}):
            raise alteria.Invalid([f"{', '.join(made_up)} isn't in FACTS: use only the numbers given"])
        chart = widget(asked, data.get("chart"), "ask")
        return {"text": text.strip(), "chart": chart, "follow_ups": _follow_ups(data)}

    return asked.run("ask_answer", question, ANSWER_SYSTEM, user, check)


# ── Dashboards by chat ──────────────────────────────────────────────────────

DASHBOARD_SYSTEM = f"""\
You are alteria, inside aftercall. You build a dashboard of charts from the project's signals,
or change the open draft as the user asks (add, remove, rename, resize).

Answer with one JSON object:
{{"name": "...", "description": "...", "widgets": [{{"kind": "...", "metric": "...", "by": "...",
  "value": "...", "size": 1 | 2 | 3, "title": "..."}}], "text": "...", "follow_ups": ["..."]}}

- kind is one of {", ".join(CHART_KINDS)}. metric is a signal ref or "conversations".
  compare and heatmap need "by". kpi and line on a yes/no or choice signal take "value".
  A donut isn't for yes/no. size is how many of 3 columns it spans.
- A new dashboard has 4-9 charts: a few kpi numbers first, then the charts that answer the goal.
- When changing a draft, keep every chart the user didn't ask to change, in the same order.
- "text": one or two sentences saying what you built or changed. No numbers from the data.
- "follow_ups": 3 short changes the user could ask for next."""


def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return all(a.get(k) == b.get(k) for k in ("kind", "metric", "by", "value"))


def dashboard(asked: Asked, question: str, draft: dict[str, Any] | None) -> dict[str, Any]:
    kept = (draft or {}).get("widgets") or []
    user = (f"{_catalog(asked)}\n\nOpen draft:\n{json.dumps(draft) if draft else '(none)'}\n\nRequest:\n{question}")

    def check(data: dict[str, Any]) -> dict[str, Any]:
        raw = data.get("widgets")
        if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_DASHBOARD_WIDGETS:
            raise alteria.Invalid([f'"widgets" must be a list of 1-{MAX_DASHBOARD_WIDGETS} charts'])
        widgets, problems = [], []
        for i, item in enumerate(raw):
            try:
                w = widget(asked, item, f"al{i + 1}")
            except alteria.Invalid as exc:
                problems += [f"widgets[{i}].{p}" for p in exc.problems]
                continue
            w["id"] = next((k["id"] for k in kept if _same(k, w)), w["id"])
            widgets.append(w)
        if problems:
            raise alteria.Invalid(problems)
        name = str(data.get("name") or (draft or {}).get("name") or "Dashboard")[:80]
        text = str(data.get("text") or f"Here's a draft {name} dashboard with {len(widgets)} charts.")
        return {"text": text, "citations": [], "follow_ups": _follow_ups(data),
                "dashboard": {"name": name, "description": data.get("description"), "widgets": _unique_ids(widgets)}}

    return asked.run("ask_dashboard", question, DASHBOARD_SYSTEM, user, check, max_tokens=3_000)


def _unique_ids(widgets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    for i, w in enumerate(widgets):
        if w["id"] in seen:
            w["id"] = f"al{i + 1}-{len(seen)}"
        seen.add(w["id"])
    return widgets


# ── The whole question ──────────────────────────────────────────────────────


def title_for(question: str) -> str:
    """The question, shortened, without its question mark: for when the plan gave no title."""
    t = re.sub(r"\s+", " ", question.strip()).rstrip("?.!")
    if len(t) > TITLE_CHARS:
        t = t[:TITLE_CHARS].rsplit(" ", 1)[0] + "…"
    return t[:1].upper() + t[1:]


def answer(asked: Asked, question: str, history: list[tuple[str, str]], draft: dict[str, Any] | None) -> tuple[dict[str, Any], str]:
    """The answer (AlteriaAnswer's shape, without the thread fields) and a title for a new chat."""
    asked.defs = {d.ref: d for d in insights.signal_defs(asked.store, asked.project)}
    asked.dims = insights.dimensions(asked.store, asked.project)
    if not asked.defs:
        return {"text": NO_SIGNALS, "citations": [], "follow_ups": []}, title_for(question)
    plan = _plan(asked, question, history, draft is not None)
    title = (plan.title or title_for(question))[:80]
    if plan.kind == "dashboard":
        return dashboard(asked, question, draft), title
    total = len(insights.conversations(asked.store, asked.project, asked.scope))
    if not total:
        return {"text": NO_CONVERSATIONS, "citations": [], "follow_ups": []}, title
    if plan.kind == "untracked":
        text = (f"None of your signals answers that directly, so I can't count it across {total:,} conversations yet. "
                "Track it as a signal, and every conversation from now on gets an answer you can chart.")
        return {"text": text, "citations": [], "follow_ups": [], "suggest_signal": question}, title
    fact, narrowed = facts(asked, plan, total)
    written = _answer(asked, question, history, fact)
    where = [f"{w.tracker}.{w.signal}:{w.value}" for w in plan.where]
    chart = {"widget": written["chart"]} | ({"where": where} if where else {})
    return {"text": written["text"], "citations": citations(asked, plan, narrowed), "chart": chart,
            "follow_ups": written["follow_ups"]}, title
