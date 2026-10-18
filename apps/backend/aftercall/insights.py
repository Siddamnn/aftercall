"""Insights over a project's conversations (B6–B11, B36): one scope, many views.

The scope parameters are shared by every view: from/to (dates, on started_at when it parses, else
when the call arrived), uploads, trackers, channel, agent_id, agent_version, meta.<key>,
where=<tracker>.<signal>:<value> and version=all|current. Only the latest run of each call counts,
and only calls that are done. Aggregation happens here in Python over the scoped conversations,
which is fine at today's sizes: Firestore has no GROUP BY. Each Call doc carries its latest run's
answers and totals (latest.py), so one scope is one query over Call docs, and the views are plain
Python over them. The list is cached for a few seconds per project data version (data_version.py).
"""

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from aftercall import billing
from aftercall.config import get_settings
from aftercall.errors import invalid
from aftercall import results
from aftercall.models import AnswerView, Call, Project, Signal, SignalVersion
from aftercall.results import answer_key
from aftercall.signals import SignalSpec
from aftercall.store import Store
from aftercall.ttl_cache import TTLCache

LIST_PARAMS = ("uploads", "trackers", "channel", "agent_id", "agent_version")
# Scope lists that filter on a call's own field ("trackers" only picks which signals to show).
CALL_FIELDS = {"uploads": "upload_id", "channel": "channel", "agent_id": "agent_id", "agent_version": "agent_version"}
WHERE = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*):(.+)$")
MAX_GROUPS = 20
MAX_VALUES = 50
MIN_MOVER_N = 30
CONFIDENCE_BINS = 10
CONVERSATIONS = "conversations"
SCOPE_CACHE_SECONDS = 30
# Most conversations held in the cache at once (all scopes together): memory is the limit on Cloud Run.
SCOPE_CACHE_MAX_CONVERSATIONS = 20_000
_scopes = TTLCache(SCOPE_CACHE_SECONDS, SCOPE_CACHE_MAX_CONVERSATIONS)


@dataclass(frozen=True)
class Where:
    tracker: str
    signal: str
    value: str

    def holds(self, a: AnswerView | None) -> bool:
        if a is None:
            return False
        if a.type != "score":
            return a.value_text == self.value
        op, _, number = self.value.partition(":")
        if op == "gte":
            return (a.value_num or 0) >= float(number)
        if op == "lte":
            return (a.value_num or 0) <= float(number)
        return answer_key(a) == self.value


@dataclass
class Scope:
    start: date | None = None
    end: date | None = None
    lists: dict[str, list[str]] = field(default_factory=dict)
    meta: dict[str, list[str]] = field(default_factory=dict)
    where: list[Where] = field(default_factory=list)
    version: str = "all"

    def previous(self) -> "Scope | None":
        """The same scope, shifted back by its own length."""
        if not (self.start and self.end):
            return None
        span = self.end - self.start + timedelta(days=1)
        return Scope(self.start - span, self.end - span, self.lists, self.meta, self.where, self.version)


def _split(values: list[str]) -> list[str]:
    return [v.strip() for item in values for v in item.split(",") if v.strip()]


def _date(text: str | None, name: str) -> date | None:
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        raise invalid(f"{name} must be a date like 2026-09-27") from None


def _where(text: str) -> Where:
    m = WHERE.match(text)
    if not m:
        raise invalid(f"{text!r} isn't <tracker>.<signal>:<value>")
    return Where(*m.groups())


def parse_scope(params: dict[str, list[str]]) -> Scope:
    """The scope from query parameters, as {name: [values]}."""
    one = {k: (v[0] if v else None) for k, v in params.items()}
    version = one.get("version") or "all"
    if version not in ("all", "current"):
        raise invalid("version is all or current")
    return Scope(
        start=_date(one.get("from"), "from"), end=_date(one.get("to"), "to"),
        lists={k: vs for k in LIST_PARAMS if (vs := _split(params.get(k, [])))},
        meta={k[5:]: vs for k in params if k.startswith("meta.") and (vs := _split(params[k]))},
        where=[_where(w) for w in params.get("where", [])], version=version,
    )


