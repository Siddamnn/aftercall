"""Hand a queued call to the worker: a Cloud Task in production, a background thread without a queue.

With CLOUD_TASKS_QUEUE set, each call becomes an HTTP task that posts `{"call_id": ...}` to
`{TASK_SERVICE_URL}/tasks/run-call` with an OIDC token (routes/tasks.py checks it). Without a queue
(local runs, tests) the call runs in this process.
"""

import json
import logging
from concurrent.futures import Future, ThreadPoolExecutor, wait
from functools import lru_cache

from aftercall import worker
from aftercall.config import get_settings
from aftercall.store import get_store

log = logging.getLogger("aftercall.tasks")

RUN_CALL_PATH = "/tasks/run-call"
# Cloud Tasks gives a run this long before it retries; worker.STALE_AFTER is longer.
DISPATCH_DEADLINE_SECONDS = 600
ENQUEUE_THREADS = 16
LOCAL_THREADS = 4

_local = ThreadPoolExecutor(LOCAL_THREADS, thread_name_prefix="local-call")
_running: set[Future] = set()


def enqueue_call(call_id: str) -> None:
    if get_settings().cloud_tasks_queue:
        _create_cloud_task(call_id)
        return
    future = _local.submit(_run_local, call_id)
    _running.add(future)
    future.add_done_callback(_running.discard)


def enqueue_calls(call_ids: list[str]) -> list[str]:
    """Enqueue many at once (a big upload is hundreds of API calls); the ids that couldn't be queued."""
    def attempt(call_id: str) -> str | None:
        try:
            enqueue_call(call_id)
        except Exception:
            log.exception("couldn't queue call %s", call_id)
            return call_id
        return None

    with ThreadPoolExecutor(ENQUEUE_THREADS) as pool:
        return [failed for failed in pool.map(attempt, call_ids) if failed]


def wait_idle(timeout: float = 30.0) -> None:
    """Block until in-process runs have finished (tests; a no-op with a queue)."""
    wait(list(_running), timeout=timeout)


def _run_local(call_id: str) -> None:
    try:
        worker.run_call(get_store(), worker.default_engine(), call_id)
    except Exception:
        log.exception("call %s failed to run", call_id)


@lru_cache
def _client():
    from google.cloud import tasks_v2

    return tasks_v2.CloudTasksClient()


def _create_cloud_task(call_id: str) -> None:
    from google.cloud import tasks_v2
    from google.protobuf import duration_pb2

    s = get_settings()
    if not (s.task_service_url and s.task_invoker_email):
        raise RuntimeError("CLOUD_TASKS_QUEUE is set, so TASK_SERVICE_URL and TASK_INVOKER_EMAIL must be too")
    client = _client()
    parent = client.queue_path(s.gcp_project, s.cloud_tasks_location, s.cloud_tasks_queue)
    task = tasks_v2.Task(
        http_request=tasks_v2.HttpRequest(
            http_method=tasks_v2.HttpMethod.POST,
            url=f"{s.task_service_url.rstrip('/')}{RUN_CALL_PATH}",
            headers={"Content-Type": "application/json"},
            body=json.dumps({"call_id": call_id}).encode(),
            oidc_token=tasks_v2.OidcToken(service_account_email=s.task_invoker_email, audience=s.task_service_url),
        ),
        dispatch_deadline=duration_pb2.Duration(seconds=DISPATCH_DEADLINE_SECONDS),
    )
    client.create_task(request={"parent": parent, "task": task})
