"""The workspace, its address and who may join (B50); onboarding; invite links; sign-out."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from aftercall import notify, people, workspaces
from aftercall.config import get_settings
from aftercall.deps import MemberDep, SignedInDep, StoreDep, Who, require
from aftercall.errors import invalid
from aftercall.models import Invite, Member, Tenant, User, aware, utcnow
from aftercall.store import Store

router = APIRouter()
Editor = Annotated[Who, require("workspace.edit")]
UseCase = Literal["sales", "support", "voice_agents", "chat", "other"]


def workspace_out(t: Tenant) -> dict[str, Any]:
    return {"id": t.id, "name": t.name, "slug": t.slug, "logo_url": t.logo_url, "allowed_domains": t.allowed_domains or [],
            "join_by_domain": t.join_by_domain, "default_role": t.default_role, "currency": t.currency}


def _taken(slug: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, f"{get_settings().app_host}/{slug} is taken. Try another address.")


def _check_slug(store: Store, slug: str, tenant_id: str | None) -> str:
    if problem := workspaces.slug_problem(slug):
        raise invalid(problem)
    if not workspaces.slug_free(store, slug, tenant_id):
        raise _taken(slug)
    return slug


def _verified_domains(store: Store, tenant_id: str | None, user: User) -> set[str]:
    """Domains someone in the workspace (or the person setting it up) has a verified email at."""
    if tenant_id is None:
        users = [user]
    else:
        users = list(people.users_by_id(store, [m.user_id for m in workspaces.members_of(store, tenant_id)]).values())
    return {d for u in users if u.email_verified and (d := workspaces.email_domain(u.email))}


def _claimed_elsewhere(store: Store, domain: str, tenant_id: str | None) -> bool:
    return any(t.id != tenant_id for t in store.find(Tenant, ("allowed_domains", "array-contains", domain)))


def _check_domains(store: Store, domains: list[str], tenant_id: str | None, user: User) -> list[str]:
    cleaned = list(dict.fromkeys(d.strip().lower().removeprefix("@") for d in domains if d.strip()))
    verified = _verified_domains(store, tenant_id, user)
    for d in cleaned:
        if not workspaces.DOMAIN.match(d):
            raise invalid(f"{d} isn't a domain, like sunriseclinic.com")
        if d in workspaces.PUBLIC_EMAIL_DOMAINS:
            raise invalid(f"Anyone can get an @{d} address, so it can't let people join. Use your company's domain.")
        if d not in verified:
            raise invalid(f"No one in the workspace has a verified @{d} email yet, so it can't be added.")
        if _claimed_elsewhere(store, d, tenant_id):
            raise HTTPException(status.HTTP_409_CONFLICT, f"@{d} already lets people join another workspace.")
    return cleaned


@router.get("/workspace")
def get_workspace(who: MemberDep) -> dict[str, Any]:
    return workspace_out(who.workspace)


class WorkspacePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=60)
    slug: str | None = None
    allowed_domains: list[str] | None = None
    join_by_domain: bool | None = None
    default_role: Literal["member", "viewer"] | None = None
    currency: str | None = None


@router.patch("/workspace")
def update_workspace(body: WorkspacePatch, who: Editor, store: StoreDep) -> dict[str, Any]:
    """Owner and admins only. 409 when the address is taken."""
    t = who.workspace
    if body.name is not None:
        t.name = body.name.strip()
    if body.slug is not None and body.slug != t.slug:
        t.slug = _check_slug(store, body.slug, t.id)
    if body.allowed_domains is not None:
        t.allowed_domains = _check_domains(store, body.allowed_domains, t.id, who.user)
    if body.join_by_domain is not None:
        t.join_by_domain = body.join_by_domain
    if body.default_role is not None:
        t.default_role = body.default_role
    if "currency" in body.model_fields_set:
        if body.currency and body.currency.upper() not in get_settings().fx_rates:
            raise invalid(f"We don't show prices in {body.currency} yet")
        t.currency = body.currency.upper() if body.currency else None
    store.put(t)
    return workspace_out(t)


@router.get("/workspace/slug/{slug}")
def check_slug(slug: str, who: SignedInDep, store: StoreDep) -> dict[str, Any]:
    """Whether an address is free, with a free one near it when it isn't."""
    if problem := workspaces.slug_problem(slug):
        raise invalid(problem)
    tenant_id = who.tenant.id if who.tenant else None
    if workspaces.slug_free(store, slug, tenant_id):
        return {"slug": slug, "available": True, "suggestion": None}
    return {"slug": slug, "available": False, "suggestion": workspaces.free_slug(store, slug)}


def _joinable(store: Store, user: User) -> list[Tenant]:
    domain = workspaces.email_domain(user.email) if user.email_verified else None
    if domain is None:
        return []
    mine = {m.tenant_id for m in workspaces.memberships_of(store, user.id)}
    open_to_domain = store.find(Tenant, ("allowed_domains", "array-contains", domain))
    return [t for t in open_to_domain if t.join_by_domain and t.id not in mine]


