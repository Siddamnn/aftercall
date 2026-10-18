"""alteria's drafts (B38): routing by Jev, validation, going a tier up, and the Gemini limits.

The routes are mounted on a small app of their own, so these tests don't depend on the rest of the API.
"""

import dataclasses
import json
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from aftercall import alteria, billing, router, workspaces
from aftercall.catalog import parse_trackers
from aftercall.config import get_settings
from aftercall.deps import Who, signed_in
from aftercall.errors import Problem, problem_handler
from aftercall.jev import EngineResult
from aftercall.llm import Completion, LLMError, ThinkingLevel, tier_models
from aftercall.models import AlteriaRequest, Member, Signal, SignalVersion, Tenant, Tracker, User
from aftercall.routes import alteria as routes

GOOD_SIGNAL = {"name": "asked_for_refund", "type": "yes_no",
               "instructions": "Did the caller ask for their money back? Answer no if it isn't mentioned."}
BAD_SIGNAL = {"name": "reason", "type": "choice", "instructions": "Why?", "criteria": {"price": "Too expensive"}}


class FakeLLM:
    """Answers from a script, one entry per call: a dict (sent as JSON), a string, or an exception."""

    def __init__(self, *script):
        self.script = list(script)
        self.calls: list[dict] = []

    def complete(self, system, user, models, max_tokens, thinking=None):
        self.calls.append({"user": user, "models": models, "max_tokens": max_tokens, "thinking": thinking})
        answer = self.script.pop(0)
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps(answer)
        return Completion(text=text, model=models[0], input_tokens=100, output_tokens=50, cost_usd=0.001, latency_ms=5)


class RoutesComplex:
    name = "complex"

    def evaluate(self, state, questions):
        probs = {"simple": 0.1, "standard": 0.2, "complex": 0.7}
        answer = {"type": "choice", "choice": "complex", "confidence": 0.7, "probabilities": probs}
        return EngineResult("fake", {"complexity": answer}, 50, 1, 1)


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(routes.router)
    app.add_exception_handler(Problem, problem_handler)
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def client(app, store, tenant):
    return TestClient(app, headers={"X-API-Key": tenant.api_key})


@pytest.fixture
def wire(app, fake_engine):
    """Plug a fake model into the API, with Jev routing to "simple" unless told otherwise."""
    from aftercall.deps import get_engine, get_llm

    def plug(llm, engine=fake_engine):
        app.dependency_overrides[get_llm] = lambda: llm
        app.dependency_overrides[get_engine] = lambda: engine
        return llm
    return plug


@pytest.fixture
def project(store, tenant):
    return workspaces.default_project(store, store.get(Tenant, tenant.id))


def add_signal(store, project, tracker_name, spec, tracker_seq=0):
    """A tracker (made on first use) with an active signal, as the trackers routes leave them."""
    tracker = store.first(Tracker, ("project_id", "==", project.id), ("name", "==", tracker_name))
    if tracker is None:
        tracker = Tracker(tenant_id=project.tenant_id, project_id=project.id, name=tracker_name, seq=tracker_seq)
        store.put(tracker)
    seq = store.count(Signal, ("tracker_id", "==", tracker.id))
    signal = Signal(tenant_id=project.tenant_id, project_id=project.id, tracker_id=tracker.id, tracker_name=tracker_name,
                    name=spec["name"], tracker_seq=tracker.seq, seq=seq)
    version = SignalVersion(signal_id=signal.id, version=1, spec=spec)
    signal.activate(version)
    store.put_many([signal, version])


@contextmanager
def as_member(app, store, tenant, role, user_id=None):
    """Requests as a teammate with this role, instead of the API key's owner: a new one, or `user_id` again."""
    if user_id is None:
        user = User(name=f"{role.title()} Person", email=f"{role}-{len(store.find(User))}@example.com", email_verified=True)
        store.put_many([user, Member(tenant_id=tenant.id, user_id=user.id, role=role)])
    else:
        user = store.get(User, user_id)
    member = store.get(Member, Member.make_id(tenant.id, user.id))
    app.dependency_overrides[signed_in] = lambda: Who(user=user, tenant=store.get(Tenant, tenant.id), role=member.role)
    try:
        yield user.id
    finally:
        app.dependency_overrides.pop(signed_in, None)


def logs(store) -> list[AlteriaRequest]:
    return store.find(AlteriaRequest, order_by="created_at")


def test_pick_the_cheapest_tier_jev_is_sure_of():
    assert router.pick({"simple": 0.85, "standard": 0.1, "complex": 0.05}, 0.8) == "simple"
    assert router.pick({"simple": 0.6, "standard": 0.3, "complex": 0.1}, 0.8) == "standard"
    assert router.pick({"simple": 0.4, "standard": 0.3, "complex": 0.3}, 0.8) == "complex"


