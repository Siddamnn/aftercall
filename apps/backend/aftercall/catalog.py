"""Bulk import of trackers and their signals from one JSON file.

The format is the one in samples/trackers_booking.json: a list of trackers, or
{"trackers": [...]}. Each tracker is a TrackerSpec (name, description, optional run_if)
plus "signals": a list of SignalSpec. Parsing checks the whole file and reports every
problem with its place in the file, so a customer can fix it in one go.
"""

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aftercall.signals import SignalSpec, TrackerSpec

MAX_IMPORT_TRACKERS = 200


class ImportTracker(TrackerSpec):
    model_config = ConfigDict(extra="forbid")

    signals: list[SignalSpec] = Field(default_factory=list)


class CatalogError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def _where(loc: tuple[Any, ...]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out.lstrip(".")


def parse_trackers(raw: bytes | str | Any) -> list[ImportTracker]:
    """Raw file bytes, text, or already-decoded JSON → validated trackers. Raises CatalogError."""
    data = raw
    if isinstance(raw, (bytes, str)):
        try:
            data = json.loads(raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CatalogError([f"Not valid JSON: {exc}"]) from None
    if isinstance(data, dict) and isinstance(data.get("trackers"), list):
        data = data["trackers"]
    if not isinstance(data, list):
        raise CatalogError(['Expected a list of trackers, or {"trackers": [...]}'])
    if not data:
        raise CatalogError(["The file has no trackers"])
    if len(data) > MAX_IMPORT_TRACKERS:
        raise CatalogError([f"At most {MAX_IMPORT_TRACKERS} trackers per file (got {len(data)})"])

    parsed: list[ImportTracker] = []
    errors: list[str] = []
    for i, item in enumerate(data):
        label = f"trackers[{i}]" + (f" ({item['name']!r})" if isinstance(item, dict) and isinstance(item.get("name"), str) else "")
        try:
            parsed.append(ImportTracker.model_validate(item))
        except ValidationError as exc:
            for e in exc.errors():
                where = _where(e["loc"])
                msg = e["msg"].removeprefix("Value error, ")
                errors.append(f"{label}{'.' + where if where else ''}: {msg}")

    seen: dict[str, int] = {}
    for i, c in enumerate(parsed):
        if c.name in seen:
            errors.append(f"trackers: {c.name!r} appears more than once")
        seen[c.name] = i
        names = [q.name for q in c.signals]
        errors += [f"{c.name}: signal {n!r} appears more than once" for n in sorted({n for n in names if names.count(n) > 1})]
    if errors:
        raise CatalogError(errors)
    return parsed


class ImportOut(BaseModel):
    dry_run: bool
    # Tracker names by what happened to them.
    created: list[str]
    updated: list[str]
    skipped: list[str]
    # Signal counts across the file.
    signals_created: int
    signals_updated: int  # a new version, because the spec changed
    signals_unchanged: int
