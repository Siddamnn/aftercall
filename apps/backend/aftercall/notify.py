"""In-app notifications (B52): one record per recipient, only for people whose role should see it."""

from collections.abc import Iterable

from aftercall import permissions, workspaces
from aftercall.models import Notification
from aftercall.store import Store

# Money notices would go only to people who can see the workspace's credits.
MONEY_KINDS = frozenset({"low_balance", "credits_added", "plan_renewing", "plan_renewed", "plan_payment_failed", "plan_ended"})


def members_who_can(store: Store, tenant_id: str, permission: str) -> list[str]:
    return [m.user_id for m in workspaces.members_of(store, tenant_id) if permissions.can(m.role, permission)]


def send(
    store: Store, tenant_id: str, kind: str, title: str, to: Iterable[str], *,
    body: str | None = None, href: str | None = None, actor_id: str | None = None, project_id: str | None = None,
) -> None:
    store.put_many(
        Notification(tenant_id=tenant_id, user_id=user_id, kind=kind, title=title, body=body,
                     href=href, actor_id=actor_id, project_id=project_id)
        for user_id in dict.fromkeys(to) if user_id != actor_id
    )


def to_billing(store: Store, tenant_id: str, kind: str, title: str, **extra: str | None) -> None:
    """Money notices go nowhere while billing is off."""
    assert kind in MONEY_KINDS
