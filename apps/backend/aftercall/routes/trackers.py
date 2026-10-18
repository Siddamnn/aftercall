"""Trackers and signals, bulk import, and the overlap check. Everything is per project.

Trackers are parent groups (outcome, compliance, …); Choice / Yes-No / Score signals live under
them. An upload chooses which trackers run. A tracker can have a condition (`run_if`) on another
tracker's answer, and then runs only on calls where it holds.

A project's trackers and signals are read once (two queries) into a `ProjectState` and worked on in
memory. Signals carry copies of their tracker's fields and of their active version (see models.py);
every write here keeps those copies in step.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from aftercall import data_version, overlap, tokens
from aftercall.catalog import CatalogError, ImportOut, ImportTracker, parse_trackers
from aftercall.config import get_settings
from aftercall.deps import EngineDep, ProjectDep, StoreDep, Who, require
from aftercall.errors import invalid, not_found
from aftercall.jev import Engine, EngineError
from aftercall.models import (
    Answer,
    Project,
    Signal,
    SignalVersion,
    Tracker,
    TrackerOverlap,
)
from aftercall.signals import Condition, SignalSpec, TrackerSpec, condition_problem
from aftercall.store import Doc, Store



def _bump_data_version_after_edit(request: Request, project: ProjectDep, store: StoreDep) -> Iterator[None]:
    """Any tracker or signal edit that went through moves the project's data version (see data_version.py)."""
    yield
    if request.method not in ("GET", "HEAD"):
        data_version.bump(store, project.id)


router = APIRouter(dependencies=[Depends(_bump_data_version_after_edit)])
Editor = Annotated[Who, require("trackers.edit")]
IN_LIMIT = 30  # Firestore's cap on `in` values


class SignalOut(BaseModel):
    tracker: str
    name: str
    active: bool
    version: int
    # Tokens this signal adds to every request it's sent in (on top of the transcript).
    tokens: int
    spec: dict[str, Any]


class TrackerOut(BaseModel):
    name: str
    description: str | None
    active: bool
    # Runs only when this holds on another tracker's answer; null = always runs.
    run_if: dict[str, Any] | None
    # Tokens the tracker's active signals add to every call it runs on.
    signal_tokens: int
    signals: list[SignalOut]
    # From the last overlap check (/overlap), for the current definitions. Trackers that
    # overlap share a colour; null when it overlaps nothing or hasn't been checked.
    color: str | None = None
    overlaps_with: list[str] = []


def signal_out(q: Signal) -> SignalOut:
    spec = SignalSpec.model_validate(q.active_spec)
    return SignalOut(
        tracker=q.tracker_name, name=q.name, active=q.is_active, version=q.active_version or 0,
        tokens=tokens.signal_tokens(spec.to_jev()), spec=q.active_spec or {},
    )


def tracker_out(
    c: Tracker, signals: Iterable[Signal], include_inactive: bool = False, colours: dict[str, dict[str, Any]] | None = None,
) -> TrackerOut:
    shown = [signal_out(q) for q in signals if include_inactive or q.is_active]
    ov = (colours or {}).get(c.name, {})
    return TrackerOut(
        name=c.name, description=c.description, active=c.is_active, run_if=c.run_if,
        signal_tokens=sum(q.tokens for q in shown if q.active), signals=shown,
        color=ov.get("color"), overlaps_with=ov.get("overlaps_with", []),
    )


# ── A project's trackers and signals, in memory ──────────────────────────────


