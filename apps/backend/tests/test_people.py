"""People, roles, the workspace, onboarding and invite links (B42, B50, B52), notifications, billing off.

These tests mount only the routers this file covers on a small app, so they run whether or not the
other route modules are importable. Signing in is Firebase with `firebase_auth.verify` mocked.
"""

from datetime import timedelta
from itertools import count

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from aftercall import deps, firebase_auth, notify, workspaces
from aftercall.errors import Problem, problem_handler
from aftercall.firebase_auth import FirebaseAuthError, FirebaseSession
from aftercall.models import Invite, Member, Notification, Project, Tenant, User, utcnow
from aftercall.routes import billing, docs, notifications, projects, workspace
from aftercall.routes import people as people_routes

ROUTERS = (people_routes, workspace, notifications, projects, billing, docs)
_uids = count(1)


@pytest.fixture
def app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(Problem, problem_handler)
    for area in ROUTERS:
        app.include_router(area.router)
    return app


@pytest.fixture
def client(store, tenant, app):
    """The workspace owner, through the workspace's API key."""
    with TestClient(app) as c:
        c.headers["X-API-Key"] = tenant.api_key
        yield c


@pytest.fixture
def firebase(monkeypatch):
    """verify() returns the session registered for a token; anything else is invalid."""
    tokens: dict[str, FirebaseSession] = {}

    def verify(token: str) -> FirebaseSession:
        if token not in tokens:
            raise FirebaseAuthError("bad token")
        return tokens[token]

    monkeypatch.setattr(firebase_auth, "verify", verify)
    monkeypatch.setattr(firebase_auth, "enabled", lambda: True)
    return tokens


def sign_in(app, firebase, email: str, verified: bool = True, name: str = "Pat") -> TestClient:
    """A client signed in with Firebase as a person with this email (no API key)."""
    uid = f"g{next(_uids)}"
    firebase[uid] = FirebaseSession(uid=uid, email=email, email_verified=verified, name=name, picture=None,
                                    google=True, auth_time=utcnow() - timedelta(minutes=5))
    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {uid}"
    return c


def teammate(app, firebase, store, tenant, role: str, email: str | None = None) -> TestClient:
    """A signed-in member of the workspace with this role."""
    c = sign_in(app, firebase, email or f"{role}-{next(_uids)}@example.com")
    user_id = c.get("/me").json()["id"]
    store.put(Member(tenant_id=tenant.id, user_id=user_id, role=role))
    return c


# ── Me, roles and the team ───────────────────────────────────────────────────


def test_me(client, app, firebase, store, tenant):
    me = client.get("/me").json()
    assert me["role"] == "owner" and me["onboarded"] and "billing.manage" in me["permissions"]
    updated = client.patch("/me", json={"name": "Sam", "notifications": {"run_finished": True}}).json()
    assert updated["name"] == "Sam" and updated["notifications"]["run_finished"] and updated["notifications"]["low_balance"]
    assert client.get("/me").json()["name"] == "Sam"
    assert teammate(app, firebase, store, tenant, "viewer").get("/me").json()["permissions"] == ["ask"]


def test_a_new_firebase_person_is_signed_in_but_not_onboarded(app, firebase, store):
    c = sign_in(app, firebase, "new@acme.example")
    me = c.get("/me").json()
    assert me["onboarded"] is False and me["permissions"] == [] and me["sign_in"]["google"]
    assert c.get("/team").json()["code"] == "onboarding_required"
    assert TestClient(app).get("/me").status_code == 401


def test_roles_are_enforced_on_the_server(app, firebase, store, tenant):
    viewer = teammate(app, firebase, store, tenant, "viewer")
    assert viewer.get("/team").status_code == 200
    assert viewer.post("/team/invites", json={"email": "x@y.example", "role": "viewer"}).status_code == 403
    assert viewer.patch("/workspace", json={"name": "Nope"}).status_code == 403
    assert viewer.post("/projects", json={"name": "Mine"}).status_code == 403
    member = teammate(app, firebase, store, tenant, "member")
    assert member.post("/team/invites", json={"email": "x@y.example", "role": "viewer"}).json()["code"] == "role_required"


