"""Transcripts in any layout (B51): one adapter per format, each turning a file into raw rows.

A row is a dict in the upload's shape (external_id, transcript, channel, metadata, …); ingest.py
validates it. Adapters also say what they skipped and anything the customer should know.
Adding a format is one more adapter here, registered in ADAPTERS.
"""

import csv
import io
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import PurePath
from typing import Any

# Other names people give the upload's fields, in the order they're tried.
ALIASES: dict[str, tuple[str, ...]] = {
    "external_id": ("external_id", "id", "call_id", "conversation_id", "chat_id", "ticket_id", "session_id"),
    "transcript": ("transcript", "messages", "turns", "conversation", "dialogue", "text", "content", "body"),
    "started_at": ("started_at", "start_time", "started", "date", "timestamp", "created_at", "time"),
    "agent_id": ("agent_id", "agent", "bot", "bot_id", "assistant_id"),
    "agent_version": ("agent_version", "version", "bot_version"),
    "channel": ("channel", "source", "medium"),
}
# A CSV with none of these but a speaker and a text column has one row per message.
WHOLE_TRANSCRIPT = {"transcript", "messages", "turns", "conversation", "dialogue"}
TURN_TEXT = ("text", "message", "content", "utterance", "body")
TURN_SPEAKER = ("speaker", "role", "author", "from", "sender", "participant")
META_PREFIX = "meta."
SEPARATOR = re.compile(r"^\s*(-{3,}|={3,}|\*{3,})\s*$")
HEADING = re.compile(r"^\s*(?:#+\s*|(?:conversation|call|chat|transcript)\s*[#:-]?\s*)(?P<id>\S.{0,120}?)\s*$", re.IGNORECASE)
SPEAKER_LINE = re.compile(r"^\s*[\w .'()-]{1,40}:\s")
CUE_TIMING = re.compile(r"-->")
VOICE_TAG = re.compile(r"<v(?:\.[^ >]+)?\s+([^>]+)>")
TAG = re.compile(r"</?[^>]+>")
NO_SPEAKERS = "{name} has no speaker labels (like 'Agent: …'), so it's analysed as plain text."


class FormatError(ValueError):
    pass


@dataclass
class Read:
    """What an adapter made of a file."""

    rows: list[dict[str, Any]]
    adapter: str
    label: str
    skipped: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _pick(row: dict[str, Any], names: tuple[str, ...]) -> Any:
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    return next((lowered[n] for n in names if lowered.get(n) not in (None, "")), None)


def canonical(row: dict[str, Any]) -> dict[str, Any]:
    """A row with its fields under the upload's names, and meta.<key> columns folded into metadata."""
    out = {name: _pick(row, aliases) for name, aliases in ALIASES.items()}
    metadata = dict(row.get("metadata") or {}) if isinstance(row.get("metadata"), dict) else {}
    metadata |= {k[len(META_PREFIX):]: v for k, v in row.items() if isinstance(k, str) and k.startswith(META_PREFIX) and v not in (None, "")}
    if metadata:
        out["metadata"] = metadata
    return {k: v for k, v in out.items() if v is not None}


def _csv(name: str, text: str) -> Read:
    rows = list(csv.DictReader(io.StringIO(text)))
    header = {h.strip().lower() for h in (rows[0].keys() if rows else [])}
    if not header & WHOLE_TRANSCRIPT and header & set(TURN_TEXT) and header & set(TURN_SPEAKER):
        return Read(_group_turns(rows), "csv_turns", "CSV, one row per message")
    return Read([canonical(r) for r in rows], "csv", "CSV")