@dataclass
class ProjectState:
    project_id: str
    trackers: dict[str, Tracker]  # by name, creation order
    signals: dict[str, list[Signal]]  # by tracker id, creation order

    @classmethod
    def load(cls, store: Store, project_id: str) -> "ProjectState":
        found = sorted(store.find(Tracker, ("project_id", "==", project_id)), key=lambda c: (c.seq, c.created_at))
        signals: dict[str, list[Signal]] = {c.id: [] for c in found}
        for q in sorted(store.find(Signal, ("project_id", "==", project_id)), key=lambda q: (q.seq, q.created_at)):
            if q.tracker_id in signals:
                signals[q.tracker_id].append(q)
        return cls(project_id, {c.name: c for c in found}, signals)

    def of(self, tracker: Tracker) -> list[Signal]:
        return self.signals.get(tracker.id, [])

    def signal(self, tracker: Tracker, name: str) -> Signal | None:
        return next((q for q in self.of(tracker) if q.name == name), None)

    def new_tracker(self, project: Project, name: str, description: str | None) -> Tracker:
        seq = max((c.seq for c in self.trackers.values()), default=0) + 1
        c = Tracker(tenant_id=project.tenant_id, project_id=project.id, name=name, description=description, seq=seq)
        self.trackers[name] = c
        self.signals[c.id] = []
        return c

    def new_signal(self, project: Project, tracker: Tracker, name: str) -> Signal:
        seq = max((q.seq for q in self.of(tracker)), default=0) + 1
        q = Signal(
            tenant_id=project.tenant_id, project_id=project.id, tracker_id=tracker.id, tracker_name=tracker.name,
            tracker_active=tracker.is_active, tracker_seq=tracker.seq, name=name, seq=seq,
        )
        self.signals.setdefault(tracker.id, []).append(q)
        return q

    def dependents(self, tracker: str, signal: str | None = None) -> list[Tracker]:
        """Trackers whose condition is on this tracker (or on this one signal in it)."""
        return [
            c for c in self.trackers.values()
            if c.run_if and c.name != tracker and c.condition_tracker == tracker and signal in (None, c.condition_signal)
        ]

    def definitions(self) -> list[overlap.Definition]:
        """Active trackers with at least one active signal, in creation order."""
        out = []
        for c in self.trackers.values():
            specs = tuple((q.name, q.active_spec) for q in self.of(c) if q.is_active)
            if c.is_active and specs:
                out.append(overlap.Definition(c.name, c.description, specs))
        return out


class _Writes:
    """Docs to save together once every check has passed: one batch, so a refused edit saves nothing."""

    def __init__(self) -> None:
        self._docs: dict[tuple[str, str], Doc] = {}

    def add(self, *docs: Doc) -> None:
        for d in docs:
            self._docs[(d.collection, d.id)] = d

    def save(self, store: Store) -> None:
        store.put_many(self._docs.values())


def find_tracker(store: Store, project: Project, name: str) -> Tracker | None:
    return store.first(Tracker, ("project_id", "==", project.id), ("name", "==", name))


def _get_tracker(state: ProjectState, name: str) -> Tracker:
    c = state.trackers.get(name)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No tracker named {name!r}")
    return c


def _get_signal(state: ProjectState, tracker: Tracker, name: str) -> Signal:
    q = state.signal(tracker, name)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No signal named {name!r} in tracker {tracker.name!r}")
    return q


def _new_version(q: Signal, tracker: Tracker, spec: SignalSpec) -> SignalVersion:
    """The signal's next version, now its active one. Versions are numbered 1..active_version."""
    version = SignalVersion(
        signal_id=q.id, version=(q.active_version or 0) + 1, spec=spec.model_dump(exclude_none=True),
        tenant_id=q.tenant_id, project_id=q.project_id, tracker_name=tracker.name, signal_name=q.name,
    )
    q.activate(version)
    q.is_active = True
    return version


def _set_condition(c: Tracker, run_if: dict[str, Any] | None) -> None:
    c.run_if = run_if
    c.condition_tracker = run_if["tracker"] if run_if else None
    c.condition_signal = run_if["signal"] if run_if else None


def _set_active(state: ProjectState, c: Tracker, active: bool, writes: _Writes) -> None:
    """Turn a tracker on or off, and the copy of that on each of its signals."""
    c.is_active = active
    writes.add(c)
    for q in state.of(c):
        if q.tracker_active != active:
            q.tracker_active = active
            writes.add(q)


def _broken_conditions(state: ProjectState, tracker: str, name: str, spec: SignalSpec) -> list[str]:
    return [
        f"{c.name!r} runs only if {Condition.model_validate(c.run_if).describe()} ({problem})"
        for c in state.dependents(tracker, name)
        if (problem := condition_problem(Condition.model_validate(c.run_if), spec))
    ]


def _refuse_if_depended_on(deps: list[Tracker], what: str, action: str, force_hint: bool) -> None:
    if not deps:
        return
    described = "; ".join(f"{c.name!r} runs only if {Condition.model_validate(c.run_if).describe()}" for c in deps)
    hint = " Pass force=true to turn it off anyway; those trackers then won't run." if force_hint else ""
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        f"Can't {action} {what}: {described}. Change or remove those conditions first.{hint}",
    )


