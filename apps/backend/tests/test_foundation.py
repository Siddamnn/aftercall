"""Models, workspaces, sign-in (Firebase mocked), people and the billing-off stubs."""

from datetime import timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from aftercall import billing, deps, firebase_auth, people, usage, workspaces
from aftercall.errors import Problem, problem_handler
from aftercall.firebase_auth import FirebaseAuthError, FirebaseSession
from aftercall.models import Answer, Call, Invite, Member, Project, Signal, SignalVersion, Tenant, User, utcnow
from aftercall.store import MemoryStore


def session(uid="g1", email="asha@acme.com", hours_ago=1.0) -> FirebaseSession:
    return FirebaseSession(uid=uid, email=email, email_verified=True, name="Asha", picture="http://p/a.png",
                           google=True, auth_time=utcnow() - timedelta(hours=hours_ago))


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


def test_composite_ids_are_derived():
    assert Member(tenant_id="w-1", user_id="u-2", role="admin").id == "w-1:u-2"
    assert SignalVersion(signal_id="s-1", version=3, spec={}).id == "s-1:3"
    answer = Answer(run_id="r-1", tracker_name="a", signal_name="b", call_id="c", tenant_id="w", project_id="p",
                    signal_version=1, type="choice", value_text="x", confidence=0.9, needs_review=False)
    assert answer.id == "r-1:a:b"
    assert Member(id="custom", tenant_id="w", user_id="u", role="owner").id == "custom"


def test_models_round_trip_through_the_store(store):
    tenant, _ = workspaces.create(store, "Acme", None)
    assert tenant.id.startswith("w-")
    assert store.get(Tenant, tenant.id).slug == "acme"
    call = Call(tenant_id=tenant.id, project_id="p", transcript="hi", transcript_tokens=1, status="queued",
                meta={"k": "v"})
    store.put(call)
    assert store.claim(Call, call.id, {"status": "queued"}, {"status": "processing"}).status == "processing"
    assert store.claim(Call, call.id, {"status": "queued"}, {"status": "processing"}) is None
    answer = Answer.for_call(call, run_id="r", tracker_name="t", signal_name="s", signal_version=1, type="yes_no",
                             value_text="yes", confidence=1.0, needs_review=False)
    assert (answer.channel, answer.meta, answer.project_id) == (call.channel, {"k": "v"}, "p")


def test_signal_activate_copies_the_version():
    signal = Signal(tenant_id="w", project_id="p", tracker_id="t", tracker_name="outcome", name="booked")
    version = SignalVersion(signal_id=signal.id, version=2, spec={"name": "booked"})
    signal.activate(version)
    assert (signal.active_version_id, signal.active_version, signal.active_spec) == (version.id, 2, {"name": "booked"})


class TestWorkspaces:
    def test_create_makes_owner_and_default_project(self, store):
        owner = User(name="O")
        store.put(owner)
        tenant, key = workspaces.create(store, "Acme Collections", owner)
        assert workspaces.by_api_key(store, key).id == tenant.id
        assert workspaces.owner_of(store, tenant).id == owner.id
        project = workspaces.default_project(store, tenant)
        assert project.is_default and workspaces.default_project(store, tenant).id == project.id
        assert store.count(Project, ("tenant_id", "==", tenant.id)) == 1

    def test_slugs_stay_unique_and_reserved_ones_are_refused(self, store):
        a, _ = workspaces.create(store, "Acme", None)
        b, _ = workspaces.create(store, "Acme", None)
        assert (a.slug, b.slug) == ("acme", "acme-2")
        assert not workspaces.slug_free(store, "admin")
        assert workspaces.slug_free(store, "acme", a.id)

    def test_rotate_key_replaces_the_old_one(self, store):
        tenant, old = workspaces.create(store, "Acme", None)
        new = workspaces.rotate_key(store, tenant)
        assert workspaces.by_api_key(store, old) is None
        assert workspaces.by_api_key(store, new).id == tenant.id

    def test_seed_demo_is_idempotent(self, store):
        first = workspaces.seed_demo(store, "demo-key")
        assert workspaces.seed_demo(store, "demo-key").id == first.id
        assert store.count(Tenant) == 1 and workspaces.by_api_key(store, "demo-key").slug == "demo"


