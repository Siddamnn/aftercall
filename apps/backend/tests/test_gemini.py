"""Gemini client, transcription and storage, offline: the genai client is replaced by a fake."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import errors

from aftercall import llm, storage, transcribe
from aftercall.config import get_settings
from aftercall.llm import GeminiClient, LLMError


def reply(text: str | None = '{"ok": true}', prompt=100, answer=50, thoughts=10):
    return SimpleNamespace(
        text=text,
        candidates=[SimpleNamespace(finish_reason="MAX_TOKENS")],
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt, candidates_token_count=answer, thoughts_token_count=thoughts
        ),
    )


class FakeModels:
    """Each script step is a reply or an exception, consumed in call order."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls: list[dict] = []

    def generate_content(self, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def client_with(*script) -> tuple[GeminiClient, FakeModels, list[float]]:
    models = FakeModels(*script)
    sleeps: list[float] = []
    return GeminiClient(SimpleNamespace(models=models), sleep=sleeps.append), models, sleeps


def api_error(code: int) -> errors.APIError:
    return errors.APIError(code, {"error": {"message": "nope", "status": "X"}})


def test_complete_returns_json_text_usage_and_cost():
    client, models, _ = client_with(reply('{"a": 1}', prompt=1_000_000, answer=0, thoughts=0))
    done = client.complete("be brief", "hi", ["gemini-3.8-flash"], 500)
    assert json.loads(done.text) == {"a": 1}
    assert done.model == "gemini-3.8-flash" and done.input_tokens == 1_000_000
    assert done.cost_usd == pytest.approx(0.75)
    config = models.calls[0]["config"]
    assert config.response_mime_type == "application/json" and config.max_output_tokens == 500
    assert config.system_instruction == "be brief"


def test_complete_sets_the_thinking_level_only_when_asked():
    client, models, _ = client_with(reply(), reply())
    client.complete("s", "u", ["a"], 10)
    client.complete("s", "u", ["a"], 10, llm.ThinkingLevel.LOW)
    default, low = (c["config"].thinking_config for c in models.calls)
    assert default is None and low.thinking_level == llm.ThinkingLevel.LOW


def test_thinking_tokens_count_as_output():
    client, *_ = client_with(reply(prompt=0, answer=5, thoughts=7))
    assert client.complete("s", "u", ["gemini-3.8-flash"], 10).output_tokens == 12


def test_unpriced_model_costs_zero():
    client, *_ = client_with(reply())
    assert client.complete("s", "u", ["some-new-model"], 10).cost_usd == 0.0


def test_retries_same_model_then_succeeds():
    client, models, sleeps = client_with(api_error(503), reply())
    done = client.complete("s", "u", ["a", "b"], 10)
    assert done.model == "a" and [c["model"] for c in models.calls] == ["a", "a"] and len(sleeps) == 1


def test_falls_back_to_next_model_after_retries():
    client, models, _ = client_with(api_error(429), api_error(429), reply())
    done = client.complete("s", "u", ["a", "b"], 10)
    assert done.model == "b" and [c["model"] for c in models.calls] == ["a", "a", "b"]


def test_timeout_is_retryable():
    client, *_ = client_with(TimeoutError("slow"), TimeoutError("slow"), reply())
    assert client.complete("s", "u", ["a", "b"], 10).model == "b"


def test_missing_model_skips_without_retry():
    client, models, _ = client_with(api_error(404), reply())
    assert client.complete("s", "u", ["gone", "b"], 10).model == "b" and len(models.calls) == 2


def test_client_error_is_not_retried_or_fallen_back():
    client, models, _ = client_with(api_error(400))
    with pytest.raises(LLMError, match="HTTP 400"):
        client.complete("s", "u", ["a", "b"], 10)
    assert len(models.calls) == 1


def test_all_models_down_raises_llm_error():
    client, *_ = client_with(*[api_error(500)] * 4)
    with pytest.raises(LLMError, match="no model answered"):
        client.complete("s", "u", ["a", "b"], 10)


def test_empty_answer_raises_with_finish_reason():
    client, *_ = client_with(reply(text=None))
    with pytest.raises(LLMError, match="MAX_TOKENS"):
        client.complete("s", "u", ["a"], 10)


def test_no_models_raises():
    client, *_ = client_with()
    with pytest.raises(LLMError, match="no Gemini model"):
        client.complete("s", "u", [], 10)


def test_tier_models_reads_comma_separated_settings(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_models_simple", " a , b ,")
    assert llm.tier_models("simple") == ["a", "b"]
    with pytest.raises(ValueError):
        llm.tier_models("huge")


def test_default_client_none_without_configuration(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_genai_use_vertexai", False)
    monkeypatch.setattr(s, "gemini_api_key", "")
    llm.default_client.cache_clear()
    assert llm.default_client() is None
    monkeypatch.setattr(s, "gemini_api_key", "test-key")
    llm.default_client.cache_clear()
    assert isinstance(llm.default_client(), GeminiClient)
    llm.default_client.cache_clear()


TRANSCRIPT = {
    "turns": [{"speaker": "Agent", "text": "नमस्ते, kaise help karun?"}, {"speaker": "Customer", "text": "Card block karna hai"}],
    "language": "hi-Latn",
    "duration_seconds": 12.5,
}


def use_client(monkeypatch, *script) -> FakeModels:
    client, models, _ = client_with(*script)
    monkeypatch.setattr(transcribe, "default_client", lambda: client)
    return models


def test_transcribe_parses_turns_and_keeps_original_language(monkeypatch):
    models = use_client(monkeypatch, reply(json.dumps(TRANSCRIPT, ensure_ascii=False)))
    result = transcribe.transcribe(b"RIFF", "audio/x-wav", "call.wav")
    assert [t.speaker for t in result.turns] == ["Agent", "Customer"]
    assert result.turns[0].text.startswith("नमस्ते") and result.language == "hi-Latn" and result.duration_seconds == 12.5
    call = models.calls[0]
    assert call["model"] == get_settings().gemini_transcribe_model
    assert call["contents"][1].inline_data.mime_type == "audio/wav"
    assert call["config"].response_schema is transcribe.Transcript


def test_transcription_thinks_at_the_low_level(monkeypatch):
    models = use_client(monkeypatch, reply(json.dumps(TRANSCRIPT)))
    transcribe.transcribe(b"RIFF", "audio/x-wav", "call.wav")
    assert models.calls[0]["config"].thinking_config.thinking_level == llm.ThinkingLevel.LOW


def test_transcribe_uri_passes_gcs_uri_on_vertex(monkeypatch):
    monkeypatch.setattr(get_settings(), "google_genai_use_vertexai", True)
    models = use_client(monkeypatch, reply(json.dumps(TRANSCRIPT)))
    transcribe.transcribe_uri("gs://bucket/uploads/x.mp3", "audio/mpeg")
    assert models.calls[0]["contents"][1].file_data.file_uri == "gs://bucket/uploads/x.mp3"


def test_transcribe_uri_reads_local_path_inline(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".uploads")
    monkeypatch.setattr(get_settings(), "gcs_bucket", "")
    uri = storage.save_upload(b"RIFF", "call.wav", "audio/wav")
    models = use_client(monkeypatch, reply(json.dumps(TRANSCRIPT)))
    transcribe.transcribe_uri(uri, "audio/wav")
    assert models.calls[0]["contents"][1].inline_data.data == b"RIFF"


def test_transcribe_uri_unreadable_is_transcription_error(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".uploads")
    with pytest.raises(transcribe.TranscriptionError, match="couldn't read"):
        transcribe.transcribe_uri(str(tmp_path / ".uploads" / "missing.wav"), "audio/wav")


def test_transcribe_rejects_bad_input(monkeypatch):
    use_client(monkeypatch)
    with pytest.raises(transcribe.TranscriptionError, match="unsupported"):
        transcribe.transcribe(b"x", "application/pdf", "call.pdf")
    with pytest.raises(transcribe.TranscriptionError, match="empty"):
        transcribe.transcribe(b"", "audio/wav", "call.wav")


def test_mime_falls_back_to_extension():
    assert transcribe.audio_mime_type("application/octet-stream", "Call.M4A") == "audio/mp4"
    assert transcribe.audio_mime_type("audio/mp3", "x") == "audio/mpeg"


def test_transcribe_maps_failures_to_transcription_error(monkeypatch):
    use_client(monkeypatch, api_error(500), api_error(500))
    with pytest.raises(transcribe.TranscriptionError, match="transcription failed"):
        transcribe.transcribe(b"x", "audio/wav", "a.wav")
    use_client(monkeypatch, reply('{"turns": "nope"}'))
    with pytest.raises(transcribe.TranscriptionError, match="unexpected shape"):
        transcribe.transcribe(b"x", "audio/wav", "a.wav")


def test_transcribe_without_gemini_configured(monkeypatch):
    monkeypatch.setattr(transcribe, "default_client", lambda: None)
    with pytest.raises(transcribe.TranscriptionError, match="isn't configured"):
        transcribe.transcribe(b"x", "audio/wav", "a.wav")


def test_storage_local_mode_round_trip(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "gcs_bucket", "")
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".uploads")
    uri = storage.save_upload(b"audio-bytes", "../../evil name.mp3", "audio/mpeg")
    assert not uri.startswith("gs://") and uri.endswith("evil_name.mp3")
    assert (tmp_path / ".uploads") in Path(uri).parents
    assert storage.read_upload(uri) == b"audio-bytes"


def test_storage_local_delete_removes_only_uploads(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "gcs_bucket", "")
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".uploads")
    uri = storage.save_upload(b"audio-bytes", "call.mp3", "audio/mpeg")
    outside = tmp_path / "keep.txt"
    outside.write_text("x")
    storage.delete_upload(uri)
    storage.delete_upload(uri)  # already gone is fine
    storage.delete_upload(str(outside))
    assert not Path(uri).exists() and outside.exists()


def test_storage_local_read_refuses_other_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "LOCAL_DIR", tmp_path / ".uploads")
    outside = tmp_path / "secret.txt"
    outside.write_text("x")
    with pytest.raises(storage.StorageError):
        storage.read_upload(str(outside))


def test_storage_gcs_mode_uploads_under_dated_prefix(monkeypatch):
    uploaded = {}

    class Blob:
        def __init__(self, key):
            self.key = key

        def upload_from_string(self, data, content_type):
            uploaded.update(key=self.key, data=data, content_type=content_type)

        def download_as_bytes(self):
            return b"from-gcs"

    monkeypatch.setattr(get_settings(), "gcs_bucket", "my-bucket")
    monkeypatch.setattr(storage, "_bucket", lambda name: SimpleNamespace(blob=Blob))
    uri = storage.save_upload(b"abc", "call.wav", "audio/wav")
    assert uri == f"gs://my-bucket/{uploaded['key']}"
    assert uploaded["key"].startswith("uploads/") and uploaded["key"].endswith("-call.wav")
    assert uploaded["content_type"] == "audio/wav"
    assert storage.read_upload(uri) == b"from-gcs"
