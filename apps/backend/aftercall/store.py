"""Every record aftercall keeps, in Firestore, or in memory for tests and local runs.

Records are pydantic models (`Doc` subclasses, in models.py), one Firestore collection each.
Routes and modules never touch Firestore directly; they go through `get_store()`:

    store = get_store()
    tracker = store.get(Tracker, tracker_id)
    store.put(tracker)
    rows = store.find(Call, ("project_id", "==", project.id), order_by="created_at", descending=True, limit=50)
    claimed = store.claim(Call, call_id, expect={"status": "queued"}, changes={"status": "running"})

Filters are (field, op, value) with Firestore's ops: == != < <= > >= in not-in array-contains array-contains-any.
Firestore has no joins or GROUP BY: denormalise what a page reads together, aggregate in Python.
"""

import copy
import threading
from collections.abc import Iterable, Sequence
from functools import lru_cache
from typing import Any, ClassVar, TypeVar

from pydantic import BaseModel, ConfigDict

from aftercall.config import get_settings

Filter = tuple[str, str, Any]
D = TypeVar("D", bound="Doc")


class Doc(BaseModel):
    """One document. `collection` names its Firestore collection; `id` is the document id."""

    model_config = ConfigDict(extra="ignore", validate_assignment=False)
    collection: ClassVar[str]

    id: str

    def data(self) -> dict[str, Any]:
        return self.model_dump(mode="python")


class Store:
    """The operations every backend provides. Subclasses implement the raw dict methods."""

    # Typed API, used by the app.

    def get(self, model: type[D], doc_id: str) -> D | None:
        data = self._get(model.collection, doc_id)
        return model.model_validate(data) if data is not None else None

    def put(self, doc: Doc) -> None:
        self._set(doc.collection, doc.id, doc.data())

    def put_many(self, docs: Iterable[Doc]) -> None:
        self._set_many([(d.collection, d.id, d.data()) for d in docs])

    def update(self, model: type[Doc], doc_id: str, **fields: Any) -> None:
        self._update(model.collection, doc_id, fields)

    def delete(self, model: type[Doc], doc_id: str) -> None:
        self._delete(model.collection, doc_id)

    def delete_where(self, model: type[Doc], *where: Filter) -> int:
        ids = [d["id"] for d in self._query(model.collection, where, None, False, None, ["id"])]
        self._delete_many(model.collection, ids)
        return len(ids)

    def find(
        self,
        model: type[D],
        *where: Filter,
        order_by: str | None = None,
        descending: bool = False,
        limit: int | None = None,
        select: Sequence[str] | None = None,
    ) -> list[D]:
        """`select` reads only those fields (the model must default the rest): big fields stay on the server."""
        rows = self._query(model.collection, where, order_by, descending, limit, select)
        return [model.model_validate(d) for d in rows]

    def first(self, model: type[D], *where: Filter, order_by: str | None = None, descending: bool = False) -> D | None:
        found = self.find(model, *where, order_by=order_by, descending=descending, limit=1)
        return found[0] if found else None

    def count(self, model: type[Doc], *where: Filter) -> int:
        return self._count(model.collection, where)

    def claim(self, model: type[D], doc_id: str, expect: dict[str, Any], changes: dict[str, Any]) -> D | None:
        """Atomically apply `changes` if every field in `expect` still matches; the updated doc, else None."""
        data = self._claim(model.collection, doc_id, expect, changes)
        return model.model_validate(data) if data is not None else None

    # Raw backend methods.

    def _get(self, coll: str, doc_id: str) -> dict | None: raise NotImplementedError
    def _set(self, coll: str, doc_id: str, data: dict) -> None: raise NotImplementedError
    def _set_many(self, items: list[tuple[str, str, dict]]) -> None: raise NotImplementedError
    def _update(self, coll: str, doc_id: str, fields: dict) -> None: raise NotImplementedError
    def _delete(self, coll: str, doc_id: str) -> None: raise NotImplementedError
    def _delete_many(self, coll: str, ids: list[str]) -> None: raise NotImplementedError
    def _query(self, coll: str, where: Iterable[Filter], order_by: str | None, descending: bool, limit: int | None, select: Sequence[str] | None) -> list[dict]: raise NotImplementedError
    def _count(self, coll: str, where: Iterable[Filter]) -> int: raise NotImplementedError
    def _claim(self, coll: str, doc_id: str, expect: dict, changes: dict) -> dict | None: raise NotImplementedError


def _matches(value: Any, op: str, target: Any) -> bool:
    match op:
        case "==": return value == target
        case "!=": return value != target
        case "<": return value is not None and value < target
        case "<=": return value is not None and value <= target
        case ">": return value is not None and value > target
        case ">=": return value is not None and value >= target
        case "in": return value in target
        case "not-in": return value not in target
        case "array-contains": return isinstance(value, list) and target in value
        case "array-contains-any": return isinstance(value, list) and any(t in value for t in target)
    raise ValueError(f"unsupported filter op {op!r}")


def _sort_key(value: Any) -> tuple[bool, Any]:
    return (value is not None, value)


