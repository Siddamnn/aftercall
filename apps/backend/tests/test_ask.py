"""Ask alteria (B39) and its saved, shareable chats (B41, B43, B44).

Conversations and answers are seeded straight into the store (what the worker leaves behind), and the
routes are mounted by test_alteria's `app` fixture, so these tests don't depend on uploads or the worker.
"""

import pytest
from test_alteria import FakeLLM, add_signal, app, as_member, client, project, wire  # noqa: F401

from aftercall import billing, latest
from aftercall.config import get_settings
from aftercall.llm import LLMError
from aftercall.models import Answer, Call, Notification, Run, Thread, ThreadMessage, UsageEvent

OUTCOME_Q = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
             "criteria": {"booked": "Booked a slot", "declined": "Said no", "other": "Anything else"}}
HUMAN_Q = {"name": "asked_for_human", "type": "yes_no", "instructions": "Did the caller ask for a human?"}

CHANNELS = ["call", "chat", "call"]
PLAN = {"kind": "answer", "metrics": ["experience.asked_for_human"], "by": "channel", "where": [], "title": "Asking for a person"}
CHART = {"kind": "kpi", "metric": "experience.asked_for_human", "value": "yes", "title": "Asked for a person"}
ANSWER = {"text": "**100%** of the 3 conversations asked for a person.", "chart": CHART, "follow_ups": ["Why?", "Which channel?"]}


def answers_of(call, run):
    common = dict(run_id=run.id, signal_version=1, confidence=0.8, needs_review=False)
    return [
        Answer.for_call(call, tracker_name="experience", signal_name="asked_for_human", type="yes_no", value_text="yes",
                        value_num=0.9, probabilities={"yes": 0.9, "no": 0.1}, **common),
        Answer.for_call(call, tracker_name="sales", signal_name="outcome", type="choice", value_text="booked",
                        probabilities={"booked": 0.8, "declined": 0.1, "other": 0.1}, **common),
    ]


@pytest.fixture
def analysed(client, store, project):
    add_signal(store, project, "sales", OUTCOME_Q, tracker_seq=0)
    add_signal(store, project, "experience", HUMAN_Q, tracker_seq=1)
    for i, channel in enumerate(CHANNELS):
        call = Call(tenant_id=project.tenant_id, project_id=project.id, external_id=str(i), channel=channel,
                    transcript="caller: I want a human", transcript_tokens=6, status="done", seq=i)
        run = Run(call_id=call.id, tenant_id=call.tenant_id, project_id=project.id, engine="fake", status="done")
        answers = answers_of(call, run)
        latest.apply(call, run, answers)
        store.put_many([call, run, *answers])
    return client


def ask(client, question="How many asked for a person?", **extra):
    return client.post("/alteria/ask", json={"question": question, "scope": {}, **extra})


def test_answers_come_from_the_data(analysed, wire, store):
    made_up = {**ANSWER, "text": "About **87%** asked for a person."}
    llm = wire(FakeLLM(PLAN, made_up, ANSWER))
    body = ask(analysed).json()
    assert body["text"] == ANSWER["text"] and body["title"] == "Asking for a person"
    assert body["chart"] == {"widget": {"id": "ask", "size": 2, **CHART}}
    assert len(body["citations"]) == 3 and body["citations"][0]["why"].startswith(("Call", "Chat"))
    assert "87 isn't in FACTS" in llm.calls[2]["user"]  # the made-up number was sent back
    assert '"percent": 100' in llm.calls[1]["user"] and '"group": "call"' in llm.calls[1]["user"]
    assert all(c["max_tokens"] >= 3_000 + 800 for c in llm.calls)  # room for Gemini's (low) thinking

    thread = analysed.get(f"/alteria/threads/{body['thread_id']}").json()
    assert [m["role"] for m in thread["messages"]] == ["user", "alteria"] and thread["messages"][1]["answer"]["text"] == ANSWER["text"]
    assert thread["messages"][1]["id"] == body["message_id"]
    listed = analysed.get("/alteria/threads").json()["threads"]
    assert [t["id"] for t in listed] == [body["thread_id"]] and listed[0]["mine"] and listed[0]["preview"].startswith("How many")
    assert listed[0]["message_count"] == 2 and listed[0]["owner"]["name"] == "Owner"
    assert store.count(UsageEvent, ("kind", "==", "alteria_ask")) == 1


