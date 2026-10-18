from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

OVER_LIMIT_MESSAGE = (
    "This call is over {budget:,} tokens, so it wasn't analysed and you weren't charged for it. "
    "Long calls will be supported later. Like every call they'll be billed per token, "
    "so a long call costs more because it uses more tokens."
)


LARGE_CALL_MESSAGE = (
    "This call is {transcript_tokens:,} tokens. With your signals it doesn't fit in one request, "
    "so it will be sent in {requests} parts and use about {tokens:,} tokens "
    "({multiplier:.1f}x what it would use if the signals fitted)."
)

# apps/backend/aftercall/config.py → repo root. One .env at the root serves every app;
# a .env next to where the app is started overrides it. In the container (/app/aftercall)
# there's no repo root and settings come from the environment.
_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _PARENTS[3] if len(_PARENTS) > 3 else _PARENTS[-1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(REPO_ROOT / ".env", ".env"), extra="ignore")

    typesafe_api_key: str = ""
    typesafe_base_url: str = "https://api.typesafe.ai"
    jev_model: str = "jev-1.13.0"
    jev_price_per_mtok_input: float = 0.042
    jev_timeout_seconds: float = 60.0

    # alteria, the built-in AI, runs on Gemini (gemini_models_* below). Jev routes each request to
    # the cheapest tier it's at least this sure is enough (router.py). Higher = safer and dearer.
    alteria_route_certainty: float = 0.8
    # The tier when Jev can't be asked (no TYPESAFE_API_KEY, or it failed).
    alteria_default_tier: str = "standard"
    # Trial allowances, only enforced if billing is ever turned back on (billing is off in this build).
    alteria_trial_requests: int = 20
    ask_trial_questions: int = 3
    # The longest input alteria takes, in tokens.
    alteria_max_input_tokens: int = 20_000

    # USD → local, for showing prices (B55). Amounts in the API stay USD.
    fx_rates: dict[str, float] = {"USD": 1.0, "INR": 83.1, "EUR": 0.92, "GBP": 0.79, "AED": 3.67, "SGD": 1.35}

    # The product's domain: workspace addresses are APP_HOST/{slug}. Same as the web's VITE_APP_HOST.
    app_host: str = "aftercall.app"
    # The only sites whose pages may call the API from a browser, separated by commas or spaces
    # (e.g. "https://app.web.app https://app.firebaseapp.com"). A browser request from any other
    # origin is refused (403). Empty: no check (local dev, where Vite's proxy calls the API).
    cors_origins: str = ""
    # /docs, /redoc and /openapi.json. Off in production (deploy.sh), so the API isn't advertised.
    api_docs: bool = True

    # Firebase sign-ins end this long after they start, whatever the page does (B64).
    session_max_hours: float = 5.0

    # Google Cloud. Everything below runs on GCP for the AI Builder Cup.
    gcp_project: str = ""
    gcp_location: str = "asia-south1"
    # Where records live (store.py): "firestore" in production, "memory" for tests and local runs.
    store_backend: str = "memory"
    firestore_database: str = "(default)"
    # Gemini, for alteria and transcription: Vertex AI on Cloud Run (service account), else an AI Studio key.
    google_genai_use_vertexai: bool = False
    gemini_api_key: str = ""
    gemini_location: str = "global"
    gemini_models_simple: str = "gemini-3.5-flash-lite"
    gemini_models_standard: str = "gemini-3.8-flash"
    gemini_models_complex: str = "gemini-3.1-pro-preview,gemini-3.8-flash"
    gemini_transcribe_model: str = "gemini-3.8-flash"
    # Audio uploads (recordings) are kept in this Cloud Storage bucket before Gemini transcribes them.
    gcs_bucket: str = ""
    # Cloud Tasks: each queued call becomes a task posting to {task_service_url}/tasks/run-call.
    # Without a queue, calls run in-process (local dev and tests).
    cloud_tasks_queue: str = ""
    cloud_tasks_location: str = "asia-south1"
    task_service_url: str = ""
    # The service account Cloud Tasks signs its OIDC token as; /tasks/* only accepts that token.
    task_invoker_email: str = ""
    # Firebase Authentication: ID tokens from this project sign people in (defaults to gcp_project).
    firebase_project_id: str = ""
    # Memory store only: a demo workspace with this API key is created at startup, so the web's dev
    # proxy (AFTERCALL_API_KEY) works without a database. Ignored with Firestore.
    dev_api_key: str = ""

    # Transcripts above this are flagged over_limit and never sent to Jev.
    # Below it, signals are split across requests so each stays near this size.
    token_budget: int = 30_000
    # At most this many signals in one Jev request, so answer quality holds up with many
    # signals. More are split across requests (each re-sends the transcript, billed per token).
    max_signals_per_request: int = 15
    default_review_threshold: float = 0.6


@lru_cache
def get_settings() -> Settings:
    return Settings()


def over_limit_message() -> str:
    return OVER_LIMIT_MESSAGE.format(budget=get_settings().token_budget)


def large_call_message(transcript_tokens: int, requests: int, tokens: int, multiplier: float) -> str:
    return LARGE_CALL_MESSAGE.format(
        transcript_tokens=transcript_tokens, requests=requests, tokens=tokens, multiplier=multiplier
    )