def _check_condition(state: ProjectState, name: str, cond: Condition | None) -> dict[str, Any] | None:
    """The condition must be on an existing signal in another tracker, with answers that
    signal can give, and must not loop back to this tracker."""
    if cond is None:
        return None
    parent = state.trackers.get(cond.tracker)
    signal = state.signal(parent, cond.signal) if parent is not None else None
    if parent is None or signal is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"run_if: no signal {cond.signal!r} in tracker {cond.tracker!r}")
    if problem := condition_problem(cond, SignalSpec.model_validate(signal.active_spec)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"run_if: {problem}")
    _refuse_loop(state, name, parent)
    return cond.model_dump()


def _refuse_loop(state: ProjectState, name: str, parent: Tracker) -> None:
    """Follow the chain of conditions up from the parent; reaching this tracker again is a loop."""
    seen, at = [name], parent
    while at is not None:
        if at.name in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"run_if: {' → '.join(repr(n) for n in [*seen, at.name])} would depend on each other",
            )
        seen.append(at.name)
        at = state.trackers.get(at.run_if["tracker"]) if at.run_if else None


def _render(store: Store, state: ProjectState, c: Tracker, include_inactive: bool = False) -> TrackerOut:
    return tracker_out(c, state.of(c), include_inactive, _colours(store, state))


@router.post("/trackers", status_code=status.HTTP_201_CREATED)
def create_tracker(spec: TrackerSpec, _: Editor, project: ProjectDep, store: StoreDep) -> TrackerOut:
    state = ProjectState.load(store, project.id)
    if spec.name in state.trackers:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Tracker {spec.name!r} exists; use PUT /trackers/{spec.name}")
    run_if = _check_condition(state, spec.name, spec.run_if)
    c = state.new_tracker(project, spec.name, spec.description)
    _set_condition(c, run_if)
    store.put(c)
    return _render(store, state, c)


@router.get("/trackers")
def list_trackers(project: ProjectDep, store: StoreDep, include_inactive: bool = False) -> list[TrackerOut]:
    state = ProjectState.load(store, project.id)
    colours = _colours(store, state)
    return [tracker_out(c, state.of(c), include_inactive, colours) for c in state.trackers.values() if include_inactive or c.is_active]


@router.get("/trackers/{tracker}")
def get_tracker(tracker: str, project: ProjectDep, store: StoreDep, include_inactive: bool = False) -> TrackerOut:
    state = ProjectState.load(store, project.id)
    return _render(store, state, _get_tracker(state, tracker), include_inactive)


@router.put("/trackers/{tracker}")
def update_tracker(tracker: str, spec: TrackerSpec, _: Editor, project: ProjectDep, store: StoreDep) -> TrackerOut:
    """Updates the description and condition, and reactivates the tracker. Trackers can't be
    renamed. Leaving out `run_if` removes the condition."""
    if spec.name != tracker:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Body name must match the URL; trackers can't be renamed")
    state = ProjectState.load(store, project.id)
    c = _get_tracker(state, tracker)
    run_if = _check_condition(state, tracker, spec.run_if)
    c.description = spec.description
    _set_condition(c, run_if)
    writes = _Writes()
    _set_active(state, c, True, writes)
    writes.save(store)
    return _render(store, state, c)


PermanentQuery = Annotated[bool, Query(description="Delete for good instead of turning off. Past answers are kept")]
ForceQuery = Annotated[bool, Query(description="Turn off even if other trackers' conditions depend on it")]


@router.delete("/trackers/{tracker}", response_model=None)
def delete_tracker(
    tracker: str, _: Editor, project: ProjectDep, store: StoreDep,
    permanent: PermanentQuery = False, force: ForceQuery = False,
) -> TrackerOut | Response:
    """Turns the tracker off: it stops running on new uploads, and its signals and past answers
    are kept. With permanent=true, deletes it and its signals for good (204); past answers are
    kept, and the name can be used again. Refused (409) while another tracker's condition is on it,
    unless force=true when only turning off."""
    state = ProjectState.load(store, project.id)
    c = _get_tracker(state, tracker)
    deps = state.dependents(tracker)
    if permanent:
        _refuse_if_depended_on(deps, f"tracker {tracker!r}", "delete", force_hint=False)
        remove_tracker(store, c)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    if not force:
        _refuse_if_depended_on(deps, f"tracker {tracker!r}", "turn off", force_hint=True)
    writes = _Writes()
    _set_active(state, c, False, writes)
    writes.save(store)
    return _render(store, state, c)


