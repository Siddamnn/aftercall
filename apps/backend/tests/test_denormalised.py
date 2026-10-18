"""What the cost work promises: insights and results read Call docs only, the copies on the call stay
in step with the Answer docs, and the in-process scope cache never outlives a write."""

import json
import threading
from collections import Counter

import pytest
from fastapi.testclient import TestClient
from test_insights import CALLS, add_call, add_signals, project  # noqa: F401

from aftercall import call_events, data_version, insights, latest, tasks, worker
from aftercall import store as store_module
from aftercall.api import app
from aftercall.config import get_settings
from aftercall.models import Answer, Call, Project, Run, Signal, Upload
from aftercall.store import MemoryStore
from aftercall.ttl_cache import TTLCache


class CountingStore(MemoryStore):
    """Counts the documents each collection hands back, the way Firestore bills reads."""

    def __init__(self) -> None:
        super().__init__()
        self.reads: Counter[str] = Counter()

    def _get(self, coll, doc_id):
        found = super()._get(coll, doc_id)
        self.reads[coll] += found is not None
        return found

    def _query(self, coll, where, order_by, descending, limit, select):
        rows = super()._query(coll, where, order_by, descending, limit, select)
        self.reads[coll] += len(rows)
        return rows


@pytest.fixture
def store():
    get_settings.cache_clear()
    counting = CountingStore()
    store_module.use(counting)
    insights.clear_cache()
    yield counting
    insights.clear_cache()
    store_module.use(None)


@pytest.fixture
def analysed(store, tenant, project):
    """The whole API over three done calls, written the way the worker leaves them (test_insights)."""
    add_signals(store, project)
    for row in CALLS:
        add_call(store, project, **row)
    with TestClient(app, headers={"X-API-Key": tenant.api_key}) as api:
        yield api


VIEWS = [("/insights/signals", {}), ("/insights/dimensions", {}), ("/calls", {}),
         ("/insights/series", {"signal": "experience.asked_for_human"}),
         ("/insights/breakdown", {"by": "channel", "signal": "experience.asked_for_human"})]


def test_insights_reads_call_docs_only_and_once_per_scope(analysed, store):
    store.reads.clear()
    for path, params in VIEWS:
        assert analysed.get(path, params=params).status_code == 200
    assert store.reads["answers"] == 0 and store.reads["runs"] == 0
    assert store.reads["calls"] == 3  # one read per call in scope, shared by every view


def test_a_different_scope_is_a_different_read(analysed, store):
    analysed.get("/insights/signals")
    store.reads.clear()
    analysed.get("/insights/signals", params={"channel": "chat"})
    assert store.reads["calls"] == 3 and store.reads["answers"] == 0
    store.reads.clear()
    # `where`, `trackers` and `version` only look at answers already read, so they share the cached list.
    analysed.get("/insights/signals", params={"where": "experience.asked_for_human:yes", "trackers": "sales", "version": "current"})
    assert store.reads["calls"] == 0


def test_a_review_shows_in_the_next_view(analysed):
    def reviewed() -> int:
        return next(s for s in analysed.get("/insights/signals").json()["signals"] if s["signal"] == "asked_for_human")["reviewed"]

    assert reviewed() == 0
    call = analysed.get("/calls").json()["calls"][0]["call_id"]
    path = f"/calls/{call}/answers/experience/asked_for_human/review"
    analysed.put(path, json={"value": "no"})
    assert reviewed() == 1
    analysed.delete(path)
    assert reviewed() == 0


def test_a_deleted_call_leaves_the_next_view(analysed):
    assert analysed.get("/insights/signals").json()["scope"]["calls"] == 3
    call = analysed.get("/calls").json()["calls"][0]["call_id"]
    assert analysed.delete(f"/calls/{call}").status_code == 204
    assert analysed.get("/insights/signals").json()["scope"]["calls"] == 2
    assert analysed.get("/calls").json()["total"] == 2


def test_tracker_and_signal_edits_move_the_data_version(analysed, store, project):
    def version() -> int:
        return store.get(Project, project.id).data_version

    seen = {version()}
    edits = [
        lambda: analysed.post("/trackers", json={"name": "extra"}),
        lambda: analysed.put("/trackers/extra", json={"name": "extra", "description": "d"}),
        lambda: analysed.delete("/trackers/extra", params={"permanent": True}),
    ]
    for edit in edits:
        assert edit().status_code in (200, 201, 204)
        assert version() not in seen
        seen.add(version())
    now = version()
    analysed.get("/trackers")
    assert version() == now  # reading leaves it alone


