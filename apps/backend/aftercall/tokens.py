"""Token estimates for planning requests. Billing uses the counts Jev reports, not these."""

import json
from functools import lru_cache
from typing import Any

import tiktoken

# Jev adds a fixed prompt around every request and every question (signal); these margins are
# calibrated against usage.input_tokens (see scripts/smoke_test.py output).
REQUEST_OVERHEAD = 300
SIGNAL_OVERHEAD = 30


@lru_cache
def _encoding() -> tiktoken.Encoding:
    return tiktoken.get_encoding("cl100k_base")


def count(text: str) -> int:
    return len(_encoding().encode(text, disallowed_special=()))


def clip(text: str, max_tokens: int) -> str:
    """The start of the text, at most max_tokens long."""
    ids = _encoding().encode(text, disallowed_special=())
    return text if len(ids) <= max_tokens else _encoding().decode(ids[:max_tokens]) + " …"


def signal_tokens(jev_question: dict[str, Any]) -> int:
    """Tokens one signal adds to a Jev request, given its to_jev() form (a Jev "question")."""
    return count(json.dumps(jev_question, ensure_ascii=False)) + SIGNAL_OVERHEAD