def remove_tracker(store: Store, c: Tracker) -> None:
    """Delete a tracker, its signals and versions, and its cached overlap answers."""
    _delete_signals(store, store.find(Signal, ("tracker_id", "==", c.id)))
    for row in store.find(TrackerOverlap, ("project_id", "==", c.project_id)):
        if c.name in (row.tracker_a, row.tracker_b):
            store.delete(TrackerOverlap, row.id)
    store.delete(Tracker, c.id)


def _chunks(items: list[str]) -> Iterator[list[str]]:
    for start in range(0, len(items), IN_LIMIT):
        yield items[start : start + IN_LIMIT]


def _delete_signals(store: Store, signals: list[Signal]) -> None:
    """Remove signals and their versions. Answers keep their names and version number."""
    version_ids = [SignalVersion.make_id(q.id, v) for q in signals for v in range(1, (q.active_version or 0) + 1)]
    for chunk in _chunks(version_ids):
        orphaned = store.find(Answer, ("signal_version_id", "in", chunk))
        for a in orphaned:
            a.signal_version_id = None
        store.put_many(orphaned)
    for q in signals:
        store.delete_where(SignalVersion, ("signal_id", "==", q.id))
        store.delete(Signal, q.id)


@router.post("/trackers/{tracker}/signals", status_code=status.HTTP_201_CREATED)
def create_signal(tracker: str, spec: SignalSpec, _: Editor, project: ProjectDep, store: StoreDep) -> SignalOut:
    state = ProjectState.load(store, project.id)
    c = _get_tracker(state, tracker)
    if state.signal(c, spec.name):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Signal {spec.name!r} exists in {tracker!r}; use PUT /trackers/{tracker}/signals/{spec.name}",
        )
    q = state.new_signal(project, c, spec.name)
    store.put_many([_new_version(q, c, spec), q])
    return signal_out(q)


@router.get("/trackers/{tracker}/signals")
def list_tracker_signals(tracker: str, project: ProjectDep, store: StoreDep, include_inactive: bool = False) -> list[SignalOut]:
    state = ProjectState.load(store, project.id)
    return [signal_out(q) for q in state.of(_get_tracker(state, tracker)) if include_inactive or q.is_active]


@router.get("/trackers/{tracker}/signals/{name}")
def get_signal(tracker: str, name: str, project: ProjectDep, store: StoreDep) -> SignalOut:
    state = ProjectState.load(store, project.id)
    return signal_out(_get_signal(state, _get_tracker(state, tracker), name))


@router.put("/trackers/{tracker}/signals/{name}")
def update_signal(tracker: str, name: str, spec: SignalSpec, _: Editor, project: ProjectDep, store: StoreDep) -> SignalOut:
    """Saves a new version; answers already stored keep pointing at the version that produced them."""
    if spec.name != name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Body name must match the URL; signals can't be renamed")
    state = ProjectState.load(store, project.id)
    c = _get_tracker(state, tracker)
    q = _get_signal(state, c, name)
    if broken := _broken_conditions(state, tracker, name, spec):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This edit would break conditions on {tracker}.{name}: {'; '.join(broken)}. Change those conditions first.",
        )
    store.put_many([_new_version(q, c, spec), q])
    return signal_out(q)


@router.delete("/trackers/{tracker}/signals/{name}", response_model=None)
def delete_signal(
    tracker: str, name: str, _: Editor, project: ProjectDep, store: StoreDep,
    permanent: PermanentQuery = False, force: ForceQuery = False,
) -> SignalOut | Response:
    """Turns the signal off, or with permanent=true deletes it and its versions for good (204).
    Past answers are kept, and the name can be used again (starting at version 1). Refused (409)
    while a condition is on this signal, unless force=true when only turning off."""
    state = ProjectState.load(store, project.id)
    q = _get_signal(state, _get_tracker(state, tracker), name)
    deps = state.dependents(tracker, name)
    if permanent:
        _refuse_if_depended_on(deps, f"signal {tracker}.{name}", "delete", force_hint=False)
        _delete_signals(store, [q])
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    if not force:
        _refuse_if_depended_on(deps, f"signal {tracker}.{name}", "turn off", force_hint=True)
    q.is_active = False
    store.put(q)
    return signal_out(q)


