"""Parse uploads in any layout (formats.py) into validated calls."""

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from aftercall import formats, transcribe
from aftercall.signals import NAME_PATTERN

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_AUDIO_BYTES = 30 * 1024 * 1024
AUDIO_EXTENSIONS = frozenset(transcribe.MIME_BY_EXTENSION)
MAX_METADATA_KEYS = 20
MAX_METADATA_VALUE = 255
MAX_CHANNEL = 32


class UploadError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors


class CallIn(BaseModel):
    # Unknown fields (e.g. a platform's own metadata) are ignored rather than rejected.
    model_config = ConfigDict(extra="ignore")

    external_id: str | None = None
    agent_id: str | None = None
    agent_version: str | None = None
    started_at: str | None = None
    # call, chat, email, voice_agent… (B6)
    channel: str | None = Field(default=None, max_length=MAX_CHANNEL)
    # The upload's own fields: rep, team, campaign… (B6)
    metadata: dict[str, str] = Field(default_factory=dict)
    transcript: str

    @field_validator("external_id", "agent_id", "agent_version", "started_at", mode="before")
    @classmethod
    def _stringify(cls, v: Any) -> str | None:
        return None if v in (None, "") else str(v)

    @field_validator("channel", mode="before")
    @classmethod
    def _lowercase(cls, v: Any) -> str | None:
        return None if v in (None, "") else str(v).strip().lower()

    @field_validator("metadata", mode="before")
    @classmethod
    def _flat_text(cls, v: Any) -> dict[str, str]:
        if not isinstance(v, dict):
            raise ValueError("metadata must be an object of text values")  # noqa: TRY004 (pydantic only reports ValueError)
        if len(v) > MAX_METADATA_KEYS:
            raise ValueError(f"metadata takes at most {MAX_METADATA_KEYS} keys")
        return dict(_metadata_item(k, value) for k, value in v.items())

    @field_validator("transcript", mode="before")
    @classmethod
    def _render(cls, v: Any) -> str:
        text = render_transcript(v)
        if not text.strip():
            raise ValueError("transcript is empty")
        return text


def _metadata_item(key: Any, value: Any) -> tuple[str, str]:
    key = str(key).strip().lower()
    if not re.fullmatch(NAME_PATTERN, key):
        raise ValueError(f"metadata key {key!r} must be lowercase letters, digits and _, starting with a letter")
    text = "" if value is None else str(value)
    if len(text) > MAX_METADATA_VALUE:
        raise ValueError(f"metadata.{key} is over {MAX_METADATA_VALUE} characters")
    return key, text


def render_transcript(value: Any) -> str:
    """Accept a plain string or a list of turns like {"speaker"|"role": ..., "text"|"content"|"message": ...}."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(_render_turn(turn) for turn in value).strip()
    raise ValueError("transcript must be a string or a list of turns")


def _render_turn(turn: Any) -> str:
    if isinstance(turn, str):
        return turn
    if isinstance(turn, dict):
        speaker = turn.get("speaker") or turn.get("role") or "unknown"
        text = turn.get("text") or turn.get("content") or turn.get("message") or ""
        return f"{speaker}: {text}"
    raise ValueError("each transcript turn must be a string or an object")


@dataclass
class Parsed:
    """A validated upload, and what the dry run shows about how it was read (B51)."""

    calls: list[CallIn]
    format: dict[str, Any]
    skipped: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def channels(self) -> dict[str, int]:
        return dict(Counter(c.channel for c in self.calls if c.channel).most_common())

    @property
    def metadata_keys(self) -> list[str]:
        return list(dict.fromkeys(k for c in self.calls for k in c.metadata))


def read_upload(filename: str, data: bytes) -> Parsed:
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadError([f"file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB"])
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise UploadError(["file must be UTF-8"]) from None
    try:
        found = formats.read(filename, text)
    except formats.FormatError as exc:
        raise UploadError([str(exc)]) from None
    if not found.rows:
        raise UploadError(["file contains no calls"])
    return Parsed(
        calls=_validate(found.rows),
        format={"adapter": found.adapter, "label": found.label, "confidence": 1.0},
        skipped=found.skipped, warnings=found.warnings,
    )


def _validate(rows: list[Any]) -> list[CallIn]:
    calls, errors = [], []
    for i, row in enumerate(rows, start=1):
        try:
            calls.append(CallIn.model_validate(row))
        except ValidationError as exc:
            detail = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'row'}: {e['msg']}" for e in exc.errors())
            errors.append(f"row {i}: {detail}")
    if errors:
        raise UploadError(errors)
    return calls


def is_audio(filename: str) -> bool:
    return PurePath(filename or "").suffix.lower() in AUDIO_EXTENSIONS


def check_audio(filename: str, content_type: str, data: bytes) -> str:
    """The recording's audio type; UploadError when it's empty or too large."""
    if not data:
        raise UploadError(["the recording is empty"])
    if len(data) > MAX_AUDIO_BYTES:
        raise UploadError([f"recording is larger than {MAX_AUDIO_BYTES // (1024 * 1024)} MB"])
    try:
        return transcribe.audio_mime_type(content_type, filename)
    except transcribe.TranscriptionError as exc:
        raise UploadError([str(exc)]) from None


def parse_upload(filename: str, data: bytes) -> list[CallIn]:
    return read_upload(filename, data).calls
