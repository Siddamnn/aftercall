"""Client for TypeSafe Jev (POST /v1/systemone) and answer normalization."""

import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

RETRY_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


class EngineError(Exception):
    pass


@dataclass(frozen=True)
class EngineResult:
    model: str
    answers: dict[str, dict[str, Any]]
    input_tokens: int
    output_tokens: int
    latency_ms: int


class Engine(Protocol):
    name: str

    def evaluate(self, state: str, questions: dict[str, dict[str, Any]]) -> EngineResult: ...


class JevClient:
    name = "jev"

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str = "https://api.typesafe.ai",
        timeout: float = 60.0,
        max_attempts: int = 5,
        http: httpx.Client | None = None,
    ):
        if not api_key:
            raise EngineError("TYPESAFE_API_KEY is not set")
        self.model = model
        self.max_attempts = max_attempts
        self._http = http or httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )

    def evaluate(self, state: str, questions: dict[str, dict[str, Any]]) -> EngineResult:
        body = {"state": state, "model": self.model, "questions": questions}
        last_error = ""
        for attempt in range(1, self.max_attempts + 1):
            started = time.monotonic()
            try:
                resp = self._http.post("/v1/systemone", json=body)
            except httpx.TransportError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            else:
                if resp.is_success:
                    data = resp.json()
                    usage = data.get("usage") or {}
                    return EngineResult(
                        model=data["model"],
                        answers=data["answers"],
                        input_tokens=usage.get("input_tokens", 0),
                        output_tokens=usage.get("output_tokens", 0),
                        latency_ms=int((time.monotonic() - started) * 1000),
                    )
                last_error = f"HTTP {resp.status_code}: {resp.text[:500]}"
                if resp.status_code not in RETRY_STATUSES:
                    raise EngineError(last_error)
                if retry_after := _retry_after(resp):
                    time.sleep(retry_after)
                    continue
            if attempt < self.max_attempts:
                time.sleep(min(0.5 * 2**attempt, 8.0))
        raise EngineError(f"gave up after {self.max_attempts} attempts; last error: {last_error}")


def _retry_after(resp: httpx.Response) -> float | None:
    try:
        return min(float(resp.headers["Retry-After"]), 30.0)
    except (KeyError, ValueError):
        return None


@dataclass(frozen=True)
class Normalized:
    value_text: str
    value_num: float | None
    probabilities: dict[str, float]
    confidence: float


def normalize(answer: dict[str, Any]) -> Normalized:
    """Bring every answer type onto one shape with a 0–1 confidence."""
    match answer["type"]:
        case "noul":
            p = float(answer["noul"])
            return Normalized("yes" if p >= 0.5 else "no", p, {"yes": p, "no": 1 - p}, abs(2 * p - 1))
        case "choice":
            return Normalized(answer["choice"], None, answer["probabilities"], float(answer["confidence"]))
        case "score":
            score = float(answer["score"])
            return Normalized(f"{score:.2f}", score, answer["probabilities"], float(answer["confidence"]))
    raise EngineError(f"unknown answer type: {answer['type']!r}")