@router.get("/signals")
def list_signals(project: ProjectDep, store: StoreDep, include_inactive: bool = False) -> list[SignalOut]:
    """Every signal across trackers, flat. Read-only; manage signals under /trackers."""
    live = [] if include_inactive else [("is_active", "==", True), ("tracker_active", "==", True)]
    rows = store.find(Signal, ("project_id", "==", project.id), *live)
    return [signal_out(q) for q in sorted(rows, key=lambda q: (q.tracker_seq, q.seq))]


# ── Bulk import ────────────────────────────────────────────────────────────────


class OverlapPair(BaseModel):
    a: str
    b: str
    overlaps: bool  # yes = they overlap; no = mutually exclusive
    probability: float  # Jev's p(overlap)
    confidence: float
    cached: bool  # answered earlier for these same definitions, not asked again


class OverlapOut(BaseModel):
    # {tracker: {"group", "color", "overlaps_with"}}; group and color are null for a tracker
    # that overlaps nothing. Trackers in one group share a colour.
    trackers: dict[str, dict[str, Any]]
    pairs: list[OverlapPair]
    # Pairs with no answer for the current definitions (GET /overlap only; POST asks Jev about them).
    unchecked: list[list[str]] = []
    asked: int  # pairs Jev was asked about in this request
    # Overlap checks are free for the customer: not billed, not in /usage.
    billed: bool = False


class ImportResult(ImportOut):
    trackers: list[TrackerOut]
    # The overlap check run after importing; null when skipped (dry run, check_overlap=false, no Jev key).
    overlap: OverlapOut | None = None
    overlap_error: str | None = None


def _copied_trackers(store: Store, into: Project, from_project: str, names: list[str] | None) -> list[ImportTracker]:
    """Another project's trackers as an import file: active signals only, at their current spec."""
    source = store.get(Project, from_project)
    if source is None or source.tenant_id != into.tenant_id:
        raise not_found("Project")
    if source.id == into.id:
        raise invalid("Pick a different project to copy from")
    state = ProjectState.load(store, source.id)
    chosen = [c for c in state.trackers.values() if names is None or c.name in names]
    if not chosen:
        raise invalid("Pick at least one tracker to copy")
    return [
        ImportTracker(name=c.name, description=c.description, run_if=c.run_if,
                      signals=[SignalSpec.model_validate(q.active_spec) for q in state.of(c) if q.is_active])
        for c in chosen
    ]


async def _read_import(request: Request) -> list[ImportTracker]:
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        upload = (await request.form()).get("file")
        if upload is None or isinstance(upload, str):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, 'Send the JSON file in a form field named "file"')
        raw = await upload.read()
    else:
        raw = await request.body()
    try:
        return parse_trackers(raw)
    except CatalogError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": exc.errors}) from None


def _import_signals(
    state: ProjectState, project: Project, c: Tracker, item: ImportTracker, out: ImportOut, writes: _Writes,
) -> list[str]:
    """Creates or versions the item's signals in the tracker; returns conditions an edit would break."""
    errors: list[str] = []
    current = {q.name: q for q in state.of(c)}
    for spec in item.signals:
        q = current.get(spec.name)
        if q is None:
            q = state.new_signal(project, c, spec.name)
            writes.add(_new_version(q, c, spec), q)
            out.signals_created += 1
        elif q.is_active and q.active_spec == spec.model_dump(exclude_none=True):
            out.signals_unchanged += 1
        else:
            errors += [f"{item.name}.{spec.name}: this edit would break {b}"
                       for b in _broken_conditions(state, item.name, spec.name, spec)]
            writes.add(_new_version(q, c, spec), q)
            out.signals_updated += 1
    return errors


def _apply_import(
    state: ProjectState, project: Project, parsed: list[ImportTracker], on_conflict: str, out: ImportOut, writes: _Writes,
) -> list[Tracker]:
    """Works the file into `state` and `writes`; nothing is saved here, so any error leaves the project as it was."""
    if on_conflict == "fail" and (clash := [c.name for c in parsed if c.name in state.trackers]):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"errors": [f"Tracker {n!r} already exists; use on_conflict=skip or on_conflict=update" for n in clash]},
        )
    errors: list[str] = []
    touched: list[tuple[Tracker, ImportTracker]] = []
    for item in parsed:
        c = state.trackers.get(item.name)
        if c is not None and on_conflict == "skip":
            out.skipped.append(item.name)
            continue
        if c is None:
            c = state.new_tracker(project, item.name, item.description)
            out.created.append(item.name)
        else:
            c.description = item.description
            _set_active(state, c, True, writes)
            out.updated.append(item.name)
        writes.add(c)
        touched.append((c, item))
        errors += _import_signals(state, project, c, item, out, writes)
    # Conditions last, so they can point at trackers created earlier in the same file.
    for c, item in touched:
        try:
            _set_condition(c, _check_condition(state, item.name, item.run_if))
        except HTTPException as exc:
            errors.append(f"{item.name}: {exc.detail}")
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": errors})
    return [c for c, _ in touched]