class TestSignIn:
    def who(self, store, token="t"):
        return deps._by_firebase(store, token)

    def test_first_sign_in_creates_the_user_without_a_workspace(self, store, firebase):
        firebase["t"] = session()
        who = self.who(store)
        assert who.tenant is None and who.role is None
        assert (who.user.id, who.user.email, who.user.firebase_uid, who.user.google) == ("u-g1", "asha@acme.com", "g1", True)
        assert who.user.name == "Asha" and who.session_expires_at > utcnow()
        assert self.who(store).user.id == who.user.id and store.count(User) == 1

    def test_a_person_in_one_workspace_gets_it(self, store, firebase):
        firebase["t"] = session()
        user = self.who(store).user
        tenant, _ = workspaces.create(store, "Acme", user)
        who = self.who(store)
        assert (who.tenant.id, who.role) == (tenant.id, "owner")
        assert store.get(Member, f"{tenant.id}:{user.id}").last_active_at is not None

    def test_a_person_in_two_workspaces_must_choose(self, store, firebase):
        firebase["t"] = session()
        user = self.who(store).user
        workspaces.create(store, "One", user)
        workspaces.create(store, "Two", user)
        assert self.who(store).tenant is None

    def test_an_existing_user_with_the_same_email_is_linked(self, store, firebase):
        existing = User(name="Owner", email="asha@acme.com")
        store.put(existing)
        firebase["t"] = session()
        who = self.who(store)
        assert who.user.id == existing.id and who.user.firebase_uid == "g1" and store.count(User) == 1

    def test_invalid_token_is_401(self, store, firebase):
        with pytest.raises(HTTPException) as err:
            self.who(store, "nope")
        assert err.value.status_code == 401

    def test_sign_in_older_than_the_max_hours_is_401(self, store, firebase):
        firebase["t"] = session(hours_ago=6)
        with pytest.raises(HTTPException) as err:
            self.who(store)
        assert err.value.status_code == 401 and "ended" in err.value.detail


def deps_app() -> FastAPI:
    """Just the auth dependencies, so they're tested without the route modules."""
    app = FastAPI()
    app.add_exception_handler(Problem, problem_handler)

    @app.get("/who")
    def who(w: deps.SignedInDep) -> dict:
        return {"user": w.user.id, "tenant": w.tenant.id if w.tenant else None, "role": w.role}

    @app.get("/member")
    def member(w: deps.MemberDep) -> dict:
        return {"role": w.role}

    @app.get("/project")
    def project(p: deps.ProjectDep) -> dict:
        return {"id": p.id}

    return app


class TestDeps:
    def test_api_key_acts_as_the_owner(self, store, tenant):
        r = TestClient(deps_app()).get("/who", headers={"X-API-Key": tenant.api_key})
        assert r.status_code == 200 and (r.json()["role"], r.json()["tenant"]) == ("owner", tenant.id)
        assert TestClient(deps_app()).get("/who", headers={"X-API-Key": "wrong"}).status_code == 401

    def test_bearer_token_and_cookie_sign_in(self, store, firebase):
        firebase["tok"] = session()
        c = TestClient(deps_app())
        r = c.get("/who", headers={"Authorization": "Bearer tok"})
        assert r.status_code == 200 and r.json()["tenant"] is None
        assert c.get("/who", headers={"Authorization": "Bearer bad"}).status_code == 401
        assert c.get("/who", cookies={"__session": "tok"}).status_code == 200
        assert c.get("/who").status_code == 401

    def test_no_workspace_means_onboarding(self, store, firebase):
        firebase["tok"] = session()
        r = TestClient(deps_app()).get("/member", headers={"Authorization": "Bearer tok"})
        assert r.status_code == 403 and r.json()["code"] == "onboarding_required"

    def test_project_header_picks_a_project_in_the_workspace(self, store, tenant):
        c = TestClient(deps_app())
        key = {"X-API-Key": tenant.api_key}
        default = c.get("/project", headers=key).json()["id"]
        other = Project(tenant_id=tenant.id, name="Other")
        foreign = Project(tenant_id="w-other", name="Foreign")
        store.put_many([other, foreign])
        assert c.get("/project", headers=key | {"X-Project": other.id}).json()["id"] == other.id
        assert c.get("/project", headers=key | {"X-Project": foreign.id}).status_code == 404
        assert c.get("/project", headers=key).json()["id"] == default