def query_scope(request) -> Scope:
    """The scope from a request's query string."""
    qp = request.query_params
    return parse_scope({k: qp.getlist(k) for k in qp})


def scope_from_dict(data: dict[str, Any]) -> Scope:
    """A scope sent as JSON (Ask alteria): the UI's InsightScope shape."""
    params: dict[str, list[str]] = {}
    for k in ("from", "to", "version"):
        if data.get(k):
            params[k] = [str(data[k])]
    for k in LIST_PARAMS:
        if data.get(k):
            params[k] = [",".join(map(str, data[k]))]
    for k, vs in (data.get("meta") or {}).items():
        params[f"meta.{k}"] = [",".join(vs)]
    params["where"] = list(data.get("where") or [])
    return parse_scope(params)


# ── Signals in scope ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SignalDef:
    tracker: str
    name: str
    spec: SignalSpec
    version: int
    signal_id: str = ""

    @property
    def ref(self) -> str:
        return f"{self.tracker}.{self.name}"

    def answer_keys(self) -> list[str]:
        if self.spec.type == "yes_no":
            return ["yes", "no"]
        if self.spec.type == "score":
            return [str(i) for i in range(len(self.spec.criteria))]
        return list(self.spec.criteria)

    def levels(self) -> dict[str, str] | None:
        if self.spec.type != "score":
            return None
        return {str(i): text.split(":")[0].strip() for i, text in enumerate(self.spec.criteria)}

    @property
    def threshold(self) -> float:
        return self.spec.review_threshold if self.spec.review_threshold is not None else get_settings().default_review_threshold


def signal_defs(store: Store, project: Project, trackers: list[str] | None = None) -> list[SignalDef]:
    """The project's active signals in its active trackers, in tracker then signal order."""
    found = store.find(Signal, ("project_id", "==", project.id), ("is_active", "==", True), ("tracker_active", "==", True))
    found.sort(key=lambda s: (s.tracker_seq, s.seq, s.created_at))
    return [SignalDef(s.tracker_name, s.name, SignalSpec.model_validate(s.active_spec), s.active_version or 1, s.id)
            for s in found if s.active_spec and (not trackers or s.tracker_name in trackers)]


def signal_def(store: Store, project: Project, ref: str) -> SignalDef:
    found = next((d for d in signal_defs(store, project) if d.ref == ref), None)
    if found is None:
        raise invalid(f"Unknown signal {ref!r}")
    return found


# ── Scoped conversations ─────────────────────────────────────────────────────


@dataclass
class Conv:
    """A done call in scope, with the answers of its latest run (both read off the Call doc)."""

    call: Call
    answers: dict[tuple[str, str], AnswerView]

    @property
    def day(self) -> date:
        return self.call.occurred_at.date()

    @property
    def conditions(self) -> dict[str, Any]:
        return self.call.latest_run.conditions if self.call.latest_run else {}

    @property
    def tokens(self) -> int:
        return self.call.latest_run.tokens_input if self.call.latest_run else 0


def _bounds(scope: Scope) -> tuple[datetime | None, datetime | None]:
    start = datetime.combine(scope.start, time.min, tzinfo=UTC) if scope.start else None
    end = datetime.combine(scope.end + timedelta(days=1), time.min, tzinfo=UTC) if scope.end else None
    return start, end


def _date_filters(scope: Scope) -> list[tuple[str, str, datetime]]:
    start, end = _bounds(scope)
    return ([("occurred_at", ">=", start)] if start else []) + ([("occurred_at", "<", end)] if end else [])


def _in_scope(call: Call, scope: Scope) -> bool:
    if call.deleted or not call.latest_run_id:
        return False
    if any(getattr(call, CALL_FIELDS[name]) not in values for name, values in scope.lists.items() if name in CALL_FIELDS):
        return False
    return all(call.meta.get(key) in values for key, values in scope.meta.items())


def _load(store: Store, project: Project, scope: Scope) -> list[Conv]:
    """Done calls in scope, newest first: one read per call, and nothing else. Needs calls(project_id, status, occurred_at)."""
    found = results.find_calls(store, ("project_id", "==", project.id), ("status", "==", "done"), *_date_filters(scope))
    calls = sorted((c for c in found if _in_scope(c, scope)), key=lambda c: (c.occurred_at, c.received_at, c.seq), reverse=True)
    return [Conv(c, {(a.tracker_name, a.signal_name): a for a in c.latest_answers}) for c in calls]