def _import(
    store: Store, project: Project, parsed: list[ImportTracker], on_conflict: str, dry_run: bool,
) -> tuple[ImportResult, ProjectState, list[Tracker]]:
    state = ProjectState.load(store, project.id)
    out = ImportOut(dry_run=dry_run, created=[], updated=[], skipped=[], signals_created=0, signals_updated=0, signals_unchanged=0)
    writes = _Writes()
    touched = _apply_import(state, project, parsed, on_conflict, out, writes)
    colours = _colours(store, state)
    result = ImportResult(**out.model_dump(), trackers=[tracker_out(c, state.of(c), colours=colours) for c in touched])
    if not dry_run:
        writes.save(store)
    return result, state, touched


@router.post("/trackers/import", status_code=status.HTTP_201_CREATED)
async def import_trackers(
    request: Request, _: Editor, project: ProjectDep, store: StoreDep, engine: EngineDep,
    dry_run: Annotated[bool, Query(description="Only check the file: nothing is saved")] = False,
    on_conflict: Annotated[
        Literal["fail", "skip", "update"],
        Query(description="A tracker that already exists: fail the import (409), skip it, or update it from the file"),
    ] = "fail",
    check_overlap: Annotated[bool, Query(description="After importing, ask Jev which trackers overlap (not billed)")] = True,
    from_project: Annotated[str | None, Query(description="Copy trackers from this project of the workspace (no body)")] = None,
    trackers: Annotated[str | None, Query(description="With from_project: the trackers to copy, comma-separated")] = None,
) -> ImportResult:
    """Create many trackers and their signals from one JSON file, in the format of
    samples/trackers_booking.json: a list of {name, description?, run_if?, signals: [...]},
    or {"trackers": [...]}. Send it as the request body (application/json) or as a file
    (multipart, field "file"), or copy them from another project with from_project. All or
    nothing: if anything is wrong, nothing is saved and every problem is listed (422)."""
    if from_project:
        names = [n.strip() for n in trackers.split(",") if n.strip()] if trackers else None
        parsed = await run_in_threadpool(_copied_trackers, store, project, from_project, names)
    else:
        parsed = await _read_import(request)

    result, state, touched = await run_in_threadpool(_import, store, project, parsed, on_conflict, dry_run)
    if not dry_run and check_overlap:
        await _overlap_after_import(store, project, engine, result, state, touched)
    return result


async def _overlap_after_import(
    store: Store, project: Project, engine: Engine | None, result: ImportResult, state: ProjectState, touched: list[Tracker],
) -> None:
    if engine is None:
        result.overlap_error = "Overlap check skipped: TYPESAFE_API_KEY is not set"
        return
    try:
        result.overlap = await run_in_threadpool(_check_overlap, store, project, engine, state, None)
    except (EngineError, ValueError) as exc:
        result.overlap_error = f"Overlap check failed: {exc}. The trackers were imported; run POST /overlap to retry."
    colours = await run_in_threadpool(_colours, store, state)
    result.trackers = [tracker_out(c, state.of(c), colours=colours) for c in touched]


# ── Overlap (are trackers mutually exclusive?) ───────────────────────────────


Pair = tuple[str, str]


def _cached(store: Store, project_id: str, defs: list[overlap.Definition]) -> dict[Pair, TrackerOverlap]:
    """Stored answers that still apply: both trackers' definitions are unchanged since they were asked."""
    if len(defs) < 2:
        return {}
    fp = {d.name: d.fingerprint for d in defs}
    rows = store.find(TrackerOverlap, ("project_id", "==", project_id))
    return {(r.tracker_a, r.tracker_b): r for r in rows
            if fp.get(r.tracker_a) == r.fingerprint_a and fp.get(r.tracker_b) == r.fingerprint_b}


