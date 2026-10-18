"""People in a workspace as the API shows them, and the rules for inviting them (B42)."""

import re
import secrets
from datetime import timedelta
from typing import Any

from aftercall import billing, permissions, workspaces
from aftercall.config import get_settings
from aftercall.errors import invalid, limit_reached
from aftercall.models import Invite, Member, Tenant, User, aware, utcnow
from aftercall.store import Store

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
INVITE_DAYS = 7
DEFAULT_NOTIFICATIONS = {"low_balance": True, "weekly_digest": True, "shared_chats": True, "run_finished": False}


def person_out(user: User) -> dict[str, Any]:
    return {"id": user.id, "name": user.name, "avatar_url": user.avatar_url}


def member_out(m: Member, user: User) -> dict[str, Any]:
    return person_out(user) | {"email": user.email or "", "role": m.role, "joined_at": m.joined_at,
                               "last_active_at": m.last_active_at}


def invite_out(i: Invite, inviter: User) -> dict[str, Any]:
    return {"id": i.id, "email": i.email, "role": i.role, "invited_by": person_out(inviter),
            "created_at": i.created_at, "expires_at": i.expires_at}


def users_by_id(store: Store, ids: list[str]) -> dict[str, User]:
    """Users by id (one get each; a team is small)."""
    found = (store.get(User, i) for i in dict.fromkeys(ids))
    return {u.id: u for u in found if u is not None}


def me_out(store: Store, user: User, tenant: Tenant | None, role: str | None, session_expires_at) -> dict[str, Any]:
    member = store.get(Member, Member.make_id(tenant.id, user.id)) if tenant else None
    base = member_out(member, user) if member else person_out(user) | {
        "email": user.email or "", "role": "owner", "joined_at": user.created_at, "last_active_at": None}
    return base | {
        "permissions": list(permissions.ROLE_PERMISSIONS.get(role or "", ())),
        "session_expires_at": session_expires_at, "onboarded": tenant is not None,
        "sign_in": {"email": bool(user.email), "google": user.google},
        "notifications": DEFAULT_NOTIFICATIONS | (user.notifications or {}),
    }


def clean_email(email: str) -> str:
    e = email.strip().lower()
    if not EMAIL.match(e):
        raise invalid("Enter an email address, like name@company.com")
    return e


def open_invites(store: Store, tenant_id: str) -> list[Invite]:
    """Invites that haven't expired, newest first."""
    rows = sorted(store.find(Invite, ("tenant_id", "==", tenant_id)), key=lambda i: i.created_at, reverse=True)
    return [i for i in rows if aware(i.expires_at) > utcnow()]


def seats(store: Store, tenant_id: str) -> int:
    """People who can ask and analyse: everyone but viewers, and open invites for them."""
    members = workspaces.members_of(store, tenant_id)
    return sum(m.role != "viewer" for m in members) + sum(i.role != "viewer" for i in open_invites(store, tenant_id))


def teammate_limit(store: Store, tenant_id: str) -> int | None:
    return billing.limits(billing.account(store, tenant_id), 0)["teammates"]


def check_seat(store: Store, tenant_id: str, role: str, why: str) -> None:
    limit = teammate_limit(store, tenant_id)
    if limit is None or role == "viewer":
        return
    if (used := seats(store, tenant_id)) >= limit:
        raise limit_reached(f"This workspace includes {limit} people who can ask and analyse, and you have {used}. {why}")


def invite_link(invite: Invite) -> str:
    return f"https://{get_settings().app_host}/invite/{invite.token}"


def create_invite(store: Store, tenant: Tenant, email: str, role: str, by: User) -> Invite:
    """Saves the invite. Nothing is emailed: the inviter shares `invite_link`."""
    invite = Invite(tenant_id=tenant.id, email=email, role=role, invited_by=by.id,
                    token=secrets.token_urlsafe(24), expires_at=utcnow() + timedelta(days=INVITE_DAYS))
    store.put(invite)
    return invite


def renew_invite(store: Store, invite: Invite) -> Invite:
    """A new link and a new 7 days; the old link stops working."""
    invite.token, invite.expires_at, invite.created_at = secrets.token_urlsafe(24), utcnow() + timedelta(days=INVITE_DAYS), utcnow()
    store.put(invite)
    return invite


def revoke_invite(store: Store, invite: Invite) -> None:
    store.delete(Invite, invite.id)
