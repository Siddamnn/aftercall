"""Who is asking, in which workspace and project: the dependencies every route builds on.

Two ways in: a workspace API key (`X-API-Key`, for the API, the CLI and the dev proxy), which acts
as the workspace's owner; or a Firebase ID token (`Authorization: Bearer`, or the `__session` cookie),
which is a person with their role. Every decision is made here, from our own records, on every request.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status

from aftercall import firebase_auth, llm, permissions, workspaces
from aftercall.config import get_settings
from aftercall.errors import Problem, not_found, role_required
from aftercall.firebase_auth import FirebaseSession
from aftercall.jev import Engine, JevClient
from aftercall.llm import LLM
from aftercall.models import Member, Project, Tenant, User, aware, utcnow
from aftercall.store import Store, get_store

StoreDep = Annotated[Store, Depends(get_store)]
ACTIVITY_EVERY = timedelta(minutes=5)


@dataclass
class Who:
    user: User
    tenant: Tenant | None  # None until the person finishes onboarding
    role: str | None
    session_expires_at: datetime | None = None

    @property
    def workspace(self) -> Tenant:
        assert self.tenant is not None
        return self.tenant


def _unauthorized(detail: str = "Sign in, or send an X-API-Key header") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail)


def _by_api_key(store: Store, api_key: str) -> Who:
    tenant = workspaces.by_api_key(store, api_key)
    if tenant is None:
        raise _unauthorized("Missing or invalid X-API-Key header")
    return Who(user=workspaces.owner_of(store, tenant), tenant=tenant, role="owner")


def _session_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    return auth.removeprefix("Bearer ").strip() if auth.startswith("Bearer ") else request.cookies.get("__session")


def user_for(store: Store, sign_in: FirebaseSession) -> User:
    """The person behind a token. First sign-in creates them (id `u-<uid>`); someone already made with
    this email (the CLI's owner) is linked instead of duplicated."""
    user = store.get(User, f"u-{sign_in.uid}") or store.first(User, ("firebase_uid", "==", sign_in.uid))
    if user is None and sign_in.email and sign_in.email_verified:
        match = store.first(User, ("email", "==", sign_in.email))
        user = match if match is not None and match.firebase_uid is None else None
    if user is None:
        user = User(id=f"u-{sign_in.uid}")
    user.firebase_uid, user.google = sign_in.uid, sign_in.google
    user.email, user.email_verified = sign_in.email or user.email, sign_in.email_verified
    user.name, user.avatar_url = user.name or sign_in.name, sign_in.picture or user.avatar_url
    store.put(user)
    return user


def _session_expiry(sign_in: FirebaseSession) -> datetime:
    """When this sign-in ends: SESSION_MAX_HOURS after the person last signed in, however long the page stays open."""
    expires = aware(sign_in.auth_time) + timedelta(hours=get_settings().session_max_hours)
    if expires <= utcnow():
        raise _unauthorized("Your session has ended. Sign in again.")
    return expires


def _membership(store: Store, user: User) -> Member | None:
    """The workspace for this person: the only one they're in, else none (they choose or onboard)."""
    members = workspaces.memberships_of(store, user.id)
    return members[0] if len(members) == 1 else None


def _by_firebase(store: Store, token: str) -> Who:
    try:
        sign_in = firebase_auth.verify(token)
    except firebase_auth.FirebaseAuthError:
        raise _unauthorized("Your session has ended. Sign in again.") from None
    expires = _session_expiry(sign_in)
    user = user_for(store, sign_in)
    member = _membership(store, user)
    tenant = store.get(Tenant, member.tenant_id) if member else None
    if member is None or tenant is None:
        return Who(user=user, tenant=None, role=None, session_expires_at=expires)
    if member.last_active_at is None or utcnow() - aware(member.last_active_at) > ACTIVITY_EVERY:
        store.update(Member, member.id, last_active_at=utcnow())
    return Who(user=user, tenant=tenant, role=member.role, session_expires_at=expires)


def signed_in(request: Request, store: StoreDep, x_api_key: Annotated[str | None, Header()] = None) -> Who:
    """Anyone signed in, with or without a workspace yet (for /me and onboarding)."""
    if x_api_key:
        return _by_api_key(store, x_api_key)
    token = _session_token(request)
    if token and firebase_auth.enabled():
        return _by_firebase(store, token)
    raise _unauthorized()


SignedInDep = Annotated[Who, Depends(signed_in)]


def member(who: SignedInDep) -> Who:
    if who.tenant is None:
        raise Problem(status.HTTP_403_FORBIDDEN, "Finish setting up your workspace first.", "onboarding_required")
    return who


MemberDep = Annotated[Who, Depends(member)]


def require(permission: str):
    """A dependency: the person's role must allow `permission` (403 otherwise)."""

    def check(who: MemberDep) -> Who:
        if not permissions.can(who.role or "", permission):
            raise role_required(permissions.REFUSALS[permission])
        return who

    return Depends(check)


def current_project(who: MemberDep, store: StoreDep, x_project: Annotated[str | None, Header()] = None) -> Project:
    """The project in `X-Project`, or the workspace's default one when there's no header (B37)."""
    if not x_project:
        return workspaces.default_project(store, who.workspace)
    project = store.get(Project, x_project)
    if project is None or project.tenant_id != who.workspace.id or project.deleted_at is not None:
        raise not_found("Project")
    return project


ProjectDep = Annotated[Project, Depends(current_project)]


def get_engine() -> Engine | None:
    """Jev, for work done inside a request (the overlap check). None when no key is configured."""
    s = get_settings()
    return JevClient(s.typesafe_api_key, s.jev_model, s.typesafe_base_url, s.jev_timeout_seconds) if s.typesafe_api_key else None


EngineDep = Annotated[Engine | None, Depends(get_engine)]


def get_llm() -> LLM | None:
    """Gemini, for alteria. None when it isn't configured."""
    return llm.default_client()


LLMDep = Annotated[LLM | None, Depends(get_llm)]
