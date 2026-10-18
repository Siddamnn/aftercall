"""Tracker and signal schema shared by the API, the worker and (later) the bench and UI.

Signals live under parent trackers (e.g. `outcome`, `compliance`). An upload picks which
trackers to run; every active signal in those trackers is sent to Jev. A tracker can
have a condition (`run_if`) on another tracker's answer: it then runs only when that holds.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SignalType = Literal["choice", "yes_no", "score"]

# Our public type names → Jev primitives.
JEV_TYPES: dict[str, str] = {"choice": "choice", "yes_no": "noul", "score": "score"}

MAX_CHOICE_OPTIONS = 255
MIN_SCORE_LEVELS, MAX_SCORE_LEVELS = 2, 10
_PLACEHOLDER = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")


NAME_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"


class Condition(BaseModel):
    """Run a tracker only if another tracker's signal answered a certain way.

    `in` / `not_in` take a list of choice options, or "yes" / "no" for a yes_no signal.
    `gte` / `lte` take a number for a score signal. An if/else is two trackers with
    opposite conditions on the same signal (e.g. `in ["declined"]` and `not_in ["declined"]`).
    """

    model_config = ConfigDict(extra="forbid")

    tracker: str = Field(pattern=NAME_PATTERN)
    signal: str = Field(pattern=NAME_PATTERN)
    op: Literal["in", "not_in", "gte", "lte"]
    value: list[str] | float

    @model_validator(mode="after")
    def _check_value(self) -> "Condition":
        if self.op in ("in", "not_in"):
            if not isinstance(self.value, list) or not self.value:
                raise ValueError(f'"{self.op}" needs value: a non-empty list of answers')
        elif isinstance(self.value, list):
            raise ValueError(f'"{self.op}" needs value: a number')
        return self

    def holds(self, value_text: str, value_num: float | None) -> bool:
        match self.op:
            case "in":
                return value_text in self.value
            case "not_in":
                return value_text not in self.value
            case "gte":
                return value_num is not None and value_num >= self.value
            case "lte":
                return value_num is not None and value_num <= self.value
        return False

    def describe(self) -> str:
        value = "[" + ", ".join(self.value) + "]" if isinstance(self.value, list) else f"{self.value:g}"
        op = {"in": "in", "not_in": "not in", "gte": ">=", "lte": "<="}[self.op]
        return f"{self.tracker}.{self.signal} {op} {value}"


def condition_problem(cond: Condition, spec: "SignalSpec") -> str | None:
    """Why the condition can't work on this signal, or None if it can."""
    allowed = {"choice": list(spec.criteria or []), "yes_no": ["yes", "no"]}.get(spec.type)
    if allowed is None:
        return None if cond.op in ("gte", "lte") else 'a score signal takes "gte" or "lte"'
    if cond.op not in ("in", "not_in"):
        return f'a {spec.type} signal takes "in" or "not_in"'
    if unknown := [v for v in cond.value if v not in allowed]:
        return (f"{cond.tracker}.{cond.signal} can't answer {', '.join(map(repr, unknown))}; "
                f"its answers are {', '.join(allowed)}")
    return None


class TrackerSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=NAME_PATTERN)
    description: str | None = Field(default=None, max_length=500)
    # Only run this tracker when the condition on another tracker's answer holds.
    run_if: Condition | None = None

    @model_validator(mode="after")
    def _check_name(self) -> "TrackerSpec":
        # "__" separates tracker and signal in Jev request keys (see jev_key).
        if "__" in self.name:
            raise ValueError('tracker names can\'t contain "__"')
        if self.run_if is not None and self.run_if.tracker == self.name:
            raise ValueError("a tracker's condition must be on another tracker")
        return self


def jev_key(tracker: str, signal: str) -> str:
    """The name a signal is sent to Jev under. Unique across trackers because tracker
    names can't contain "__"."""
    return f"{tracker}__{signal}"


class SignalSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=NAME_PATTERN)
    type: SignalType
    instructions: str = Field(min_length=1, max_length=2000)
    criteria: dict[str, str] | list[str] | None = None
    review_threshold: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def _check_criteria(self) -> "SignalSpec":
        match self.type:
            case "choice":
                if not isinstance(self.criteria, dict) or len(self.criteria) < 2:
                    raise ValueError("choice needs criteria: an object of at least 2 options, each with a description")
                if len(self.criteria) > MAX_CHOICE_OPTIONS:
                    raise ValueError(f"choice allows at most {MAX_CHOICE_OPTIONS} options")
                if "other" not in self.criteria:
                    raise ValueError('choice must include an "other" option')
                _require_descriptions(self.criteria)
            case "yes_no":
                if self.criteria is not None:
                    if not isinstance(self.criteria, dict) or not set(self.criteria) <= {"true", "false"}:
                        raise ValueError('yes_no criteria is optional; if given, only "true" and "false" keys')
                    _require_descriptions(self.criteria)
            case "score":
                if not isinstance(self.criteria, list):
                    raise ValueError("score needs criteria: an ordered list of level descriptions, lowest first")  # noqa: TRY004 (pydantic only reports ValueError)
                if not MIN_SCORE_LEVELS <= len(self.criteria) <= MAX_SCORE_LEVELS:
                    raise ValueError(f"score needs {MIN_SCORE_LEVELS}-{MAX_SCORE_LEVELS} levels")
                if any(not level.strip() for level in self.criteria):
                    raise ValueError("every score level needs a description")

        texts = [self.instructions, *_criteria_texts(self.criteria)]
        if unfilled := sorted({m for t in texts for m in _PLACEHOLDER.findall(t)}):
            raise ValueError(f"fill in placeholders before saving: {', '.join(unfilled)}")
        return self

    def to_jev(self) -> dict[str, Any]:
        """The signal as Jev takes it: one of the "questions" in a Jev request."""
        wire: dict[str, Any] = {"type": JEV_TYPES[self.type], "instructions": self.instructions}
        if self.criteria is not None:
            wire["criteria"] = self.criteria
        return wire


def _require_descriptions(criteria: dict[str, str]) -> None:
    missing = [key for key, desc in criteria.items() if not key.strip() or not desc.strip()]
    if missing:
        raise ValueError(f"every option needs a description; missing for: {', '.join(missing)}")


def _criteria_texts(criteria: dict[str, str] | list[str] | None) -> list[str]:
    if criteria is None:
        return []
    return list(criteria.values()) if isinstance(criteria, dict) else list(criteria)