class MemoryStore(Store):
    """Dicts in a dict, with Firestore's semantics. For tests and running locally without GCP."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, dict]] = {}
        self._lock = threading.RLock()

    def _coll(self, coll: str) -> dict[str, dict]:
        return self._data.setdefault(coll, {})

    def _get(self, coll, doc_id):
        with self._lock:
            found = self._coll(coll).get(doc_id)
            return copy.deepcopy(found) if found is not None else None

    def _set(self, coll, doc_id, data):
        with self._lock:
            self._coll(coll)[doc_id] = copy.deepcopy(data)

    def _set_many(self, items):
        with self._lock:
            for coll, doc_id, data in items:
                self._set(coll, doc_id, data)

    def _update(self, coll, doc_id, fields):
        with self._lock:
            doc = self._coll(coll).get(doc_id)
            if doc is None:
                raise KeyError(f"{coll}/{doc_id} not found")
            doc.update(copy.deepcopy(fields))

    def _delete(self, coll, doc_id):
        with self._lock:
            self._coll(coll).pop(doc_id, None)

    def _delete_many(self, coll, ids):
        with self._lock:
            for doc_id in ids:
                self._coll(coll).pop(doc_id, None)

    def _query(self, coll, where, order_by, descending, limit, select):
        with self._lock:
            rows = [d for d in self._coll(coll).values() if all(_matches(d.get(f), op, v) for f, op, v in where)]
            if order_by:
                rows.sort(key=lambda d: _sort_key(d.get(order_by)), reverse=descending)
            rows = rows[:limit] if limit is not None else rows
            if select is not None:
                rows = [{k: d[k] for k in select if k in d} for d in rows]
            return copy.deepcopy(rows)

    def _count(self, coll, where):
        return len(self._query(coll, where, None, False, None, ["id"]))

    def _claim(self, coll, doc_id, expect, changes):
        with self._lock:
            doc = self._coll(coll).get(doc_id)
            if doc is None or any(doc.get(k) != v for k, v in expect.items()):
                return None
            doc.update(copy.deepcopy(changes))
            return copy.deepcopy(doc)


class FirestoreStore(Store):
    """Google Cloud Firestore (native mode). Credentials come from the environment (ADC on Cloud Run)."""

    BATCH_LIMIT = 500

    def __init__(self, project: str | None = None, database: str = "(default)") -> None:
        from google.cloud import firestore

        self._fs = firestore
        self._db = firestore.Client(project=project or None, database=database)

    def _ref(self, coll, doc_id):
        return self._db.collection(coll).document(doc_id)

    def _get(self, coll, doc_id):
        snap = self._ref(coll, doc_id).get()
        return snap.to_dict() if snap.exists else None

    def _set(self, coll, doc_id, data):
        self._ref(coll, doc_id).set(data)

    def _set_many(self, items):
        for start in range(0, len(items), self.BATCH_LIMIT):
            batch = self._db.batch()
            for coll, doc_id, data in items[start : start + self.BATCH_LIMIT]:
                batch.set(self._ref(coll, doc_id), data)
            batch.commit()

    def _update(self, coll, doc_id, fields):
        self._ref(coll, doc_id).update(fields)

    def _delete(self, coll, doc_id):
        self._ref(coll, doc_id).delete()

    def _delete_many(self, coll, ids):
        for start in range(0, len(ids), self.BATCH_LIMIT):
            batch = self._db.batch()
            for doc_id in ids[start : start + self.BATCH_LIMIT]:
                batch.delete(self._ref(coll, doc_id))
            batch.commit()

    def _build(self, coll, where):
        from google.cloud.firestore_v1.base_query import FieldFilter

        query = self._db.collection(coll)
        for field, op, value in where:
            query = query.where(filter=FieldFilter(field, op, value))
        return query

    def _query(self, coll, where, order_by, descending, limit, select):
        query = self._build(coll, where)
        if select is not None:
            query = query.select(list(select))
        if order_by:
            query = query.order_by(order_by, direction=self._fs.Query.DESCENDING if descending else self._fs.Query.ASCENDING)
        if limit is not None:
            query = query.limit(limit)
        return [snap.to_dict() for snap in query.stream()]

    def _count(self, coll, where):
        result = self._build(coll, where).count().get()
        return int(result[0][0].value)

    def _claim(self, coll, doc_id, expect, changes):
        ref = self._ref(coll, doc_id)

        @self._fs.transactional
        def run(transaction):
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                return None
            doc = snap.to_dict()
            if any(doc.get(k) != v for k, v in expect.items()):
                return None
            transaction.update(ref, changes)
            return {**doc, **changes}

        return run(self._db.transaction())


_override: Store | None = None


@lru_cache
def _configured(backend: str, project: str, database: str) -> Store:
    return FirestoreStore(project, database) if backend == "firestore" else MemoryStore()


def get_store() -> Store:
    """The app's store: STORE_BACKEND=firestore in production, memory otherwise (or what `use` set)."""
    if _override is not None:
        return _override
    s = get_settings()
    return _configured(s.store_backend, s.gcp_project, s.firestore_database)


def use(store: Store | None) -> None:
    """Swap the store (tests: `use(MemoryStore())`; `use(None)` restores the configured one)."""
    global _override
    _override = store