class TestApi:
    """Needs every route module, so it runs once they're ported."""

    @pytest.fixture
    def app(self):
        try:
            from aftercall.api import app
        except ImportError as exc:  # routes not ported yet
            pytest.skip(f"routes not importable yet: {exc}")
        return app

    def test_api_prefix_is_stripped(self, app, store):
        with TestClient(app) as c:
            assert c.get("/api/health").json() == {"status": "ok"}
            assert c.get("/health").json() == {"status": "ok"}

    def test_dev_api_key_seeds_a_demo_workspace(self, app, store, monkeypatch):
        from aftercall.config import get_settings

        monkeypatch.setenv("DEV_API_KEY", "dev-secret")
        get_settings.cache_clear()
        try:
            for _ in range(2):  # a second start doesn't duplicate it
                with TestClient(app) as c:
                    assert c.get("/me", headers={"X-API-Key": "dev-secret"}).status_code == 200
            assert store.count(Tenant) == 1
        finally:
            monkeypatch.delenv("DEV_API_KEY")
            get_settings.cache_clear()


class TestPeople:
    def test_invites_expire_and_renew(self, store):
        tenant, _ = workspaces.create(store, "Acme", None)
        owner = workspaces.owner_of(store, tenant)
        invite = people.create_invite(store, tenant, "new@acme.com", "member", owner)
        assert [i.id for i in people.open_invites(store, tenant.id)] == [invite.id]
        old = invite.token
        assert people.renew_invite(store, invite).token != old
        store.update(Invite, invite.id, expires_at=utcnow() - timedelta(days=1))
        assert people.open_invites(store, tenant.id) == []
        people.revoke_invite(store, invite)
        assert store.count(Invite) == 0

    def test_seats_count_everyone_but_viewers(self, store):
        tenant, _ = workspaces.create(store, "Acme", None)
        owner = workspaces.owner_of(store, tenant)
        store.put(Member(tenant_id=tenant.id, user_id="u-v", role="viewer"))
        people.create_invite(store, tenant, "a@acme.com", "member", owner)
        assert people.seats(store, tenant.id) == 2
        assert people.teammate_limit(store, tenant.id) is None

    def test_clean_email(self):
        assert people.clean_email(" A@Acme.com ") == "a@acme.com"
        with pytest.raises(HTTPException):
            people.clean_email("nope")


class TestBillingOff:
    def test_nothing_is_charged_or_refused(self, store):
        acc = billing.account(store, "w-1")
        q = billing.quote(acc, [100, 200])
        assert (billing.enabled(), q.tokens, q.micros, q.shortfall_micros, q.per_call) == (False, 300, 0, 0, [(0, 0), (0, 0)])
        assert billing.token_cost(300) is None and all(billing.features(acc).values())
        assert billing.limits(acc, 0) == {"teammates": None, "projects": None, "alteria_trial_left": None}

    def test_usage_records_tokens(self, store):
        tenant, _ = workspaces.create(store, "Acme", None)
        usage.record(store, tenant.id, "analysis", user_id="u1", project_id="p", tokens=120, ref="c1")
        usage.record(store, tenant.id, "alteria_ask", user_id="u2", project_id="p")
        assert usage.count(store, tenant.id, "analysis") == 1
        since = usage.month_start()
        assert len(usage.events(store, tenant.id, since)) == 2
        assert [e.tokens for e in usage.events(store, tenant.id, since, user_id="u1")] == [120]
        assert usage.allowance_micros(store, tenant, "u1", "member") is None


def test_memory_stores_are_isolated(store):
    other = MemoryStore()
    workspaces.create(store, "Acme", None)
    assert other.count(Tenant) == 0