def test_asks_are_logged_but_are_not_drafts(analysed, wire, store):
    from aftercall.models import AlteriaRequest

    wire(FakeLLM(PLAN, ANSWER))
    ask(analysed)
    rows = store.find(AlteriaRequest)
    assert {r.task for r in rows} == {"ask_plan", "ask_answer"} and not any(r.is_draft for r in rows)


def test_questions_it_cant_count_suggest_a_signal(analysed, wire):
    wire(FakeLLM({**PLAN, "kind": "untracked", "metrics": []}))
    body = ask(analysed, "Did they mention the weather?").json()
    assert body["suggest_signal"] == "Did they mention the weather?" and "3 conversations" in body["text"]


def test_dashboards_by_chat(analysed, wire):
    bad = {"name": "Agents", "widgets": [{"kind": "kpi", "metric": "nope.nothing"}], "text": "Done"}
    good = {"name": "Agent quality", "widgets": [{"kind": "kpi", "metric": "conversations"},
                                                 {"kind": "compare", "metric": "sales.outcome", "by": "channel"}],
            "text": "Here's a draft with 2 charts.", "follow_ups": ["Add frustration"]}
    wire(FakeLLM({**PLAN, "kind": "dashboard"}, bad, good))
    body = ask(analysed, "Build me a dashboard for agent quality").json()
    widgets = body["dashboard"]["widgets"]
    assert [(w["id"], w["kind"], w["size"]) for w in widgets] == [("al1", "kpi", 2), ("al2", "compare", 3)]
    assert analysed.get(f"/alteria/threads/{body['thread_id']}").json()["draft"]["name"] == "Agent quality"


def test_a_follow_up_in_the_same_chat_sees_the_history(analysed, wire):
    llm = wire(FakeLLM(PLAN, ANSWER, PLAN, ANSWER))
    first = ask(analysed).json()
    second = ask(analysed, "And by channel?", thread_id=first["thread_id"]).json()
    assert second["thread_id"] == first["thread_id"] and second["title"] == first["title"]
    assert "How many asked for a person?" in llm.calls[2]["user"]
    thread = analysed.get(f"/alteria/threads/{first['thread_id']}").json()
    assert [m["role"] for m in thread["messages"]] == ["user", "alteria", "user", "alteria"] and thread["message_count"] == 4


def test_a_failed_answer_keeps_the_question(analysed, wire):
    wire(FakeLLM(*[LLMError("down")] * 4))
    res = ask(analysed)
    assert res.status_code == 502
    thread = analysed.get("/alteria/threads").json()["threads"][0]
    full = analysed.get(f"/alteria/threads/{thread['id']}").json()
    assert full["messages"][0]["error"] and len(full["messages"]) == 1


def test_ask_needs_gemini(analysed, wire):
    wire(None)
    res = ask(analysed)
    assert res.status_code == 503 and "GEMINI_API_KEY" in res.json()["detail"]


def test_questions_are_unlimited_while_billing_is_off(analysed, wire, monkeypatch):
    monkeypatch.setattr(get_settings(), "ask_trial_questions", 0)
    wire(FakeLLM(PLAN, ANSWER))
    assert ask(analysed).status_code == 200


def test_free_questions_when_billing_is_on(analysed, wire, monkeypatch):
    monkeypatch.setattr(billing, "enabled", lambda: True)
    monkeypatch.setattr(get_settings(), "ask_trial_questions", 1)
    wire(FakeLLM(PLAN, ANSWER))
    assert ask(analysed).status_code == 200
    res = ask(analysed)
    assert res.status_code == 402 and res.json()["code"] == "plan_required"


