from datetime import timedelta

import pytest
from google.auth import exceptions as auth_exceptions
from google.oauth2 import id_token

from aftercall import llm, storage, tasks, transcribe, worker
from aftercall.config import get_settings
from aftercall.models import Call, Project, Signal, SignalVersion, Tracker, Upload, utcnow

SPEC = {"name": "asked_for_human", "type": "yes_no", "instructions": "Did the caller ask for a human?"}
INVOKER = "tasks@alteria.iam.gserviceaccount.com"
SERVICE_URL = "https://alteria-api.run.app"


@pytest.fixture
def project(store, tenant):
    return store.first(Project, ("tenant_id", "==", tenant.id))


@pytest.fixture
def tracker(store, tenant, project):
    """One tracker with one active yes/no signal, written the way the trackers routes write them."""
    t = Tracker(tenant_id=tenant.id, project_id=project.id, name="experience", seq=1)
    s = Signal(tenant_id=tenant.id, project_id=project.id, tracker_id=t.id, tracker_name=t.name,
               name=SPEC["name"], seq=1, tracker_seq=1)
    v = SignalVersion(signal_id=s.id, version=1, spec=SPEC)
    s.activate(v)
    store.put_many([t, s, v])
    return t


def queued_call(store, tenant, project, **fields) -> Call:
    call = Call(tenant_id=tenant.id, project_id=project.id, transcript="caller: mujhe human chahiye",
                transcript_tokens=8, trackers=["experience"], status="queued", **fields)
    store.put(call)
    return call


def upload_file(client, name="calls.json", body=b'{"calls":[{"external_id":"a","transcript":"caller: human please"}]}',
                mime="application/json", **params):
    return client.post("/uploads", params=params, files={"file": (name, body, mime)})


class TestInProcess:
    def test_enqueue_without_a_queue_runs_the_call(self, client, tracker, fake_engine, monkeypatch):
        monkeypatch.setattr(worker, "default_engine", lambda: fake_engine)
        body = upload_file(client).json()
        tasks.wait_idle()
        status = client.get(f"/uploads/{body['upload_id']}").json()
        assert status["complete"] and status["counts"]["done"] == 1
        result = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
        assert result["answers"]["experience"]["asked_for_human"]["value"] == "yes"

    def test_without_jev_the_call_fails_readably(self, client, tracker, monkeypatch):
        monkeypatch.setattr(worker, "default_engine", lambda: None)
        body = upload_file(client).json()
        tasks.wait_idle()
        result = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
        assert result["status"] == "failed" and "TYPESAFE_API_KEY" in result["message"]


class TestClaim:
    def test_a_redelivered_call_runs_once(self, store, tenant, project, tracker, fake_engine):
        call = queued_call(store, tenant, project)
        assert worker.run_call(store, fake_engine, call.id) is True
        assert worker.run_call(store, fake_engine, call.id) is False
        assert len(fake_engine.requests) == 1
        assert store.get(Call, call.id).status == "done"

    def test_a_call_being_run_is_not_taken(self, store, tenant, project, tracker, fake_engine):
        call = queued_call(store, tenant, project)
        assert worker.claim(store, call.id) is not None
        assert worker.run_call(store, fake_engine, call.id) is False
        assert fake_engine.requests == []

    def test_a_dead_tasks_call_is_taken_over(self, store, tenant, project, tracker, fake_engine):
        call = queued_call(store, tenant, project)
        worker.claim(store, call.id)
        store.update(Call, call.id, updated_at=utcnow() - worker.STALE_AFTER - timedelta(minutes=1))
        assert worker.run_call(store, fake_engine, call.id) is True
        assert store.get(Call, call.id).status == "done"

    def test_deleted_and_missing_calls_are_skipped(self, store, tenant, project, tracker, fake_engine):
        call = queued_call(store, tenant, project, deleted=True)
        assert worker.run_call(store, fake_engine, call.id) is False
        assert worker.run_call(store, fake_engine, "c-missing") is False

    def test_a_crash_fails_the_call_instead_of_leaving_it_processing(self, store, tenant, project, tracker):
        class Crashing:
            name = "crash"

            def evaluate(self, state, signals):
                raise RuntimeError("boom")

        call = queued_call(store, tenant, project)
        assert worker.run_call(store, Crashing(), call.id) is True
        done = store.get(Call, call.id)
        assert done.status == "failed" and "RuntimeError" in done.message