def _colour_groups(defs: list[overlap.Definition], cached: dict[Pair, TrackerOverlap]) -> dict[str, dict[str, Any]]:
    return overlap.colour_groups([d.name for d in defs], [p for p, r in cached.items() if r.overlaps])


def _colours(store: Store, state: ProjectState) -> dict[str, dict[str, Any]]:
    """Overlap colours from stored answers for the current definitions."""
    defs = state.definitions()
    return _colour_groups(defs, _cached(store, state.project_id, defs))


def _overlap_state(store: Store, project_id: str, state: ProjectState) -> tuple[dict[str, dict[str, Any]], dict[Pair, TrackerOverlap], list[Pair]]:
    """Colours from cached answers for the current definitions, the answers, and the pairs not yet checked."""
    defs = state.definitions()
    cached = _cached(store, project_id, defs)
    return _colour_groups(defs, cached), cached, [p for p in overlap.all_pairs([d.name for d in defs]) if p not in cached]


def _pair_out(r: TrackerOverlap, cached: bool) -> OverlapPair:
    return OverlapPair(a=r.tracker_a, b=r.tracker_b, overlaps=r.overlaps,
                       probability=round(r.probability, 4), confidence=round(r.confidence, 4), cached=cached)


def _check_overlap(store: Store, project: Project, engine: Engine, state: ProjectState, names: list[str] | None) -> OverlapOut:
    defs = state.definitions()
    chosen = [d.name for d in defs if names is None or d.name in names]
    cached = _cached(store, project.id, defs)
    missing = [p for p in overlap.all_pairs(chosen) if p not in cached]
    settings = get_settings()
    fp = {d.name: d.fingerprint for d in defs}
    fresh = []
    for r in overlap.ask(engine, [d for d in defs if d.name in chosen], missing,
                         settings.token_budget, settings.max_signals_per_request):
        row = TrackerOverlap(
            tenant_id=project.tenant_id, project_id=project.id, tracker_a=r.a, tracker_b=r.b, tracker_names=[r.a, r.b],
            fingerprint_a=fp[r.a], fingerprint_b=fp[r.b], overlaps=r.overlaps, probability=r.probability,
            confidence=r.confidence, model=r.model, tokens_input=r.tokens_input,
            jev_cost_usd=r.tokens_input * settings.jev_price_per_mtok_input / 1_000_000,
        )
        cached[(r.a, r.b)] = row
        fresh.append(row)
    store.put_many(fresh)
    asked = set(missing)
    pairs = [_pair_out(cached[p], p not in asked) for p in overlap.all_pairs(chosen) if p in cached]
    colours = _colour_groups(defs, cached)
    return OverlapOut(trackers={n: colours[n] for n in chosen}, pairs=pairs, asked=len(asked))


@router.get("/overlap")
def get_overlap(project: ProjectDep, store: StoreDep) -> OverlapOut:
    """Which trackers overlap, from answers already stored for the current definitions. Doesn't
    call Jev; pairs never checked (or changed since) are listed in `unchecked`."""
    colours, cached, unchecked = _overlap_state(store, project.id, ProjectState.load(store, project.id))
    return OverlapOut(trackers=colours, pairs=[_pair_out(r, True) for r in cached.values()],
                      unchecked=[list(p) for p in unchecked], asked=0)


@router.post("/overlap")
def check_overlap(
    _: Editor, project: ProjectDep, store: StoreDep, engine: EngineDep,
    trackers: Annotated[list[str] | None, Query(description="Only these trackers (comma-separate or repeat); default all")] = None,
) -> OverlapOut:
    """Ask Jev, yes or no per pair, whether active trackers overlap or are mutually exclusive, and
    colour-code the overlapping ones. Only pairs without an answer for their current definitions
    are sent. Free: never billed to the customer."""
    if engine is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The overlap check needs TYPESAFE_API_KEY on the server")
    state = ProjectState.load(store, project.id)
    names = None
    if trackers is not None:
        names = list(dict.fromkeys(n.strip() for item in trackers for n in item.split(",") if n.strip()))
        known = {d.name for d in state.definitions()}
        if unknown := [n for n in names if n not in known]:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": [
                f"Tracker {n!r} doesn't exist, is inactive, or has no active signals" for n in unknown]})
    try:
        return _check_overlap(store, project, engine, state, names)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    except EngineError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Jev failed: {exc}") from None
