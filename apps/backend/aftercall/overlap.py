"""Do two trackers overlap, or are they mutually exclusive? Jev answers yes/no per pair.

Every tracker's definition (description and active signals) is written into one text, and
Jev gets one yes_no question per pair of trackers: "do these two measure the same thing?".
Overlapping trackers are grouped (a group is every tracker connected by an overlap) and each
group gets a colour, so the UI can colour-code them.

Answers are cached per pair against a fingerprint of both definitions, so a pair is only asked
again after one of them changes. The tokens are recorded for us but **never billed to the
customer** and never counted in /usage.
"""

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from itertools import combinations
from typing import Any

from aftercall import tokens
from aftercall.jev import Engine, normalize
from aftercall.planner import is_over_limit, plan_requests
from aftercall.signals import SignalSpec, jev_key

# Distinct, readable on light and dark backgrounds. Groups beyond this reuse colours in order.
PALETTE = ["#E4572E", "#2E86AB", "#F2A541", "#76B041", "#9B5DE5", "#00A6A6", "#D1495B", "#8D6A9F"]

# The text sent to Jev says "categories" and "questions": plain words for the model, and Jev's own
# term for what it answers. The live check was run with this wording.
STATE_HEADER = (
    "These are the categories a company uses to analyse its voice-agent calls. Each category groups "
    "questions that are answered about every call.\n"
)


@dataclass(frozen=True)
class Definition:
    name: str
    description: str | None
    # (name, spec) of the tracker's active signals.
    signals: tuple[tuple[str, dict[str, Any]], ...]

    @property
    def fingerprint(self) -> str:
        body = json.dumps([self.name, self.description, list(self.signals)], sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(body.encode()).hexdigest()[:32]

    def describe(self) -> str:
        lines = [f'Category "{self.name}"' + (f": {self.description}" if self.description else "")]
        for name, spec in self.signals:
            criteria = spec.get("criteria")
            if isinstance(criteria, dict):
                options = "; ".join(f"{k} = {v}" for k, v in criteria.items())
            elif isinstance(criteria, list):
                options = "; ".join(f"{i} = {v}" for i, v in enumerate(criteria))
            else:
                options = ""
            lines.append(f"  - {name} ({spec['type']}): {spec['instructions']}" + (f" Answers: {options}" if options else ""))
        return "\n".join(lines)


def pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def pair_signal(a: str, b: str) -> dict[str, Any]:
    spec = SignalSpec(
        name="overlap",
        type="yes_no",
        instructions=(
            f'Do the categories "{a}" and "{b}" overlap? They overlap if a question in one measures the same '
            f"thing about a call as a question in the other, or nearly the same, so one call would be counted "
            f"in both for the same reason. They are mutually exclusive if they look at different aspects of a call."
        ),
        criteria={
            "true": "They overlap: at least one question in each measures the same or nearly the same thing",
            "false": "Mutually exclusive: nothing in one measures what the other measures",
        },
    )
    return spec.to_jev()


@dataclass(frozen=True)
class PairResult:
    a: str
    b: str
    overlaps: bool
    probability: float  # p(yes, they overlap)
    confidence: float
    model: str | None
    tokens_input: int  # this pair's share of the request
    cached: bool = False


def ask(engine: Engine, definitions: list[Definition], pairs: Iterable[tuple[str, str]],
        budget: int, max_signals: int) -> list[PairResult]:
    """Ask Jev about each pair. The state holds every definition, so any pair can be judged in any request."""
    pairs = list(pairs)
    if not pairs:
        return []
    state = STATE_HEADER + "\n\n".join(d.describe() for d in definitions)
    n_state = tokens.count(state)
    if is_over_limit(n_state, budget):
        raise ValueError(
            f"The definitions of these {len(definitions)} trackers are {n_state:,} tokens, over the "
            f"{budget:,}-token limit for one request. Check fewer trackers at a time."
        )
    wires = {jev_key(a, b): pair_signal(a, b) for a, b in pairs}
    by_key = {jev_key(a, b): (a, b) for a, b in pairs}
    groups = {"pairs": {k: tokens.signal_tokens(w) for k, w in wires.items()}}
    out: list[PairResult] = []
    for names in plan_requests(n_state, groups, budget, max_signals):
        result = engine.evaluate(state, {k: wires[k] for k in names})
        share = result.input_tokens // len(names)
        for k in names:
            norm = normalize(result.answers[k])
            a, b = by_key[k]
            out.append(PairResult(a, b, norm.value_text == "yes", float(norm.value_num), norm.confidence, result.model, share))
    return out


def colour_groups(names: Iterable[str], overlapping: Iterable[tuple[str, str]]) -> dict[str, dict[str, Any]]:
    """{tracker: {"group", "color", "overlaps_with"}} for every name. A tracker that overlaps
    nothing has group and color null. Groups are numbered in the order of `names`."""
    names = list(names)
    edges = {n: set() for n in names}
    for a, b in overlapping:
        if a in edges and b in edges:
            edges[a].add(b)
            edges[b].add(a)
    out: dict[str, dict[str, Any]] = {}
    group = 0
    for n in names:
        if n in out:
            continue
        if not edges[n]:
            out[n] = {"group": None, "color": None, "overlaps_with": []}
            continue
        group += 1
        stack, seen = [n], {n}
        while stack:
            for m in edges[stack.pop()] - seen:
                seen.add(m)
                stack.append(m)
        for m in seen:
            out[m] = {"group": group, "color": PALETTE[(group - 1) % len(PALETTE)],
                      "overlaps_with": sorted(edges[m], key=names.index)}
    return out


def all_pairs(names: list[str]) -> list[tuple[str, str]]:
    return [pair_key(a, b) for a, b in combinations(names, 2)]