def test_team_invites_and_roles(client):
    res = client.post("/team/invites", json={"email": "Priya@Sunrise.example", "role": "admin"})
    assert res.status_code == 201 and res.json()["email"] == "priya@sunrise.example"
    assert "/invite/" in res.json()["link"]
    assert client.post("/team/invites", json={"email": "priya@sunrise.example", "role": "member"}).status_code == 409
    assert client.post("/team/invites", json={"email": "not-an-email", "role": "member"}).status_code == 422
    assert client.post("/team/invites", json={"email": "mei@sunrise.example", "role": "viewer"}).status_code == 201

    team = client.get("/team").json()
    assert team["limit"] is None and len(team["invites"]) == 2 and len(team["members"]) == 1
    assert all(i["link"] and i["invited_by"]["id"] == team["members"][0]["id"] for i in team["invites"])

    invite = team["invites"][0]
    resent = client.post(f"/team/invites/{invite['id']}/resend").json()
    assert resent["id"] == invite["id"] and resent["link"] != invite["link"]
    assert client.delete(f"/team/invites/{invite['id']}").status_code == 204
    assert client.delete(f"/team/invites/{invite['id']}").status_code == 404
    assert len(client.get("/team").json()["invites"]) == 1

    owner_id = client.get("/me").json()["id"]
    assert client.patch(f"/team/members/{owner_id}", json={"role": "member"}).status_code == 409
    assert client.delete(f"/team/members/{owner_id}").status_code == 409


def test_team_lists_members_and_changes_roles(client, app, firebase, store, tenant):
    teammate(app, firebase, store, tenant, "member", email="dan@example.com")
    members = client.get("/team").json()["members"]
    assert [m["role"] for m in members] == ["owner", "member"] and members[1]["email"] == "dan@example.com"
    assert client.post("/team/invites", json={"email": "DAN@example.com", "role": "member"}).status_code == 409

    dan = members[1]["id"]
    assert client.patch(f"/team/members/{dan}", json={"role": "admin"}).json()["role"] == "admin"
    bell = [n.title for n in store.find(Notification, ("user_id", "==", dan))]
    assert bell == ["You're now a admin in Test Co"]
    assert client.patch("/team/members/nobody", json={"role": "admin"}).status_code == 404
    assert client.delete(f"/team/members/{dan}").status_code == 204
    assert len(client.get("/team").json()["members"]) == 1


def test_a_member_cannot_remove_themselves(app, firebase, store, tenant):
    admin = teammate(app, firebase, store, tenant, "admin")
    assert admin.delete(f"/team/members/{admin.get('/me').json()['id']}").status_code == 409


# ── Workspace ────────────────────────────────────────────────────────────────


def test_workspace_address_and_domains(client, app, firebase, store, tenant):
    ws = client.get("/workspace").json()
    assert ws["slug"] == "test-co" and ws["default_role"] == "member" and ws["id"] == tenant.id
    assert client.get("/workspace/slug/test-co").json()["available"] is True  # its own
    assert client.get("/workspace/slug/admin").json() == {"slug": "admin", "available": False, "suggestion": "admin-2"}
    assert client.get("/workspace/slug/Bad Slug").status_code == 422
    assert client.patch("/workspace", json={"allowed_domains": ["gmail.com"]}).status_code == 422
    assert client.patch("/workspace", json={"allowed_domains": ["unverified.example"]}).status_code == 422

    admin = teammate(app, firebase, store, tenant, "admin", email="asha@sunrise.example")
    body = admin.patch("/workspace", json={"allowed_domains": ["@Sunrise.example"], "join_by_domain": True, "slug": "sunrise"}).json()
    assert body["allowed_domains"] == ["sunrise.example"] and body["slug"] == "sunrise"
    assert store.get(Tenant, tenant.id).join_by_domain is True
    assert admin.patch("/workspace", json={"currency": "XYZ"}).status_code == 422
    assert admin.patch("/workspace", json={"currency": "inr"}).json()["currency"] == "INR"


def test_a_domain_can_belong_to_one_workspace(client, app, firebase, store, tenant):
    other, _ = workspaces.create(store, "Other", None)
    store.update(Tenant, other.id, allowed_domains=["sunrise.example"])
    admin = teammate(app, firebase, store, tenant, "admin", email="asha@sunrise.example")
    assert admin.patch("/workspace", json={"allowed_domains": ["sunrise.example"]}).status_code == 409


# ── Onboarding ───────────────────────────────────────────────────────────────


def test_onboarding_joins_by_domain(client, app, firebase, store, tenant):
    admin = teammate(app, firebase, store, tenant, "admin", email="asha@sunrise.example")
    admin.patch("/workspace", json={"allowed_domains": ["sunrise.example"], "join_by_domain": True})

    newcomer = sign_in(app, firebase, "new@sunrise.example")
    joinable = newcomer.get("/onboarding/joinable").json()
    assert [(j["slug"], j["role"], j["members"]) for j in joinable] == [("test-co", "member", 2)]
    me = newcomer.post("/onboarding", json={"name": "Neha", "join": "test-co"}).json()
    assert me["onboarded"] and me["role"] == "member" and me["name"] == "Neha"
    assert newcomer.get("/workspace").json()["slug"] == "test-co"
    assert newcomer.get("/onboarding/joinable").json() == []
    assert "Neha joined as a member" in [n["title"] for n in client.get("/notifications").json()["items"]]