class TestRunCallEndpoint:
    @pytest.fixture
    def queue(self, client):
        s = get_settings()
        s.cloud_tasks_queue, s.task_service_url, s.task_invoker_email = "calls", SERVICE_URL, INVOKER
        client.headers.pop("X-API-Key", None)  # Cloud Tasks sends a bearer token only
        yield
        get_settings.cache_clear()

    @pytest.fixture
    def google(self, monkeypatch):
        claims = {"email": INVOKER, "email_verified": True}
        seen = {}

        def verify(token, request, audience=None):
            seen["audience"] = audience
            if token != "good":
                raise ValueError("bad token")
            return claims

        monkeypatch.setattr(id_token, "verify_oauth2_token", verify)
        return claims, seen

    def post(self, client, call_id, token="good"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return client.post("/tasks/run-call", json={"call_id": call_id}, headers=headers)

    def test_not_exposed_without_a_queue(self, client):
        assert self.post(client, "c-1").status_code == 404

    def test_bad_tokens_are_rejected(self, client, queue, google):
        claims, _ = google
        assert self.post(client, "c-1", token=None).status_code == 401
        assert self.post(client, "c-1", token="forged").status_code == 401
        claims["email"] = "someone-else@example.com"
        assert self.post(client, "c-1").status_code == 401
        claims.update(email=INVOKER, email_verified=False)
        assert self.post(client, "c-1").status_code == 401

    def test_unreachable_google_keys_ask_for_a_retry(self, client, queue, monkeypatch):
        def down(*_, **__):
            raise auth_exceptions.TransportError("no network")

        monkeypatch.setattr(id_token, "verify_oauth2_token", down)
        assert self.post(client, "c-1").status_code == 503

    def test_runs_the_call_and_accepts_a_redelivery(self, client, queue, google, store, tenant, project, tracker,
                                                    fake_engine, monkeypatch):
        monkeypatch.setattr(worker, "default_engine", lambda: fake_engine)
        call = queued_call(store, tenant, project)
        first = self.post(client, call.id)
        assert first.status_code == 200 and first.json() == {"ran": True}
        assert google[1]["audience"] == SERVICE_URL
        assert self.post(client, call.id).json() == {"ran": False}
        assert len(fake_engine.requests) == 1

    def test_not_in_the_openapi_schema(self, client):
        assert "/tasks/run-call" not in client.get("/openapi.json").json()["paths"]


class TestCloudTask:
    @pytest.fixture
    def queue_settings(self, store):
        s = get_settings()
        s.gcp_project, s.cloud_tasks_queue = "proj", "calls"
        s.task_service_url, s.task_invoker_email = SERVICE_URL, INVOKER
        yield
        get_settings.cache_clear()

    def test_creates_an_http_task_with_an_oidc_token(self, queue_settings, monkeypatch):
        sent = {}

        class FakeClient:
            def queue_path(self, project, location, queue):
                return f"projects/{project}/locations/{location}/queues/{queue}"

            def create_task(self, request):
                sent.update(request)

        monkeypatch.setattr(tasks, "_client", lambda: FakeClient())
        tasks.enqueue_call("c-1")
        http = sent["task"].http_request
        assert sent["parent"] == "projects/proj/locations/asia-south1/queues/calls"
        assert http.url == f"{SERVICE_URL}/tasks/run-call" and http.body == b'{"call_id": "c-1"}'
        assert http.oidc_token.service_account_email == INVOKER and http.oidc_token.audience == SERVICE_URL

    def test_a_queue_without_a_service_url_is_refused(self, queue_settings):
        get_settings().task_service_url = ""
        with pytest.raises(RuntimeError, match="TASK_SERVICE_URL"):
            tasks.enqueue_call("c-1")


class TestAudio:
    TURNS = [transcribe.Turn(speaker="Agent", text="Namaste"),
             transcribe.Turn(speaker="Customer", text="mujhe human se baat karni hai")]

    @pytest.fixture
    def gemini(self, monkeypatch):
        monkeypatch.setattr(llm, "default_client", lambda: object())
        monkeypatch.setattr(storage, "save_upload", lambda data, name, content_type: f"gs://bucket/{name}")
        monkeypatch.setattr(tasks, "enqueue_call", lambda call_id: None)  # hold the call at "transcribing"

    def mp3(self, client, **params):
        return upload_file(client, "call.mp3", b"ID3audio", "audio/mpeg", **params)

    def stored_call(self, store, body) -> Call:
        return store.first(Call, ("upload_id", "==", body["upload_id"]))

    def test_needs_gemini(self, client, tracker):
        assert self.mp3(client).status_code == 503

    def test_dry_run_estimate_is_unknown_until_transcribed(self, client, tracker, gemini, store):
        body = self.mp3(client, dry_run=True).json()
        assert body["upload_id"] is None and body["received"] == 1
        assert body["estimate"] == {"requests": None, "tokens": None, "price_per_million_tokens": None,
                                    "cost": None, "note": "estimated after transcription"}
        assert store.find(Upload) == []

    def test_rejects_big_and_unknown_files(self, client, tracker, gemini):
        assert upload_file(client, "c.mp3", b"x" * (30 * 1024 * 1024 + 1), "audio/mpeg").status_code == 422

    def test_recording_becomes_a_transcript_then_answers(self, client, tracker, gemini, store, fake_engine, monkeypatch):
        body = self.mp3(client).json()
        call = self.stored_call(store, body)
        assert (call.status, call.audio_uri, call.audio_content_type, call.transcript) == (
            "transcribing", "gs://bucket/call.mp3", "audio/mpeg", "")
        assert client.get(f"/uploads/{body['upload_id']}").json()["counts"]["transcribing"] == 1

        asked = {}

        def fake_transcribe(uri, mime):
            asked.update(uri=uri, mime=mime)
            return transcribe.Transcript(turns=self.TURNS, language="hi-Latn", duration_seconds=12.5)

        monkeypatch.setattr(transcribe, "transcribe_uri", fake_transcribe)
        assert worker.run_call(store, fake_engine, call.id) is True
        assert asked == {"uri": "gs://bucket/call.mp3", "mime": "audio/mpeg"}
        done = store.get(Call, call.id)
        assert done.status == "done" and done.transcript == "Agent: Namaste\nCustomer: mujhe human se baat karni hai"
        assert (done.language, done.duration_seconds) == ("hi-Latn", 12.5)
        assert done.transcript_tokens > 0 and done.estimated_tokens
        result = client.get(f"/uploads/{body['upload_id']}/results").json()[0]
        assert result["answers"]["experience"]["asked_for_human"]["value"] == "yes"
        assert client.get(f"/uploads/{body['upload_id']}").json()["complete"] is True

    def test_transcription_errors_fail_the_call_readably(self, client, tracker, gemini, store, fake_engine, monkeypatch):
        call = self.stored_call(store, self.mp3(client).json())

        def broken(uri, mime):
            raise transcribe.TranscriptionError("transcription failed: quota")

        monkeypatch.setattr(transcribe, "transcribe_uri", broken)
        worker.run_call(store, fake_engine, call.id)
        failed = store.get(Call, call.id)
        assert failed.status == "failed" and failed.message == "transcription failed: quota"
        assert fake_engine.requests == []

    def test_silence_fails_the_call(self, client, tracker, gemini, store, fake_engine, monkeypatch):
        call = self.stored_call(store, self.mp3(client).json())
        monkeypatch.setattr(transcribe, "transcribe_uri", lambda uri, mime: transcribe.Transcript(turns=[]))
        worker.run_call(store, fake_engine, call.id)
        assert "No speech" in store.get(Call, call.id).message