def _scope_key(scope: Scope) -> tuple:
    """What decides which calls are in scope. `trackers` (which signals to show) and `where` and
    `version` (applied to the answers afterwards) don't, so views that differ in them share a list."""
    return (scope.start, scope.end,
            tuple(sorted((name, tuple(sorted(values))) for name, values in scope.lists.items() if name in CALL_FIELDS)),
            tuple(sorted((key, tuple(sorted(values))) for key, values in scope.meta.items())))


def _scoped(store: Store, project: Project, scope: Scope) -> list[Conv]:
    """The scope's conversations, shared between the views of one page for a few seconds and re-read
    as soon as the project's data version moves. Callers must not change the list."""
    return _scopes.get_or_load(project.id, project.data_version, _scope_key(scope), lambda: _load(store, project, scope))


def clear_cache() -> None:
    _scopes.clear()


def conversations(store: Store, project: Project, scope: Scope) -> list[Conv]:
    """Done calls in scope, each with the answers of its latest run, after the `where` filters."""
    known = {d.ref for d in signal_defs(store, project)}
    if unknown := [f"{w.tracker}.{w.signal}" for w in scope.where if f"{w.tracker}.{w.signal}" not in known]:
        raise invalid(*[f"Unknown signal {u!r}" for u in unknown])
    return [v for v in _scoped(store, project, scope) if all(w.holds(v.answers.get((w.tracker, w.signal))) for w in scope.where)]


def _answer(v: Conv, d: SignalDef, scope: Scope) -> AnswerView | None:
    a = v.answers.get((d.tracker, d.name))
    if a is None or (scope.version == "current" and a.signal_version != d.version):
        return None
    return a


# ── Views ────────────────────────────────────────────────────────────────────


def _top(values: list[str | None]) -> tuple[list[str], bool]:
    ranked = [v for v, _ in Counter(v for v in values if v).most_common()]
    return ranked[:MAX_VALUES], len(ranked) > MAX_VALUES


def dimensions(store: Store, project: Project) -> dict[str, Any]:
    calls = [v.call for v in _scoped(store, project, Scope())]
    channels, cut = _top([c.channel for c in calls])
    agents, cut_agents = _top([c.agent_id for c in calls])
    metadata: dict[str, list[str]] = {}
    truncated = cut or cut_agents
    for key in _top([k for c in calls for k in (c.meta or {})])[0]:
        metadata[key], cut_values = _top([(c.meta or {}).get(key) for c in calls])
        truncated = truncated or cut_values
    days = sorted(c.occurred_at.date().isoformat() for c in calls)
    out = {
        "channels": channels,
        "agents": [{"agent_id": a, "versions": sorted(_top([c.agent_version for c in calls if c.agent_id == a])[0])} for a in agents],
        "metadata": metadata,
        "date_range": [days[0], days[-1]] if days else None,
    }
    return out | ({"truncated": True} if truncated else {})


def _distribution(convs: list[Conv], d: SignalDef, scope: Scope) -> dict[str, Any]:
    counts = dict.fromkeys(d.answer_keys(), 0)
    versions: Counter[str] = Counter()
    bins = [0] * CONFIDENCE_BINS
    not_run = answered = review = 0
    confidence = total = 0.0
    for v in convs:
        check = v.conditions.get(d.tracker)
        if check and not check.get("met"):
            not_run += 1
        a = _answer(v, d, scope)
        if a is None:
            continue
        answered += 1
        counts[answer_key(a)] = counts.get(answer_key(a), 0) + 1
        versions[str(a.signal_version)] += 1
        bins[min(CONFIDENCE_BINS - 1, int(a.confidence * CONFIDENCE_BINS))] += 1
        confidence += a.confidence
        review += a.needs_review
        if a.type == "score":
            total += a.value_num or 0
    return {
        "tracker": d.tracker, "signal": d.name, "type": d.spec.type, "versions": dict(versions),
        "current_version": d.version, "ran": len(convs) - not_run, "not_run": not_run, "answered": answered,
        "counts": counts, "mean": total / answered if d.spec.type == "score" and answered else None,
        "levels": d.levels(),
        "confidence": {"mean": confidence / answered if answered else 0.0, "bins": bins, "threshold": d.threshold},
        "needs_review": review, **_accuracy(convs, d, scope),
    }