def _group_turns(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per message → one conversation per id, messages in file order."""
    grouped: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = str(_pick(r, ALIASES["external_id"]) or "")
        conv = grouped.setdefault(key, {**canonical(r), "transcript": [], **({"external_id": key} if key else {})})
        conv["transcript"].append({"speaker": _pick(r, TURN_SPEAKER) or "unknown", "text": _pick(r, TURN_TEXT) or ""})
    return list(grouped.values())


def _json(name: str, text: str) -> Read:
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FormatError(f"invalid JSON: {exc}") from None
    rows = next((doc[k] for k in ("calls", "conversations") if isinstance(doc, dict) and k in doc), doc)
    if not isinstance(rows, list):
        raise FormatError('JSON must be a list of calls or {"calls": [...]}')
    return Read([canonical(r) if isinstance(r, dict) else r for r in rows], "json", "JSON")


def _jsonl(name: str, text: str) -> Read:
    try:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    except json.JSONDecodeError as exc:
        raise FormatError(f"invalid JSONL: {exc}") from None
    return Read([canonical(r) if isinstance(r, dict) else r for r in rows], "jsonl", "JSON Lines")


def _blocks(lines: list[str]) -> list[tuple[int, list[str]]]:
    """Lines split on separator lines (---, ===, ***), each block with its first line number."""
    blocks, start, current = [], 1, []
    for n, line in enumerate(lines, start=1):
        if SEPARATOR.match(line):
            blocks.append((start, current))
            start, current = n + 1, []
        else:
            current.append(line)
    blocks.append((start, current))
    return blocks


def _text(name: str, text: str) -> Read:
    out = Read([], "text", "Plain text, Speaker: line")
    for line_no, block in _blocks(text.splitlines()):
        body = "\n".join(block).strip()
        if not body:
            out.skipped.append({"line": line_no, "reason": "Nothing between the separators"})
            continue
        first, _, rest = body.partition("\n")
        heading = HEADING.match(first) if not SPEAKER_LINE.match(first) and rest.strip() else None
        row = {"external_id": heading["id"], "transcript": rest.strip()} if heading else {"transcript": body}
        out.rows.append(row)
    if out.rows and not any(SPEAKER_LINE.match(ln) for r in out.rows for ln in r["transcript"].splitlines()):
        out.warnings.append(NO_SPEAKERS.format(name=name or "The text"))
    return out


def _cue_line(line: str) -> str:
    """A subtitle line as "Speaker: text": WebVTT's <v Speaker> tag becomes the label."""
    voice = VOICE_TAG.search(line)
    text = TAG.sub("", line).strip()
    return f"{voice[1].strip()}: {text}" if voice and text else text


def _subtitles(name: str, text: str, adapter: str, label: str) -> Read:
    """VTT and SRT: timing lines and cue numbers dropped, one conversation per file."""
    lines, skipped = [], []
    for n, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or CUE_TIMING.search(line) or line.isdigit() or line.upper().startswith(("WEBVTT", "NOTE", "STYLE")):
            continue
        cue = _cue_line(line)
        if cue:
            lines.append(cue)
        else:
            skipped.append({"line": n, "reason": "A cue with no words"})
    stem = PurePath(name).stem or None
    rows = [{"external_id": stem, "transcript": "\n".join(lines)}] if lines else []
    warnings = [] if any(SPEAKER_LINE.match(ln) for ln in lines) else [NO_SPEAKERS.format(name=name or "The file")]
    return Read(rows, adapter, label, skipped, warnings if rows else [])


ADAPTERS: dict[str, Callable[[str, str], Read]] = {
    ".csv": _csv,
    ".json": _json,
    ".jsonl": _jsonl,
    ".txt": _text,
    ".md": _text,
    ".vtt": lambda name, text: _subtitles(name, text, "vtt", "WebVTT captions"),
    ".srt": lambda name, text: _subtitles(name, text, "srt", "SRT subtitles"),
}


def read(filename: str, text: str) -> Read:
    adapter = ADAPTERS.get(PurePath(filename.lower()).suffix)
    if adapter is None:
        raise FormatError("file must be .csv, .json, .jsonl, .txt, .md, .vtt or .srt")
    return adapter(filename, text)
