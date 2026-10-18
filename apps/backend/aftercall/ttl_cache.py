"""A small in-process cache of lists: short-lived, bounded, and loaded once however many readers ask.

Entries live in a *group* (a project) at a *tag* (its data version). Entries of a group at any other
tag are dropped the moment a newer one is stored, so a write that bumps the tag frees what it made stale.
"""

import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Hashable, Iterator
from contextlib import contextmanager
from typing import Any


class TTLCache:
    def __init__(self, ttl_seconds: float, max_items: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_seconds
        self._max_items = max_items
        self._clock = clock
        self._lock = threading.Lock()
        # (group, tag, key) -> (expires_at, items), oldest first.
        self._entries: OrderedDict[tuple[Hashable, Hashable, Hashable], tuple[float, list[Any]]] = OrderedDict()
        self._loading: dict[tuple[Hashable, Hashable, Hashable], list[Any]] = {}

    def get_or_load(self, group: Hashable, tag: Hashable, key: Hashable, load: Callable[[], list[Any]]) -> list[Any]:
        """The cached list, else `load()`'s, stored. Concurrent callers for one key share a single load.
        The list is shared: callers must not change it."""
        full = (group, tag, key)
        if (hit := self._hit(full)) is not None:
            return hit
        with self._single_flight(full):
            if (hit := self._hit(full)) is not None:
                return hit
            items = load()
            self._store(full, items)
            return items

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return sum(len(items) for _, items in self._entries.values())

    def _hit(self, full: tuple) -> list[Any] | None:
        with self._lock:
            found = self._entries.get(full)
            if found is None:
                return None
            if found[0] <= self._clock():
                del self._entries[full]
                return None
            self._entries.move_to_end(full)
            return found[1]

    def _store(self, full: tuple, items: list[Any]) -> None:
        if len(items) > self._max_items:
            return
        with self._lock:
            for stale in [f for f in self._entries if f[0] == full[0] and f[1] != full[1]]:
                del self._entries[stale]
            self._entries[full] = (self._clock() + self._ttl, items)
            self._entries.move_to_end(full)
            while sum(len(i) for _, i in self._entries.values()) > self._max_items:
                self._entries.popitem(last=False)

    @contextmanager
    def _single_flight(self, full: tuple) -> Iterator[None]:
        with self._lock:
            gate = self._loading.setdefault(full, [threading.Lock(), 0])
            gate[1] += 1
        try:
            with gate[0]:
                yield
        finally:
            with self._lock:
                gate[1] -= 1
                if gate[1] == 0:
                    del self._loading[full]