def _accuracy(convs: list[Conv], d: SignalDef, scope: Scope) -> dict[str, Any]:
    """Measured accuracy from people's corrections (B12)."""
    reviewed = [a for v in convs if (a := _answer(v, d, scope)) is not None and a.review_value is not None]
    by_version: dict[str, list[bool]] = defaultdict(list)
    for a in reviewed:
        by_version[str(a.signal_version)].append(a.review_value == answer_key(a))
    agree = [ok for oks in by_version.values() for ok in oks]
    return {
        "reviewed": len(reviewed), "accuracy": sum(agree) / len(agree) if agree else None,
        "accuracy_by_version": {v: sum(oks) / len(oks) for v, oks in by_version.items()},
    }


def signals(store: Store, project: Project, scope: Scope) -> dict[str, Any]:
    convs = conversations(store, project, scope)
    defs = signal_defs(store, project, scope.lists.get("trackers"))
    answers = [a for v in convs for a in v.answers.values()]
    tokens = sum(v.tokens for v in convs)
    previous = scope.previous()
    return {
        "scope": {
            "calls": len(convs), "calls_previous": len(conversations(store, project, previous)) if previous else None,
            "answers": len(answers), "needs_review": sum(a.needs_review for a in answers),
            "tokens": tokens, "cost": billing.token_cost(tokens),
        },
        "signals": [_distribution(convs, d, scope) for d in defs],
    }


def _bucket(day: date, bucket: str) -> date:
    return day if bucket == "day" else day - timedelta(days=day.weekday())


def _empty_points(convs: list[Conv], scope: Scope, bucket: str) -> dict[date, dict[str, Any]]:
    today = datetime.now(UTC).date()
    first = scope.start or min((v.day for v in convs), default=today)
    last = scope.end or today
    step = timedelta(days=1 if bucket == "day" else 7)
    points, at = {}, _bucket(first, bucket)
    while at <= last:
        points[at] = {"start": at.isoformat(), "calls": 0, "answered": 0, "counts": {}, "mean": None, "needs_review": 0}
        at += step
    return points


def series(store: Store, project: Project, scope: Scope, ref: str | None, bucket: str) -> dict[str, Any]:
    convs = conversations(store, project, scope)
    d = signal_def(store, project, ref) if ref else None
    points = _empty_points(convs, scope, bucket)
    sums: Counter[date] = Counter()
    for v in convs:
        p = points.get(_bucket(v.day, bucket))
        if p is None:
            continue
        p["calls"] += 1
        a = _answer(v, d, scope) if d else None
        if a is None:
            continue
        p["answered"] += 1
        p["counts"][answer_key(a)] = p["counts"].get(answer_key(a), 0) + 1
        p["needs_review"] += a.needs_review
        sums[_bucket(v.day, bucket)] += a.value_num or 0
    if d and d.spec.type == "score":
        for at, p in points.items():
            p["mean"] = sums[at] / p["answered"] if p["answered"] else None
    first = min(points, default=None)
    events = _events(store, project, d, convs, first, scope.end) if first else []
    return {"signal": ref, "type": d.spec.type if d else None, "bucket": bucket, "points": list(points.values()), "events": events}


def _events(store: Store, project: Project, d: SignalDef | None, convs: list[Conv], first: date, last: date | None) -> list[dict[str, Any]]:
    """When the signal got a new version, and when each agent version first appeared."""
    events = []
    if d is not None:
        versions = store.find(SignalVersion, ("signal_id", "==", d.signal_id)) if d.signal_id else []
        events += [{"at": v.created_at.date().isoformat(), "kind": "signal_version", "label": f"v{v.version}"}
                   for v in versions if v.version > 1]
    seen: dict[str, date] = {}
    for v in convs:
        if v.call.agent_version:
            label = f"{v.call.agent_id or 'agent'} {v.call.agent_version}"
            seen[label] = min(seen.get(label, v.day), v.day)
    events += [{"at": at.isoformat(), "kind": "agent_version", "label": label} for label, at in seen.items() if at > first]
    return sorted((e for e in events if e["at"] >= first.isoformat() and (last is None or e["at"] <= last.isoformat())),
                  key=lambda e: e["at"])


