import os
from typing import Any

import pytest

# Isolate tests from the developer's .env before any settings are read.
os.environ["TYPESAFE_API_KEY"] = ""
os.environ["TOKEN_BUDGET"] = "2000"
os.environ["STORE_BACKEND"] = "memory"
os.environ["DEV_API_KEY"] = ""
os.environ["CLOUD_TASKS_QUEUE"] = ""
os.environ["FIREBASE_PROJECT_ID"] = ""
os.environ["GCP_PROJECT"] = ""
os.environ["GEMINI_API_KEY"] = ""

from fastapi.testclient import TestClient

from aftercall import insights
from aftercall import store as store_module
from aftercall.config import get_settings
from aftercall.jev import EngineResult
from aftercall.store import MemoryStore


class FakeEngine:
    """Answers every question deterministically; records each request."""

    name = "fake"

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def evaluate(self, state: str, questions: dict[str, dict[str, Any]]) -> EngineResult:
        self.requests.append(questions)
        answers = {}
        for name, q in questions.items():
            match q["type"]:
                case "noul":
                    answers[name] = {"type": "noul", "noul": 0.9 if "human" in state else 0.55}
                case "choice":
                    first = next(iter(q["criteria"]))
                    others = [k for k in q["criteria"] if k != first]
                    probs = {first: 0.8, **{k: 0.2 / len(others) for k in others}}
                    answers[name] = {"type": "choice", "choice": first, "confidence": 0.8, "probabilities": probs}
                case "score":
                    n = len(q["criteria"])
                    probs = {str(i): (0.7 if i == 1 else 0.3 / (n - 1)) for i in range(n)}
                    answers[name] = {"type": "score", "score": 1.1, "confidence": 0.5, "probabilities": probs,
                                     "legend": {str(i): c for i, c in enumerate(q["criteria"])}}
        return EngineResult(model="fake-1", answers=answers, input_tokens=100 * len(questions), output_tokens=5, latency_ms=3)


@pytest.fixture
def store():
    """A fresh in-memory store, installed as the app's store for the test."""
    get_settings.cache_clear()
    fresh = MemoryStore()
    store_module.use(fresh)
    insights.clear_cache()
    yield fresh
    insights.clear_cache()
    store_module.use(None)


@pytest.fixture
def fresh_db(store):
    """Old name for `store`, for tests not yet ported."""
    return store


@pytest.fixture
def fake_engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def tenant(store):
    """A workspace with an owner; `.api_key` is its key."""
    from aftercall.cli import create_tenant

    return create_tenant("Test Co", store=store)


@pytest.fixture
def client(store, tenant):
    from aftercall.api import app

    with TestClient(app) as c:
        c.headers["X-API-Key"] = tenant.api_key
        yield c


@pytest.fixture
def wire(fake_engine):
    """Plug a fake model into the API, with Jev routing to "simple" unless told otherwise."""
    from aftercall.api import app
    from aftercall.deps import get_engine, get_llm

    def plug(llm, engine=fake_engine):
        app.dependency_overrides[get_llm] = lambda: llm
        app.dependency_overrides[get_engine] = lambda: engine
        return llm
    yield plug
    app.dependency_overrides.clear()
