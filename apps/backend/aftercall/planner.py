"""Split a call's signals into Jev requests.

Three things split a call into several requests, and every request carries the full transcript:
- **Stages.** A tracker with a condition (`run_if`) runs after the tracker it depends on, in a
  later request, and only if the condition holds.
- **The signal cap.** A request asks at most `max_signals` signals, so answer quality
  doesn't drop. A tracker's signals stay in the same request when they fit.
- **The token budget.** Signals that don't fit next to the transcript go to another request.
  Only this one makes a call "large" (flagged, with a multiplier), because it's the one that
  depends on the transcript's length.
"""

import math
from dataclasses import dataclass

from aftercall.tokens import REQUEST_OVERHEAD

# tracker → {jev key: signal tokens}
Groups = dict[str, dict[str, int]]


def is_over_limit(transcript_tokens: int, budget: int) -> bool:
    return transcript_tokens > budget


def plan_requests(transcript_tokens: int, groups: Groups, budget: int, max_signals: int) -> list[list[str]]:
    """First-fit decreasing over whole trackers, then over single signals.

    A tracker that fits in one request (under the cap and next to the transcript) is placed whole.
    One that doesn't is broken into its signals. A signal that can't fit next to the transcript
    even alone still gets its own request; the transcript itself is already known to be within budget.
    """
    room = budget - transcript_tokens - REQUEST_OVERHEAD
    items: list[dict[str, int]] = []
    for signals in groups.values():
        if len(signals) <= max_signals and sum(signals.values()) <= room:
            items.append(signals)
        else:
            items += [{k: t} for k, t in signals.items()]

    bins: list[dict[str, int]] = []
    for item in sorted(items, key=lambda i: (-sum(i.values()), -len(i), sorted(i))):
        size = sum(item.values())
        for b in bins:
            if len(b) + len(item) <= max_signals and sum(b.values()) + size <= room:
                b.update(item)
                break
        else:
            bins.append(dict(item))
    return [list(b) for b in bins]


def request_tokens(transcript_tokens: int, names: list[str], signal_tokens: dict[str, int]) -> int:
    return transcript_tokens + REQUEST_OVERHEAD + sum(signal_tokens[n] for n in names)


@dataclass(frozen=True)
class Estimate:
    """What running a call will use, before it runs. Billing uses Jev's reported tokens afterwards.

    With conditional trackers this is the most the call can use: a tracker whose condition
    doesn't hold isn't sent, and uses nothing.
    """

    requests: int
    tokens: int
    # The same call planned without the token budget (stages and the signal cap still apply).
    unsplit_requests: int
    unsplit_tokens: int

    @property
    def is_large(self) -> bool:
        """The token budget forced extra requests, each re-sending the transcript."""
        return self.requests > self.unsplit_requests

    @property
    def multiplier(self) -> float:
        return self.tokens / self.unsplit_tokens


def _plan_tokens(transcript_tokens: int, stages: list[Groups], budget: float, max_signals: int) -> tuple[int, int]:
    requests = tokens = 0
    for groups in stages:
        q_tokens = {k: t for g in groups.values() for k, t in g.items()}
        for names in plan_requests(transcript_tokens, groups, budget, max_signals):
            requests += 1
            tokens += request_tokens(transcript_tokens, names, q_tokens)
    return requests, tokens


def estimate(transcript_tokens: int, stages: list[Groups], budget: int, max_signals: int) -> Estimate | None:
    """None when the call is over the limit and won't be sent at all."""
    if is_over_limit(transcript_tokens, budget):
        return None
    requests, n_tokens = _plan_tokens(transcript_tokens, stages, budget, max_signals)
    unsplit_requests, unsplit_tokens = _plan_tokens(transcript_tokens, stages, math.inf, max_signals)
    return Estimate(requests, n_tokens, unsplit_requests, unsplit_tokens)