def test_a_refused_edit_leaves_the_data_version(analysed, store, project):
    before = store.get(Project, project.id).data_version
    assert analysed.post("/trackers", json={"name": "sales"}).status_code == 409
    assert store.get(Project, project.id).data_version == before


def test_bumping_an_unknown_project_never_raises(store):
    data_version.bump(store, "p-missing")


def test_bulk_finishes_bump_a_project_at_most_once_per_window(store, project, monkeypatch):
    clock = iter([100.0, 100.5, 101.9, 102.1])
    monkeypatch.setattr(data_version.time, "monotonic", lambda: next(clock))
    versions = []
    for _ in range(4):
        data_version.bump_coalesced(store, project.id)
        versions.append(store.get(Project, project.id).data_version)
    assert versions[0] == versions[1] == versions[2] < versions[3]


def test_bumps_in_a_row_never_repeat_a_version(store, project):
    store.put(project)
    seen = set()
    for _ in range(200):  # faster than a coarse clock ticks
        data_version.bump(store, project.id)
        seen.add(store.get(Project, project.id).data_version)
    assert len(seen) == 200


# ── The copies on the call ───────────────────────────────────────────────────


def test_the_call_carries_its_latest_run(analysed, store):
    call = store.first(Call, ("external_id", "==", "b"))
    assert [a.ref for a in call.latest_answers] == ["sales.outcome", "experience.asked_for_human", "experience.frustration"]
    run = store.get(Run, call.latest_run_id)
    assert (call.latest_run.tokens_input, call.latest_run.n_requests, call.latest_run.model) == (run.tokens_input, 1, "fake-1")
    assert call.latest_run.status == "done" and call.needs_review_count == 2


def test_review_keeps_the_copy_and_the_answer_doc_in_step(analysed, store):
    call = store.first(Call, ("external_id", "==", "b"))
    path = f"/calls/{call.id}/answers/experience/asked_for_human/review"
    analysed.put(path, json={"value": "yes"})
    copy = latest.find(store.get(Call, call.id), "experience", "asked_for_human")
    doc = store.get(Answer, Answer.make_id(call.latest_run_id, "experience", "asked_for_human"))
    assert copy.review_value == doc.review_value == "yes" and copy.reviewed_by == doc.reviewed_by is not None
    assert store.get(Call, call.id).needs_review_count == 1
    analysed.delete(path)
    copy = latest.find(store.get(Call, call.id), "experience", "asked_for_human")
    assert copy.review_value is None and store.get(Call, call.id).needs_review_count == 2


def test_two_reviewers_of_one_call_both_keep_their_correction(analysed, store):
    first = store.first(Call, ("external_id", "==", "b"))
    second = store.get(Call, first.id)  # read before the first review, so out of date after it
    latest.set_review(store, first, "experience", "asked_for_human", review_value="yes", reviewed_by="u1")
    latest.set_review(store, second, "experience", "frustration", review_value="2", reviewed_by="u2")
    saved = store.get(Call, first.id)
    assert latest.find(saved, "experience", "asked_for_human").review_value == "yes"
    assert latest.find(saved, "experience", "frustration").review_value == "2"
    assert saved.needs_review_count == 0


def test_erasing_a_call_drops_the_copies(analysed, store):
    call = store.first(Call, ("external_id", "==", "a"))
    analysed.delete(f"/calls/{call.id}")
    gone = store.get(Call, call.id)
    assert gone.deleted and gone.latest_answers == [] and gone.latest_run is None and gone.needs_review_count == 0


def test_deleting_a_signal_for_good_keeps_past_answers(analysed, store):
    before = analysed.get("/calls").json()
    assert analysed.delete("/trackers/experience/signals/frustration", params={"permanent": True}).status_code == 204
    assert store.first(Signal, ("name", "==", "frustration")) is None
    assert analysed.get("/calls").json() == before  # the copies hold names and versions, not signal ids
    assert all(a.signal_version_id is None for a in store.find(Answer, ("signal_name", "==", "frustration")))


def test_backfill_copies_the_latest_run_onto_older_calls(analysed, store):
    call = store.first(Call, ("external_id", "==", "b"))
    store.update(Call, call.id, latest_answers=[], latest_run=None, needs_review_count=0)
    assert analysed.get("/insights/signals").json()["scope"]["calls"] == 3  # the empty copy is what insights sees now
    assert latest.backfill(store) == 1
    healed = store.get(Call, call.id)
    assert {a.ref for a in healed.latest_answers} == {"sales.outcome", "experience.asked_for_human", "experience.frustration"}
    assert healed.latest_run.tokens_input == 200 and healed.needs_review_count == 2
    assert latest.backfill(store) == 0