def test_without_jev_the_default_tier_is_used(store):
    assert router.route(None, "signal", "Did they ask for a refund?").tier == get_settings().alteria_default_tier


def test_every_tier_has_gemini_models():
    assert all(tier_models(t) for t in router.TIERS)


def test_signal_draft_routed_cheap_and_renamed_if_taken(client, wire, store, project):
    llm = wire(FakeLLM({"signal": GOOD_SIGNAL, "notes": []}))
    add_signal(store, project, "support", GOOD_SIGNAL)

    res = client.post("/alteria/signal", json={"text": "Did they ask for a refund?", "tracker": "support"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["signal"]["name"] == "asked_for_refund_2" and "already in Support" in body["notes"][0]
    assert llm.calls[0]["models"] == tier_models("simple")
    [log] = logs(store)
    assert log.ok and log.is_draft and log.routed_tier == "simple" and log.attempts == 1 and log.cost_usd == pytest.approx(0.001)
    assert log.route_probabilities["simple"] == pytest.approx(0.8)


def test_cheap_tiers_think_a_little_and_get_room_beyond_the_answer_budget(client, wire):
    llm = wire(FakeLLM({"signal": GOOD_SIGNAL, "notes": []}))
    client.post("/alteria/signal", json={"text": "Did they ask for a refund?", "tracker": "t"})
    assert llm.calls[0]["thinking"] == ThinkingLevel.LOW
    assert llm.calls[0]["max_tokens"] == alteria.DRAFT_MAX_TOKENS + alteria.THINKING_HEADROOM["simple"]


def test_the_complex_tier_keeps_the_models_default_thinking_and_a_wide_margin(client, wire):
    llm = wire(FakeLLM({"signal": GOOD_SIGNAL, "notes": []}), engine=RoutesComplex())
    client.post("/alteria/signal", json={"text": "Did they ask for a refund?", "tracker": "t"})
    assert llm.calls[0]["thinking"] is None
    assert llm.calls[0]["max_tokens"] == alteria.DRAFT_MAX_TOKENS + alteria.THINKING_HEADROOM["complex"] == 12_000


def test_every_tier_has_a_thinking_setting_and_headroom():
    assert set(alteria.TIER_THINKING) == set(alteria.THINKING_HEADROOM) == set(router.TIERS)
    assert alteria.TIER_THINKING["simple"] == alteria.TIER_THINKING["standard"] == ThinkingLevel.LOW


def test_an_invalid_draft_goes_a_tier_up_with_its_problems(client, wire, store):
    llm = wire(FakeLLM({"signal": BAD_SIGNAL, "notes": []}, {"signal": GOOD_SIGNAL, "notes": []}))
    res = client.post("/alteria/signal", json={"text": "Why did they cancel?", "tracker": "support"})
    assert res.status_code == 200
    assert [c["models"] for c in llm.calls] == [tier_models("simple"), tier_models("standard")]
    assert "rejected" in llm.calls[1]["user"] and "at least 2 options" in llm.calls[1]["user"]
    [log] = logs(store)
    assert log.ok and log.tier == "standard" and log.attempts == 2 and log.input_tokens == 200


def test_provider_failures_move_up_and_giving_up_is_logged(client, wire, store):
    wire(FakeLLM(LLMError("HTTP 503"), "not json", {"signal": BAD_SIGNAL}))
    res = client.post("/alteria/signal", json={"text": "Why?", "tracker": "support"})
    assert res.status_code == 502 and "couldn't draft" in res.json()["detail"]
    [log] = logs(store)
    assert not log.ok and log.attempts == 3 and log.tier == "complex"


def test_the_strongest_tier_gets_a_second_go(client, wire):
    llm = wire(FakeLLM({"signal": BAD_SIGNAL}, {"signal": GOOD_SIGNAL, "notes": []}), engine=RoutesComplex())
    assert client.post("/alteria/signal", json={"text": "x", "tracker": "t"}).status_code == 200
    assert [c["models"] for c in llm.calls] == [tier_models("complex")] * 2


TRACKERS = {"trackers": [
    {"name": "outcome", "description": "How it ended", "signals": [
        {"name": "result", "type": "choice", "instructions": "How did the call end?",
         "criteria": {"booked": "A slot was booked", "declined": "Said no", "other": "Anything else"}}]},
    {"name": "decline_reasons", "run_if": {"tracker": "outcome", "signal": "result", "op": "in", "value": ["declined"]},
     "signals": [{"name": "reason", "type": "choice", "instructions": "Why did they say no?",
                  "criteria": {"price": "Too expensive", "not_stated": "No reason given", "other": "Anything else"}}]},
], "notes": ["Reasons only run on declined calls."]}


def test_trackers_draft_renames_clashes_and_keeps_conditions_pointing_right(client, wire, store, project):
    wire(FakeLLM(TRACKERS))
    store.put(Tracker(tenant_id=project.tenant_id, project_id=project.id, name="outcome"))
    body = client.post("/alteria/trackers", json={"goal": "Why do people decline bookings?"}).json()
    assert [t["name"] for t in body["trackers"]] == ["outcome_2", "decline_reasons"]
    assert body["trackers"][1]["run_if"]["tracker"] == "outcome_2"
    assert any("already have Outcome" in n for n in body["notes"])
    assert [t.name for t in parse_trackers(body["trackers"])] == ["outcome_2", "decline_reasons"]  # imports as it is


def test_trackers_with_a_broken_condition_are_rejected(client, wire):
    broken = json.loads(json.dumps(TRACKERS))
    broken["trackers"][1]["run_if"]["value"] = ["cancelled"]
    llm = wire(FakeLLM(broken, TRACKERS))
    assert client.post("/alteria/trackers", json={"goal": "Bookings"}).status_code == 200
    assert "can't answer 'cancelled'" in llm.calls[1]["user"]


RAW = """Call 1042 - 3 Sep
Agent: Hello, Sunrise Clinic, how can I help?
Caller: hi i want to book a cleaning
Agent: Sure, Tuesday at 10?
Caller: haan theek hai"""


def test_conversations_are_copied_word_for_word(client, wire):
    invented = {"calls": [{"external_id": "1042", "transcript": [
        {"speaker": "agent", "text": "Hello, Sunrise Clinic, how can I help you today?"}]}], "warnings": []}
    good = {"calls": [{"external_id": "1042", "started_at": "3 Sep", "transcript": [
        {"speaker": "agent", "text": "Hello, Sunrise Clinic, how can I help?"},
        {"speaker": "caller", "text": "hi i want to book a cleaning"},
        {"speaker": "agent", "text": "Sure, Tuesday at 10?"},
        {"speaker": "caller", "text": "haan theek hai"}]}], "warnings": []}
    llm = wire(FakeLLM(invented, good))
    res = client.post("/alteria/conversations", data={"text": RAW})
    assert res.status_code == 200, res.text
    assert res.json()["calls"][0]["transcript"][3]["text"] == "haan theek hai"
    assert "word for word" in llm.calls[1]["user"]
    assert all(c["max_tokens"] > alteria.THINKING_HEADROOM["simple"] for c in llm.calls)


def test_dropped_lines_are_rejected(client, wire):
    partial = {"calls": [{"transcript": [{"speaker": "agent", "text": "Sure, Tuesday at 10?"}]}], "warnings": []}
    llm = wire(FakeLLM(partial, partial, partial))
    assert client.post("/alteria/conversations", data={"text": RAW}).status_code == 502
    assert "Lines are missing" in llm.calls[1]["user"]


def test_conversations_already_in_the_upload_format_skip_the_model(client, wire, store):
    llm = wire(FakeLLM())
    upload = json.dumps({"calls": [{"external_id": "a", "transcript": "caller: hi"}]})
    body = client.post("/alteria/conversations", files={"file": ("calls.json", upload, "application/json")}).json()
    assert body["passthrough"] and body["calls"][0]["external_id"] == "a"
    assert llm.calls == [] and logs(store) == []


def test_alteria_needs_gemini(client, wire):
    wire(None)
    res = client.post("/alteria/signal", json={"text": "x", "tracker": "t"})
    assert res.status_code == 503 and "GEMINI_API_KEY" in res.json()["detail"] and "OpenRouter" not in res.json()["detail"]


def test_alteria_is_open_while_billing_is_off(client, wire, monkeypatch):
    monkeypatch.setattr(get_settings(), "alteria_trial_requests", 0)
    wire(FakeLLM({"signal": GOOD_SIGNAL, "notes": []}))
    assert client.post("/alteria/signal", json={"text": "Did they ask for a refund?", "tracker": "t"}).status_code == 200


def test_alteria_comes_with_pro_after_the_free_tries(client, wire, store, monkeypatch):
    payg = billing.plans()["payg"]
    monkeypatch.setattr(billing, "enabled", lambda: True)
    monkeypatch.setattr(billing, "plans", lambda: {"payg": dataclasses.replace(payg, alteria=False)})
    monkeypatch.setattr(get_settings(), "alteria_trial_requests", 1)
    wire(FakeLLM(*[{"signal": GOOD_SIGNAL, "notes": []}] * 2))
    ask = {"text": "Did they ask for a refund?", "tracker": "t"}
    assert client.post("/alteria/signal", json=ask).status_code == 200
    res = client.post("/alteria/signal", json=ask)
    assert res.status_code == 402 and "comes with Pro" in res.json()["detail"]
    store.put(AlteriaRequest(tenant_id="elsewhere", task="signal", routed_tier="simple", ok=True, is_draft=True))
    assert client.post("/alteria/signal", json=ask).status_code == 402  # other workspaces' tries don't count