def test_sharing_copying_pinning_and_deleting(analysed, wire, app, store, tenant):
    wire(FakeLLM(PLAN, ANSWER))
    tid = ask(analysed).json()["thread_id"]
    with as_member(app, store, tenant, "member") as teammate:
        assert analysed.get(f"/alteria/threads/{tid}").status_code == 404  # private
        assert analysed.get("/alteria/threads").json()["threads"] == []
    shared = analysed.post(f"/alteria/threads/{tid}/share").json()
    assert shared["shared_at"] and analysed.post(f"/alteria/threads/{tid}/share").json()["shared_at"] == shared["shared_at"]
    assert store.get(Thread, tid).shared
    assert [n.user_id for n in store.find(Notification, ("kind", "==", "chat_shared"))] == [teammate]

    with as_member(app, store, tenant, "member", user_id=teammate):
        assert analysed.get(f"/alteria/threads/{tid}").json()["mine"] is False
        assert [t["id"] for t in analysed.get("/alteria/threads").json()["threads"]] == [tid]
        refused = ask(analysed, thread_id=tid)
        assert refused.status_code == 403 and "Continue in a copy" in refused.json()["detail"]
        assert analysed.patch(f"/alteria/threads/{tid}", json={"title": "Mine now"}).status_code == 403
        assert analysed.patch(f"/alteria/threads/{tid}", json={"pinned": True}).json()["pinned"] is True
        copy = analysed.post(f"/alteria/threads/{tid}/copy").json()
        assert copy["mine"] and copy["copied_from"]["id"] == tid and copy["message_count"] == 2
        assert copy["preview"].startswith("How many") and not copy["shared_at"]
        assert analysed.delete(f"/alteria/threads/{tid}").status_code == 403
    assert analysed.get(f"/alteria/threads/{tid}").json()["pinned"] is False  # pins are per person

    with as_member(app, store, tenant, "member", user_id=teammate):
        result = analysed.post("/alteria/threads/bulk", json={"ids": [tid, "th-nope"], "action": "delete"}).json()
        assert result["done"] == [] and {f["id"] for f in result["failed"]} == {tid, "th-nope"}
    assert analysed.post("/alteria/threads/bulk", json={"ids": [tid], "action": "delete"}).json()["done"] == [tid]
    assert store.get(Thread, tid) is None and store.find(ThreadMessage, ("thread_id", "==", tid)) == []
    assert store.get(Thread, copy["id"]) is not None  # copies stay


def test_renaming_and_searching_chats(analysed, wire):
    wire(FakeLLM(PLAN, ANSWER))
    tid = ask(analysed).json()["thread_id"]
    renamed = analysed.patch(f"/alteria/threads/{tid}", json={"title": "Escalations"}).json()
    assert renamed["title"] == "Escalations" and renamed["message_count"] == 2
    assert [t["id"] for t in analysed.get("/alteria/threads", params={"q": "escalat"}).json()["threads"]] == [tid]
    assert [t["id"] for t in analysed.get("/alteria/threads", params={"q": "a person"}).json()["threads"]] == [tid]  # in a message
    assert analysed.get("/alteria/threads", params={"q": "weather"}).json()["threads"] == []


def test_chats_page_with_pinned_first(analysed, wire):
    wire(FakeLLM(*[PLAN, ANSWER] * 3))
    ids = [ask(analysed, f"Question {i}?").json()["thread_id"] for i in range(3)]
    analysed.patch(f"/alteria/threads/{ids[0]}", json={"pinned": True})
    first = analysed.get("/alteria/threads", params={"limit": 2}).json()
    assert [t["id"] for t in first["threads"]] == [ids[0], ids[2]] and first["next"] == "2"
    rest = analysed.get("/alteria/threads", params={"limit": 2, "before": first["next"]}).json()
    assert [t["id"] for t in rest["threads"]] == [ids[1]] and rest["next"] is None


def test_sharing_is_pro_when_billing_is_on(analysed, wire, monkeypatch):
    wire(FakeLLM(PLAN, ANSWER))
    tid = ask(analysed).json()["thread_id"]
    everything = billing.features(billing.account(None, "any"))
    monkeypatch.setattr(billing, "features", lambda acc: {**everything, "share_chats": False})
    res = analysed.post(f"/alteria/threads/{tid}/share")
    assert res.status_code == 402 and res.json()["feature"] == "share_chats"
    assert analysed.post("/alteria/threads/bulk", json={"ids": [tid], "action": "share"}).status_code == 402
    assert analysed.post("/alteria/threads/bulk", json={"ids": [tid], "action": "pin"}).json()["done"] == [tid]