@router.get("/onboarding/joinable")
def joinable(who: SignedInDep, store: StoreDep) -> list[dict[str, Any]]:
    """Workspaces the person may join because of their verified email's domain."""
    return [{"slug": t.slug, "name": t.name, "logo_url": t.logo_url,
             "members": store.count(Member, ("tenant_id", "==", t.id)), "role": t.default_role}
            for t in _joinable(store, who.user)]


class NewWorkspace(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    slug: str
    allowed_domains: list[str] = []
    join_by_domain: bool = False


class OnboardingInvite(BaseModel):
    email: str
    role: Literal["admin", "member", "viewer"]


class OnboardingIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    join: str | None = None
    workspace: NewWorkspace | None = None
    use_case: UseCase | None = None
    invites: list[OnboardingInvite] = []


def _join(store: Store, user: User, slug: str) -> Tenant:
    tenant = next((t for t in _joinable(store, user) if t.slug == slug), None)
    if tenant is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't join that workspace without an invite.")
    store.put(Member(tenant_id=tenant.id, user_id=user.id, role=tenant.default_role))
    notify.send(store, tenant.id, "member_joined", f"{user.name} joined as a {tenant.default_role}",
                notify.members_who_can(store, tenant.id, "team.manage"), actor_id=user.id, href="/settings/team")
    return tenant


def _create(store: Store, user: User, spec: NewWorkspace, invites: list[OnboardingInvite]) -> Tenant:
    """Everything is checked before the first write: nothing is rolled back if a later step fails."""
    slug = _check_slug(store, spec.slug, None)
    domains = _check_domains(store, spec.allowed_domains, None, user)
    emails = [(people.clean_email(i.email), i.role) for i in invites]
    tenant, _ = workspaces.create(store, spec.name.strip(), user, slug)
    tenant.allowed_domains, tenant.join_by_domain = domains, spec.join_by_domain
    store.put(tenant)
    for email, role in emails:
        people.create_invite(store, tenant, email, role, user)
    return tenant


@router.post("/onboarding")
def complete_onboarding(body: OnboardingIn, who: SignedInDep, store: StoreDep) -> dict[str, Any]:
    """Join a workspace (by the email-domain rule) or create one with invites, in one go."""
    if not body.join and not body.workspace:
        raise invalid("Join a workspace or create one")
    who.user.name = body.name.strip()
    store.update(User, who.user.id, name=who.user.name)
    tenant = _join(store, who.user, body.join) if body.join else _create(store, who.user, body.workspace, body.invites)
    member = store.get(Member, Member.make_id(tenant.id, who.user.id))
    return people.me_out(store, who.user, tenant, member.role, who.session_expires_at)


def _open_invite(store: Store, token: str) -> Invite:
    found = store.first(Invite, ("token", "==", token))
    if found is None or aware(found.expires_at) <= utcnow():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invite has expired or was revoked. Ask whoever invited you to send a new one.")
    return found


@router.get("/invites/{token}")
def get_invite(token: str, store: StoreDep) -> dict[str, Any]:
    """What an invite link offers, before signing in."""
    found = _open_invite(store, token)
    t = store.get(Tenant, found.tenant_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This workspace no longer exists.")
    inviter = store.get(User, found.invited_by) or User(id=found.invited_by)
    return {"workspace": {"name": t.name, "slug": t.slug, "logo_url": t.logo_url}, "invited_by": people.person_out(inviter),
            "email": found.email, "role": found.role, "expires_at": found.expires_at}


@router.post("/invites/{token}/accept")
def accept_invite(token: str, who: SignedInDep, store: StoreDep) -> dict[str, Any]:
    """Joins the workspace as the signed-in person; their email must be verified and match the invite."""
    found = _open_invite(store, token)
    if who.user.email and (not who.user.email_verified or who.user.email.lower() != found.email):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"This invite is for {found.email}. Sign in with that address to accept it.")
    tenant = store.get(Tenant, found.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This workspace no longer exists.")
    member = store.get(Member, Member.make_id(tenant.id, who.user.id))
    if member is None:
        member = Member(tenant_id=tenant.id, user_id=who.user.id, role=found.role)
        store.put(member)
    notify.send(store, tenant.id, "invite_accepted", f"{who.user.name or found.email} joined as a {member.role}",
                [found.invited_by], actor_id=who.user.id, href="/settings/team")
    store.delete(Invite, found.id)
    return people.me_out(store, who.user, tenant, member.role, who.session_expires_at)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out() -> Response:
    """Clears the session cookie. Firebase ends the sign-in in the browser; this is for the cookie we can see."""
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("__session")
    return response