def _group_of(store: Store, project: Project, by: str, scope: Scope):
    if by in ("channel", "agent_id", "agent_version"):
        return lambda v: getattr(v.call, by)
    if by == "upload":
        return lambda v: str(v.call.upload_id) if v.call.upload_id else None
    if by.startswith("meta."):
        return lambda v: (v.call.meta or {}).get(by[5:])
    other = signal_def(store, project, by)
    return lambda v: answer_key(a) if (a := _answer(v, other, scope)) else None


def breakdown(store: Store, project: Project, scope: Scope, ref: str | None, by: str) -> dict[str, Any]:
    convs = conversations(store, project, scope)
    d = signal_def(store, project, ref) if ref else None
    group_of = _group_of(store, project, by, scope)
    groups: dict[str, dict[str, Any]] = {}
    missing = 0
    for v in convs:
        key = group_of(v)
        if key is None:
            missing += 1
            continue
        g = groups.setdefault(key, {"key": key, "answered": 0, "counts": {}, "mean": None, "_sum": 0.0})
        a = _answer(v, d, scope) if d else None
        if d is None or a is not None:
            g["answered"] += 1
        if a is not None:
            g["counts"][answer_key(a)] = g["counts"].get(answer_key(a), 0) + 1
            g["_sum"] += a.value_num or 0
    ranked = sorted(groups.values(), key=lambda g: -g["answered"])
    for g in ranked:
        total = g.pop("_sum")
        g["mean"] = total / g["answered"] if d and d.spec.type == "score" and g["answered"] else None
    rest = ranked[MAX_GROUPS:]
    other_counts: Counter[str] = Counter()
    for g in rest:
        other_counts.update(g["counts"])
    other = {"answered": sum(g["answered"] for g in rest), "counts": dict(other_counts)}
    return {"signal": ref, "by": by, "groups": ranked[:MAX_GROUPS], "other": other, "missing": missing}


def _shares(convs: list[Conv], d: SignalDef, scope: Scope) -> tuple[int, Counter[str], float]:
    answered = [a for v in convs if (a := _answer(v, d, scope)) is not None]
    return len(answered), Counter(answer_key(a) for a in answered), sum(a.value_num or 0 for a in answered)


def _z(p1: float, n1: int, p2: float, n2: int) -> float:
    pooled = (p1 * n1 + p2 * n2) / (n1 + n2)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
    return (p1 - p2) / se if se else 0.0


def movers(store: Store, project: Project, scope: Scope, limit: int) -> dict[str, Any]:
    """Signal values that moved most against the previous period of the same length (B10)."""
    previous = scope.previous()
    if previous is None:
        raise invalid("from and to are both needed to compare with the period before")
    now, before = conversations(store, project, scope), conversations(store, project, previous)
    new_versions = sorted({v.call.agent_version for v in now if v.call.agent_version} - {v.call.agent_version for v in before if v.call.agent_version})
    rows = []
    for d in signal_defs(store, project, scope.lists.get("trackers")):
        n1, c1, _ = _shares(now, d, scope)
        n2, c2, _ = _shares(before, d, previous)
        if n1 < MIN_MOVER_N or n2 < MIN_MOVER_N:
            continue
        for value in d.answer_keys():
            p1, p2 = c1[value] / n1, c2[value] / n2
            rows.append({"tracker": d.tracker, "signal": d.name, "value": value, "share": p1, "share_previous": p2,
                         "answered": n1, "answered_previous": n2, "z": _z(p1, n1, p2, n2), "agent_versions": new_versions})
    rows.sort(key=lambda r: -abs(r["z"]))
    return {"period": _period(scope), "previous": _period(previous), "movers": rows[:limit]}


def _period(s: Scope) -> dict[str, str]:
    return {"from": s.start.isoformat(), "to": s.end.isoformat()}
