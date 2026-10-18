"""A project's data version: it changes on every write that insights could notice, so a cached
list of conversations is only reused while nothing it was built from has changed.

Write the data first, then bump: a reader that sees the new version then also sees the new data.
"""

import logging
import threading
import time

from aftercall.models import Project
from aftercall.store import Store

log = logging.getLogger("aftercall.data_version")

_lock = threading.Lock()
_last = 0


def _next() -> int:
    """Microseconds since the epoch, and always above the last one this process gave (clocks can be
    coarse: Windows ticks every ~16 ms, so two bumps in a row could otherwise get the same value)."""
    global _last
    with _lock:
        _last = max(time.time_ns() // 1000, _last + 1)
        return _last


def bump(store: Store, project_id: str) -> None:
    """Give the project a new version. Never raises: a missed bump only leaves a cache entry to age out (30 s)."""
    try:
        store.update(Project, project_id, data_version=_next())
    except Exception:
        log.warning("couldn't bump data_version of project %s", project_id, exc_info=True)


COALESCE_SECONDS = 2.0
_recent: dict[str, float] = {}


def bump_coalesced(store: Store, project_id: str) -> None:
    """For calls finishing in bulk: at most one bump per project every COALESCE_SECONDS from this
    process, since Firestore sustains about one write a second on a document. The upload's last
    call always bumps (call_events), so insights catch up as soon as an upload is done."""
    now = time.monotonic()
    with _lock:
        if now - _recent.get(project_id, -COALESCE_SECONDS) < COALESCE_SECONDS:
            return
        _recent[project_id] = now
    bump(store, project_id)


def bump_all(store: Store, project_ids: set[str]) -> None:
    for project_id in sorted(project_ids):
        bump(store, project_id)
