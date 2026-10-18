"""You, your team, invites and roles (B42, B53). Invites are links to share: nothing is emailed."""

from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from aftercall import notify, people, workspaces
from aftercall.deps import MemberDep, SignedInDep, StoreDep, Who, require
from aftercall.errors import not_found
from aftercall.models import Invite, Member, User
from aftercall.store import Store

router = APIRouter()
TeamManager = Annotated[Who, require("team.manage")]
InvitedRole = Literal["admin", "member", "viewer"]


@router.get("/me")
def get_me(who: SignedInDep, store: StoreDep) -> dict[str, Any]:
    return people.me_out(store, who.user, who.tenant, who.role, who.session_expires_at)


class MePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    notifications: dict[Literal["low_balance", "weekly_digest", "shared_chats", "run_finished"], bool] | None = None


@router.patch("/me")
def update_me(body: MePatch, who: SignedInDep, store: StoreDep) -> dict[str, Any]:
    changes: dict[str, Any] = {}
    if body.name is not None:
        changes["name"] = body.name.strip()
    if body.notifications:
        changes["notifications"] = (who.user.notifications or {}) | body.notifications
    if changes:
        store.update(User, who.user.id, **changes)
        who.user = who.user.model_copy(update=changes)
    return people.me_out(store, who.user, who.tenant, who.role, who.session_expires_at)


def _invite_out(store: Store, invites: list[Invite]) -> list[dict[str, Any]]:
    """Invites as the API shows them, with the link to share."""
    inviters = people.users_by_id(store, [i.invited_by for i in invites])
    return [people.invite_out(i, inviters.get(i.invited_by) or User(id=i.invited_by)) | {"link": people.invite_link(i)}
            for i in invites]


def _member_out(store: Store, members: list[Member]) -> list[dict[str, Any]]:
    users = people.users_by_id(store, [m.user_id for m in members])
    return [people.member_out(m, users.get(m.user_id) or User(id=m.user_id)) for m in members]


@router.get("/team")
def get_team(who: MemberDep, store: StoreDep) -> dict[str, Any]:
    tid = who.workspace.id
    return {"members": _member_out(store, workspaces.members_of(store, tid)),
            "invites": _invite_out(store, people.open_invites(store, tid)),
            "limit": people.teammate_limit(store, tid)}


class InviteIn(BaseModel):
    email: str
    role: InvitedRole


@router.post("/team/invites", status_code=status.HTTP_201_CREATED)
def invite(body: InviteIn, who: TeamManager, store: StoreDep) -> dict[str, Any]:
    email = people.clean_email(body.email)
    tid = who.workspace.id
    users = people.users_by_id(store, [m.user_id for m in workspaces.members_of(store, tid)])
    if any(u.email == email for u in users.values()):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{email} is already in the workspace.")
    if any(i.email == email for i in people.open_invites(store, tid)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{email} already has an invite. Resend it from the list.")
    people.check_seat(store, tid, body.role, "Invite them as a viewer: viewers are free.")
    return _invite_out(store, [people.create_invite(store, who.workspace, email, body.role, who.user)])[0]


def _invite(store: Store, who: Who, invite_id: str) -> Invite:
    found = store.get(Invite, invite_id)
    if found is None or found.tenant_id != who.workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That invite was accepted or revoked.")
    return found


@router.post("/team/invites/{invite_id}/resend")
def resend_invite(invite_id: str, who: TeamManager, store: StoreDep) -> dict[str, Any]:
    """A new link and a new 7 days; the old link stops working."""
    return _invite_out(store, [people.renew_invite(store, _invite(store, who, invite_id))])[0]


@router.delete("/team/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(invite_id: str, who: TeamManager, store: StoreDep) -> Response:
    people.revoke_invite(store, _invite(store, who, invite_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _member(store: Store, who: Who, user_id: str) -> Member:
    m = store.get(Member, Member.make_id(who.workspace.id, user_id))
    if m is None:
        raise not_found("Member")
    return m


class RoleIn(BaseModel):
    role: InvitedRole


@router.patch("/team/members/{user_id}")
def set_role(user_id: str, body: RoleIn, who: TeamManager, store: StoreDep) -> dict[str, Any]:
    m = _member(store, who, user_id)
    if m.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner's role can't change. Transfer the workspace first.")
    user = store.get(User, m.user_id) or User(id=m.user_id)
    if m.role == "viewer" and body.role != "viewer":
        first = (user.name or "them").split(" ")[0]
        people.check_seat(store, who.workspace.id, body.role, f"There's no room to make {first} a {body.role}.")
    m.role = body.role
    store.update(Member, m.id, role=m.role)
    notify.send(store, who.workspace.id, "role_changed", f"You're now a {body.role} in {who.workspace.name}",
                [m.user_id], actor_id=who.user.id, href="/settings/profile")
    return people.member_out(m, user)


@router.delete("/team/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(user_id: str, who: TeamManager, store: StoreDep) -> Response:
    m = _member(store, who, user_id)
    if m.role == "owner":
        raise HTTPException(status.HTTP_409_CONFLICT, "The owner can't be removed.")
    if m.user_id == who.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You can't remove yourself. Ask another admin.")
    store.delete(Member, m.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
