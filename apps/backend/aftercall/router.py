"""Pick the cheapest model tier that's enough for an alteria request, by asking Jev.

Jev reads the request and gives the probability that it's simple, standard or complex. The
request goes to the lowest tier whose cumulative probability reaches ALTERIA_ROUTE_CERTAINTY,
so when Jev is unsure the request rounds up to a stronger model. A routing call uses about
650 Jev tokens (about $0.00003); long requests are clipped before they're sent.
"""

from dataclasses import dataclass
from typing import Any

from aftercall import tokens
from aftercall.config import get_settings
from aftercall.jev import Engine, EngineError, normalize

TIERS = ("simple", "standard", "complex")

# What the model is asked to do, per alteria task, so Jev can judge the request against it.
TASKS = {
    "signal": "Write one signal (a yes/no, choice or score question about a customer conversation) "
              "from the user's question.",
    "trackers": "Design 1-4 trackers, each with 1-4 signals, for analysing customer conversations "
                "towards the user's goal.",
    "conversations": "Split raw conversation transcripts into separate conversations and label who "
                     "spoke each line, without changing any words.",
    "ask_plan": "Decide which tracked signals, filters and split answer a question about analysed "
                "customer conversations.",
    "ask_answer": "Answer a question about customer conversations in a few sentences, using only the "
                  "numbers given, and pick a chart for it.",
    "ask_dashboard": "Design or change a dashboard of charts from the tracked signals, as the user asks.",
}

CRITERIA: dict[str, Any] = {
    "simple": {
        "what": "A short, clear request with one obvious reading and a familiar pattern.",
        "examples": [
            "Did the caller ask for a refund?",
            "Track whether appointments get booked at my dental clinic",
            "A few conversations already labelled Agent: and Customer: line by line",
        ],
    },
    "standard": {
        "what": "Needs some judgement: several parts, a less common domain, options that must be "
                "worked out, or loosely formatted text with unclear speakers.",
        "not_for": "Anything with conflicting requirements, heavy ambiguity, or many constraints at once.",
        "examples": [
            "Why do customers cancel their subscription, and how angry are they?",
            "Understand collections calls: promises to pay, disputes and hardship",
            "A chat export mixing timestamps, system messages and two agents",
        ],
    },
    "complex": {
        "what": "Needs careful reasoning: many goals or constraints at once, vague or contradictory "
                "wording, a specialised or regulated domain, or very messy multi-speaker text in "
                "mixed languages.",
        "examples": [
            "Audit our insurance claims calls for compliance with 12 disclosure rules, and flag mis-selling",
            "Transcripts pasted from three tools, with no speaker labels, Hinglish, and calls running together",
        ],
    },
}

ROUTE_QUESTION = {
    "type": "choice",
    "instructions": "How capable a model does this request need to be done well? Judge the request "
                    "against the task, not the length of the text alone.",
    "criteria": CRITERIA,
}

ROUTE_INPUT_TOKENS = 1_200


@dataclass(frozen=True)
class Route:
    tier: str
    probabilities: dict[str, float] | None  # Jev's, per tier; None when Jev wasn't asked
    jev_tokens: int
    reason: str


def pick(probabilities: dict[str, float], certainty: float) -> str:
    """The lowest tier whose cumulative probability reaches `certainty`."""
    total = 0.0
    for tier in TIERS:
        total += probabilities.get(tier, 0.0)
        if total >= certainty:
            return tier
    return TIERS[-1]


def route(engine: Engine | None, task: str, request: str) -> Route:
    settings = get_settings()
    if engine is None:
        return Route(settings.alteria_default_tier, None, 0, "Jev isn't configured")
    state = f"Task: {TASKS[task]}\n\nRequest:\n{tokens.clip(request, ROUTE_INPUT_TOKENS)}"
    try:
        result = engine.evaluate(state, {"complexity": ROUTE_QUESTION})
        probs = normalize(result.answers["complexity"]).probabilities
    except (EngineError, KeyError) as exc:
        return Route(settings.alteria_default_tier, None, 0, f"Jev failed: {exc}")
    probs = {t: round(float(probs.get(t, 0.0)), 4) for t in TIERS}
    tier = pick(probs, settings.alteria_route_certainty)
    return Route(tier, probs, result.input_tokens, f"P({tier} or simpler) >= {settings.alteria_route_certainty}")
