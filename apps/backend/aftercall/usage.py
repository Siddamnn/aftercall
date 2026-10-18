"""Who used what: every analysed call and every question to alteria is a usage event with who did it.

Billing is off, so events carry tokens only, and nobody has an allowance: the money and allowance
functions are kept (with "no limit" answers) so callers read the same either way. Months start on the 1st, UTC.
"""

from dataclasses import dataclass
from datetime import datetime

from aftercall import permissions
from aftercall.models import Tenant, UsageEvent, utcnow
from aftercall.store import Store

DEFAULT_SHARES = {"member": 0.5, "viewer": 0.25}


@dataclass(frozen=True)
class Policy:
    basis: str  # balance | fixed
    monthly_usd: float | None
    roles: dict[str, float]
    overrides: dict[str, float]

    def share(self, user_id: str, role: str) -> float | None:
        if permissions.is_admin(role):
            return None
        return self.overrides.get(user_id, self.roles["viewer" if role == "viewer" else "member"])


def policy(tenant: Tenant) -> Policy:
    saved = tenant.allowance_policy or {}
    return Policy(
        basis=saved.get("basis", "balance"), monthly_usd=saved.get("monthly_usd"),
        roles={**DEFAULT_SHARES, **saved.get("roles", {})}, overrides=dict(saved.get("overrides", {})),
    )


def month_start(now: datetime | None = None) -> datetime:
    now = now or utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month_start() -> datetime:
    start = month_start()
    return start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)


def record(store: Store, tenant_id: str, kind: str, *, user_id: str | None, project_id: str | None,
           tokens: int = 0, ref: str | None = None) -> None:
    store.put(UsageEvent(tenant_id=tenant_id, project_id=project_id, user_id=user_id, kind=kind, tokens=tokens, ref=ref))


def count(store: Store, tenant_id: str, kind: str) -> int:
    """How many of this kind the workspace has ever done: deleting chats doesn't give free questions back."""
    return store.count(UsageEvent, ("tenant_id", "==", tenant_id), ("kind", "==", kind))


def events(store: Store, tenant_id: str, since: datetime, until: datetime | None = None,
           user_id: str | None = None) -> list[UsageEvent]:
    """The workspace's events from `since` (inclusive) to `until` (exclusive), newest first; one person's with `user_id`.
    Needs the (tenant_id, created_at) index; the person is filtered here so no second index is needed."""
    where = [("tenant_id", "==", tenant_id), ("created_at", ">=", since)]
    if until is not None:
        where.append(("created_at", "<", until))
    found = store.find(UsageEvent, *where, order_by="created_at", descending=True)
    return [e for e in found if user_id is None or e.user_id == user_id]


def spent_micros(store: Store, tenant_id: str, since: datetime, user_id: str | None = None) -> int:
    return 0


def budget_micros(store: Store, tenant: Tenant, p: Policy) -> int:
    return 0


def allowance_micros(store: Store, tenant: Tenant, user_id: str, role: str) -> int | None:
    """No allowance for anyone while billing is off."""
    return None


def check(store: Store, tenant: Tenant, user_id: str, role: str, extra_micros: int) -> None:
    """Never refuses while billing is off."""


def notice_thresholds(store: Store, tenant: Tenant, user_id: str) -> None:
    """No allowance notices while billing is off."""