def test_onboarding_creates_a_workspace_for_a_new_person(app, firebase, store):
    founder = sign_in(app, firebase, "founder@acme.example")
    assert founder.post("/onboarding", json={"name": "Fay"}).status_code == 422
    assert founder.post("/onboarding", json={"name": "Fay", "join": "nowhere"}).status_code == 403

    spec = {"name": "Acme", "slug": "acme", "allowed_domains": ["acme.example"], "join_by_domain": True}
    me = founder.post("/onboarding", json={"name": "Fay", "workspace": spec,
                                           "invites": [{"email": "ops@acme.example", "role": "viewer"}]}).json()
    assert me["role"] == "owner" and me["onboarded"] and me["name"] == "Fay"
    ws = founder.get("/workspace").json()
    assert ws["slug"] == "acme" and ws["allowed_domains"] == ["acme.example"] and ws["join_by_domain"]
    team = founder.get("/team").json()
    assert [i["email"] for i in team["invites"]] == ["ops@acme.example"]
    assert store.count(Project, ("tenant_id", "==", ws["id"])) == 1  # the default project


def test_onboarding_refuses_a_taken_address_and_leaves_nothing_behind(client, app, firebase, store):
    founder = sign_in(app, firebase, "founder@acme.example")
    taken = founder.post("/onboarding", json={"name": "Fay", "workspace": {"name": "Acme", "slug": "test-co"}})
    assert taken.status_code == 409
    bad_domain = founder.post("/onboarding", json={"name": "Fay", "workspace": {"name": "Acme", "slug": "acme", "allowed_domains": ["other.example"]}})
    assert bad_domain.status_code == 422
    bad_invite = founder.post("/onboarding", json={"name": "Fay", "workspace": {"name": "Acme", "slug": "acme"},
                                                  "invites": [{"email": "nope", "role": "member"}]})
    assert bad_invite.status_code == 422
    assert store.count(Tenant) == 1 and founder.get("/me").json()["onboarded"] is False


# ── Invite links ─────────────────────────────────────────────────────────────


def test_invite_links(client, app, firebase, store, tenant):
    link = client.post("/team/invites", json={"email": "guest@else.example", "role": "viewer"}).json()["link"]
    token = link.rsplit("/", 1)[1]
    info = TestClient(app).get(f"/invites/{token}").json()
    assert info["workspace"]["name"] == "Test Co" and info["role"] == "viewer" and info["email"] == "guest@else.example"

    stranger = sign_in(app, firebase, "someone@else.example")
    assert stranger.post(f"/invites/{token}/accept").status_code == 403  # a different address
    unverified = sign_in(app, firebase, "guest@else.example", verified=False)
    assert unverified.post(f"/invites/{token}/accept").status_code == 403

    guest = sign_in(app, firebase, "guest@else.example", name="Gus")
    me = guest.post(f"/invites/{token}/accept").json()
    assert me["role"] == "viewer" and me["onboarded"]
    assert guest.get("/workspace").json()["name"] == "Test Co"
    assert client.get(f"/invites/{token}").status_code == 404  # used up
    assert [n["kind"] for n in client.get("/notifications").json()["items"]] == ["invite_accepted"]


def test_expired_and_resent_invite_links(client, app, store):
    invite_json = client.post("/team/invites", json={"email": "guest@else.example", "role": "member"}).json()
    old = invite_json["link"].rsplit("/", 1)[1]
    new = client.post(f"/team/invites/{invite_json['id']}/resend").json()["link"].rsplit("/", 1)[1]
    anon = TestClient(app)
    assert anon.get(f"/invites/{old}").status_code == 404 and anon.get(f"/invites/{new}").status_code == 200
    store.update(Invite, invite_json["id"], expires_at=utcnow() - timedelta(days=1))
    assert anon.get(f"/invites/{new}").status_code == 404
    assert client.get("/team").json()["invites"] == []


# ── Notifications ────────────────────────────────────────────────────────────


def send(store, tenant, user_id: str, n: int) -> None:
    for i in range(n):
        notify.send(store, tenant.id, "run_finished", f"Run {i}", [user_id], body="2 conversations", href="/results")
    for i, row in enumerate(store.find(Notification, ("user_id", "==", user_id))):  # distinct times: the cursor is a time
        store.update(Notification, row.id, created_at=utcnow() - timedelta(minutes=i))


