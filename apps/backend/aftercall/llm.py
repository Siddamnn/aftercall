"""Gemini, for alteria and transcription, through the google-genai SDK.

Vertex AI when GOOGLE_GENAI_USE_VERTEXAI is on (Cloud Run, service-account credentials), else an
AI Studio API key. Models are named per request with fallbacks: the first answers, and the next
is tried when it is down (429/5xx/timeouts, or the model isn't available to this project).
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

import httpx
from google import genai
from google.genai import errors, types

from aftercall.config import get_settings

log = logging.getLogger(__name__)

RETRY_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}
# The model itself isn't there (retired, or not enabled in this region): try the next one at once.
SKIP_STATUSES = {404}
ATTEMPTS_PER_MODEL = 2
DEFAULT_TIMEOUT_SECONDS = 90.0

# List prices in USD per 1M tokens (input, output) from ai.google.dev/gemini-api/docs/pricing,
# checked 2026-10-16. Estimates for the usage log: unknown models cost 0, and Flash 3.8 is the
# promotional price that doubles on 2027-01-01.
PRICE_PER_MTOK: dict[str, tuple[float, float]] = {
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.1-pro-preview": (2.00, 12.00),
}


class LLMError(Exception):
    pass


@dataclass(frozen=True)
class Completion:
    text: str
    model: str  # the model that answered (a fallback, if the first was down)
    input_tokens: int
    output_tokens: int
    cost_usd: float  # estimated from list prices (PRICE_PER_MTOK); 0 for unpriced models
    latency_ms: int


ThinkingLevel = types.ThinkingLevel


def thinking_config(level: ThinkingLevel | None) -> types.ThinkingConfig | None:
    """Gemini 3 thinks before it answers, and the thinking is billed as output. A level caps how much;
    None leaves the model's default (dynamic, high)."""
    return types.ThinkingConfig(thinking_level=level) if level is not None else None


class LLM(Protocol):
    def complete(
        self, system: str, user: str, models: list[str], max_tokens: int, thinking: ThinkingLevel | None = None
    ) -> Completion: ...


class GeminiClient:
    def __init__(
        self,
        client: genai.Client,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._client = client
        self.timeout = timeout
        self._sleep = sleep

    def complete(
        self, system: str, user: str, models: list[str], max_tokens: int, thinking: ThinkingLevel | None = None
    ) -> Completion:
        config = types.GenerateContentConfig(
            system_instruction=system, response_mime_type="application/json", max_output_tokens=max_tokens,
            thinking_config=thinking_config(thinking),
        )
        return self.generate(user, models, config)

    def generate(
        self, contents: Any, models: list[str], config: types.GenerateContentConfig, timeout: float | None = None
    ) -> Completion:
        """Try each model in order; raise LLMError when none answers."""
        if not models:
            raise LLMError("no Gemini model is configured")
        config = config.model_copy(
            update={"http_options": types.HttpOptions(timeout=int((timeout or self.timeout) * 1000))}
        )
        last_error = ""
        for model in models:
            try:
                return self._ask(model, contents, config)
            except _Unavailable as exc:
                last_error = f"{model}: {exc}"
                log.warning("gemini model unavailable, falling back: %s", last_error)
        raise LLMError(f"no model answered; last error: {last_error}")

    def _ask(self, model: str, contents: Any, config: types.GenerateContentConfig) -> Completion:
        for attempt in range(1, ATTEMPTS_PER_MODEL + 1):
            started = time.monotonic()
            try:
                response = self._client.models.generate_content(model=model, contents=contents, config=config)
            except errors.APIError as exc:
                if exc.code in SKIP_STATUSES:
                    raise _Unavailable(f"HTTP {exc.code}") from exc
                if exc.code not in RETRY_STATUSES:
                    raise LLMError(f"HTTP {exc.code}: {exc.message}") from exc
                failure = f"HTTP {exc.code}"
            except (httpx.TransportError, TimeoutError) as exc:
                failure = f"{type(exc).__name__}: {exc}"
            else:
                return _completion(response, model, int((time.monotonic() - started) * 1000))
            if attempt == ATTEMPTS_PER_MODEL:
                raise _Unavailable(failure)
            self._sleep(min(0.5 * 2**attempt, 8.0))
        raise AssertionError("unreachable")


class _Unavailable(Exception):
    """This model can't answer right now; the next one may."""


def _completion(response: Any, model: str, latency_ms: int) -> Completion:
    text = response.text
    if not text:
        reason = response.candidates[0].finish_reason if response.candidates else "no candidates"
        raise LLMError(f"empty answer (finish_reason={reason})")
    usage = response.usage_metadata
    input_tokens = (usage.prompt_token_count if usage else 0) or 0
    # Thinking tokens are billed as output.
    output_tokens = ((usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)) if usage else 0
    return Completion(
        text=text,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=_estimate_cost(model, input_tokens, output_tokens),
        latency_ms=latency_ms,
    )


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICE_PER_MTOK.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


def _split(models: str) -> list[str]:
    return [m.strip() for m in models.split(",") if m.strip()]


def tier_models(tier: str) -> list[str]:
    """The models for a router tier ('simple', 'standard', 'complex'), best first."""
    if tier not in ("simple", "standard", "complex"):
        raise ValueError(f"unknown tier: {tier}")
    return _split(getattr(get_settings(), f"gemini_models_{tier}"))


@lru_cache
def default_client() -> GeminiClient | None:
    """The Gemini client from settings, or None when neither Vertex AI nor an API key is configured."""
    s = get_settings()
    if s.google_genai_use_vertexai:
        return GeminiClient(genai.Client(vertexai=True, project=s.gcp_project or None, location=s.gemini_location))
    if s.gemini_api_key:
        return GeminiClient(genai.Client(api_key=s.gemini_api_key))
    return None
