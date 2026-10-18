"""Call recordings to speaker-labelled text, with Gemini.

Small files go inline; larger ones are read by Vertex AI straight from Cloud Storage
(`transcribe_uri`). The text stays in the language it was spoken in.
"""

from pathlib import PurePath

from google.genai import types
from pydantic import BaseModel, ValidationError

from aftercall.config import get_settings
from aftercall.llm import GeminiClient, LLMError, ThinkingLevel, default_client, thinking_config
from aftercall.storage import read_upload

# Inline requests are capped near 20 MB by the API, base64 included.
MAX_INLINE_BYTES = 14 * 1024 * 1024
TRANSCRIBE_TIMEOUT_SECONDS = 300.0
TRANSCRIBE_MAX_TOKENS = 65_536
# Writing down what was said needs no reasoning, and thinking is billed as output.
TRANSCRIBE_THINKING = ThinkingLevel.LOW

MIME_BY_EXTENSION = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
}
MIME_ALIASES = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-flac": "audio/flac",
    "video/webm": "audio/webm",
}
SUPPORTED_MIME_TYPES = set(MIME_BY_EXTENSION.values())

PROMPT = """Transcribe this phone call or conversation recording.

- Split it into turns, one per uninterrupted stretch of one speaker, in order.
- Label speakers "Agent" and "Customer" when the roles are clear (the agent works for the business and
  handles the call). Otherwise use "Speaker 1", "Speaker 2", and so on, consistently.
- Write each turn in the language it was spoken in. Hindi in Devanagari, English in Latin script, and
  Hinglish as spoken (Hindi words in Latin script where the speaker mixed the two). Never translate.
- Transcribe what was said, word for word. Do not summarise, correct, or add anything.
- language: the main language, as a BCP-47 code (en, hi, hi-Latn for Hinglish, ...).
- duration_seconds: the length of the recording in seconds, approximately.
- If there is no speech, return no turns."""


class TranscriptionError(Exception):
    pass


class Turn(BaseModel):
    speaker: str
    text: str


class Transcript(BaseModel):
    turns: list[Turn]
    language: str = ""
    duration_seconds: float = 0.0

    def as_text(self) -> str:
        return "\n".join(f"{t.speaker}: {t.text}" for t in self.turns)


def transcribe(audio: bytes, mime_type: str, filename: str) -> Transcript:
    if not audio:
        raise TranscriptionError("the recording is empty")
    if len(audio) > MAX_INLINE_BYTES:
        raise TranscriptionError("the recording is too large to send inline; upload it and use transcribe_uri")
    mime = audio_mime_type(mime_type, filename)
    return _run(types.Part.from_bytes(data=audio, mime_type=mime))


def transcribe_uri(uri: str, mime_type: str) -> Transcript:
    """For the Cloud Tasks worker: a saved upload (storage.save_upload's return value).

    On Vertex AI a gs:// URI is read by Gemini itself, whatever the size. Anywhere else (a local
    path, or an API key) the bytes are read here and sent inline, so they must fit MAX_INLINE_BYTES.
    """
    mime = audio_mime_type(mime_type, PurePath(uri).name)
    if uri.startswith("gs://") and get_settings().google_genai_use_vertexai:
        return _run(types.Part.from_uri(file_uri=uri, mime_type=mime))
    try:
        audio = read_upload(uri)
    except Exception as exc:
        raise TranscriptionError(f"couldn't read the recording: {exc}") from exc
    return transcribe(audio, mime, PurePath(uri).name)


def audio_mime_type(mime_type: str, filename: str) -> str:
    """The audio type Gemini takes, from the declared type or else the file extension."""
    declared = (mime_type or "").split(";")[0].strip().lower()
    declared = MIME_ALIASES.get(declared, declared)
    if declared in SUPPORTED_MIME_TYPES:
        return declared
    by_extension = MIME_BY_EXTENSION.get(PurePath(filename or "").suffix.lower())
    if by_extension:
        return by_extension
    raise TranscriptionError("unsupported audio type; use mp3, wav, m4a, ogg, webm or flac")


def _run(audio: types.Part) -> Transcript:
    client = default_client()
    if client is None:
        raise TranscriptionError("Gemini isn't configured (set GOOGLE_GENAI_USE_VERTEXAI or GEMINI_API_KEY)")
    return _transcript(client, audio)


def _transcript(client: GeminiClient, audio: types.Part) -> Transcript:
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=Transcript,
        max_output_tokens=TRANSCRIBE_MAX_TOKENS,
        thinking_config=thinking_config(TRANSCRIBE_THINKING),
    )
    model = get_settings().gemini_transcribe_model
    try:
        done = client.generate([PROMPT, audio], [model], config, timeout=TRANSCRIBE_TIMEOUT_SECONDS)
        return Transcript.model_validate_json(done.text)
    except LLMError as exc:
        raise TranscriptionError(f"transcription failed: {exc}") from exc
    except ValidationError as exc:
        raise TranscriptionError("Gemini returned a transcript in an unexpected shape") from exc