def test_notifications_page_and_mark_read(client, store, tenant):
    me = client.get("/me").json()["id"]
    send(store, tenant, me, 35)
    first = client.get("/notifications").json()
    assert len(first["items"]) == 30 and first["unread"] == 35 and first["next_cursor"]
    rest = client.get("/notifications", params={"cursor": first["next_cursor"]}).json()
    assert len(rest["items"]) == 5 and rest["next_cursor"] is None
    assert {n["id"] for n in first["items"]}.isdisjoint(n["id"] for n in rest["items"])

    ids = [n["id"] for n in first["items"][:2]]
    assert client.post("/notifications/read", json={"ids": ids}).json() == {"unread": 33}
    assert len(client.get("/notifications", params={"unread": True}).json()["items"]) == 30
    assert client.post("/notifications/read", json={"all": True}).json() == {"unread": 0}
    assert client.get("/notifications", params={"unread": True}).json()["items"] == []


def test_notifications_are_private_and_show_who_did_it(client, app, firebase, store, tenant):
    dan = teammate(app, firebase, store, tenant, "member")
    dan_id, owner_id = dan.get("/me").json()["id"], client.get("/me").json()["id"]
    notify.send(store, tenant.id, "member_joined", "Dan joined", [owner_id, dan_id], actor_id=dan_id)
    items = client.get("/notifications").json()["items"]
    assert [n["title"] for n in items] == ["Dan joined"] and items[0]["actor"]["id"] == dan_id
    assert dan.get("/notifications").json()["items"] == []  # his own action doesn't notify him
    mine = client.get("/notifications").json()["items"][0]["id"]
    assert dan.post("/notifications/read", json={"ids": [mine]}).json() == {"unread": 0}
    assert client.get("/notifications").json()["unread"] == 1  # not his to mark


# ── Billing is off ───────────────────────────────────────────────────────────


def test_billing_reads_as_off(client):
    b = client.get("/billing").json()
    assert (b["enabled"], b["plan"], b["balance"], b["plans"]) == (False, "payg", 0.0, [])
    assert (b["period_start"], b["period_end"], b["auto_renew"], b["included_tokens"]) == (None, None, False, 0)
    assert b["alteria"] is True and all(b["features"].values()) and set(b["limits"].values()) == {None}
    assert b["currency"]["code"] == "USD" and b["promotion"] is None and b["subscription"] is None
    pricing = client.get("/pricing").json()
    assert pricing["enabled"] is False and pricing["plans"] == [] and pricing["promotion"] is None
    assert client.get("/account").json() == {"name": "Test Co", "plan": "payg", "project_limit": None, "projects": 1}


@pytest.mark.parametrize("method, path", [
    ("post", "/billing/checkout"), ("post", "/billing/subscribe"), ("post", "/billing/cancel"), ("post", "/billing/portal"),
    ("post", "/billing/quote"), ("put", "/billing/auto_top_up"), ("get", "/billing/ledger"), ("get", "/billing/invoices"),
    ("post", "/webhooks/stripe"), ("post", "/webhooks/clerk"),
])
def test_payment_endpoints_are_gone(client, method, path):
    assert getattr(client, method)(path).status_code in (404, 405)


def test_pricing_is_public(app):
    assert TestClient(app).get("/pricing", headers={"cf-ipcountry": "IN"}).json()["currency"]["code"] == "INR"


# ── Docs feedback and sign-out ───────────────────────────────────────────────


def test_docs_feedback_is_rate_limited(app, store):
    anon = TestClient(app)
    body = {"slug": "getting-started", "helpful": True, "comment": " nice "}
    for _ in range(docs.PER_HOUR):
        assert anon.post("/docs/feedback", json=body).status_code == 204
    assert anon.post("/docs/feedback", json=body).status_code == 429
    assert anon.post("/docs/feedback", json=body, headers={"cf-connecting-ip": "203.0.113.9"}).status_code == 204


def test_sign_out_clears_the_cookie(app):
    res = TestClient(app).post("/auth/logout")
    assert res.status_code == 204 and "__session" in res.headers["set-cookie"]


def test_a_person_in_two_workspaces_is_not_onboarded_until_they_choose(app, firebase, store):
    c = sign_in(app, firebase, "multi@acme.example")
    user = store.get(User, c.get("/me").json()["id"])
    workspaces.create(store, "One", user)
    workspaces.create(store, "Two", user)
    assert c.get("/me").json()["onboarded"] is False
    assert deps._by_firebase(store, c.headers["Authorization"].removeprefix("Bearer ")).tenant is None