# ── Through the worker and the upload ────────────────────────────────────────


def test_a_finishing_call_reaches_the_next_view_and_results_read_calls_only(store, tenant, fake_engine, monkeypatch):
    queued: list[str] = []
    monkeypatch.setattr(tasks, "enqueue_call", queued.append)
    with TestClient(app, headers={"X-API-Key": tenant.api_key}) as api:
        api.post("/trackers", json={"name": "experience"})
        api.post("/trackers/experience/signals", json={"name": "asked_for_human", "type": "yes_no", "instructions": "Did they ask?"})
        body = {"calls": [{"external_id": "x", "transcript": "caller: human please"}, {"external_id": "y", "transcript": "caller: hello"}]}
        files = {"file": ("c.json", json.dumps(body), "application/json")}
        upload_id = api.post("/uploads", files=files).json()["upload_id"]
        assert api.get("/insights/signals").json()["scope"]["calls"] == 0  # cached while nothing is done
        worker.run_call(store, fake_engine, queued.pop(0))
        assert api.get("/insights/signals").json()["scope"]["calls"] == 1
        worker.run_call(store, fake_engine, queued.pop(0))
        assert api.get("/insights/signals").json()["scope"]["calls"] == 2

        store.reads.clear()
        results = api.get(f"/uploads/{upload_id}/results").json()
        assert store.reads["answers"] == 0 and store.reads["runs"] == 0 and store.reads["calls"] == 2
        assert [r["answers"]["experience"]["asked_for_human"]["type"] for r in results] == ["yes_no", "yes_no"]
        assert results[0]["tokens"]["billed_input"] == 100 and results[0]["requests"] == 1 and results[0]["model"] == "fake-1"

        store.reads.clear()
        status = api.get(f"/uploads/{upload_id}").json()
        assert status["complete"] and status["counts"]["done"] == 2
        assert store.reads["calls"] == 0  # a finished upload shows its saved counts


def test_an_upload_without_a_person_still_saves_its_counts(store, tenant):
    upload = Upload(tenant_id=tenant.id, project_id="p-1", filename="a.json", created_by=None)
    call = Call(tenant_id=tenant.id, project_id="p-1", upload_id=upload.id, status="done", transcript="t", transcript_tokens=1)
    store.put_many([upload, call])
    call_events.finished(store, call, None)
    saved = store.get(Upload, upload.id)
    assert saved.finished_at is not None and saved.counts["done"] == 1


# ── The cache itself ─────────────────────────────────────────────────────────


class Clock:
    now = 0.0

    def __call__(self) -> float:
        return self.now


def test_entries_expire_after_the_ttl():
    clock, loads = Clock(), []
    cache = TTLCache(30, 100, clock)

    def load():
        loads.append(1)
        return [1, 2]

    cache.get_or_load("p", 1, "k", load)
    clock.now = 29.9
    cache.get_or_load("p", 1, "k", load)
    assert len(loads) == 1
    clock.now = 30.0
    cache.get_or_load("p", 1, "k", load)
    assert len(loads) == 2


def test_a_new_tag_drops_the_groups_older_entries_only():
    cache = TTLCache(30, 100)
    cache.get_or_load("p", 1, "a", lambda: [1])
    cache.get_or_load("p", 1, "b", lambda: [2])
    cache.get_or_load("other", 1, "a", lambda: [3, 3])
    cache.get_or_load("p", 2, "a", lambda: [4])
    assert len(cache) == 3  # p@1's two lists are gone; other@1 and p@2 stay
    loads = []
    cache.get_or_load("other", 1, "a", lambda: loads.append(1) or [])
    assert loads == []


def test_the_cache_is_bounded_by_items_and_skips_what_cannot_fit():
    cache = TTLCache(30, 5)
    cache.get_or_load("p", 1, "a", lambda: [0] * 3)
    cache.get_or_load("q", 1, "a", lambda: [0] * 3)
    assert len(cache) == 3  # the older list made room
    loads = []

    def too_big():
        loads.append(1)
        return [0] * 6

    cache.get_or_load("r", 1, "a", too_big)
    cache.get_or_load("r", 1, "a", too_big)
    assert len(loads) == 2 and len(cache) == 3  # too big to keep: loaded each time, nothing evicted


def test_readers_arriving_together_share_one_load():
    cache, loads, gate = TTLCache(30, 100), [], threading.Barrier(6)

    def slow():
        loads.append(1)
        threading.Event().wait(0.05)
        return [1]

    def reader():
        gate.wait()
        cache.get_or_load("p", 1, "k", slow)

    threads = [threading.Thread(target=reader) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(loads) == 1
