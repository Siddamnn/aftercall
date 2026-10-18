"""Usage: the workspace's per day (tokens), per person (B54), allowances (B66), and the Settings
overview (B46). Billing is off: money fields are null, and nobody has an allowance."""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from aftercall import billing, usage, workspaces
from aftercall.config import get_settings
from aftercall.deps import MemberDep, StoreDep, Who, require
from aftercall.errors import invalid
from aftercall.models import Call, Dashboard, Member, Project, Run, Tenant, Thread, Tracker, Upload, User, utcnow
from aftercall.store import Store

router = APIRouter()
SelfUsage = Annotated[Who, require("usage.self")]
Admins = Annotated[Who, require("usage.members")]
OVERVIEW_DAYS = 30
RECENT = 6
DateQuery = Annotated[date | None, Query(description="Inclusive, UTC")]
DAY_FIELDS = ["calls_analyzed", "jev_requests", "billed_input_tokens", "output_tokens", "over_limit_calls", "over_limit_tokens"]


def _range_filters(start: date | None, end: date | None) -> list[tuple[str, str, datetime]]:
    first = [("created_at", ">=", datetime.combine(start, time.min, tzinfo=UTC))] if start else []
    last = [("created_at", "<", datetime.combine(end + timedelta(days=1), time.min, tzinfo=UTC))] if end else []
    return first + last


def _shape_day(values: dict[str, float]) -> dict[str, Any]:
    out: dict[str, Any] = {f: int(values.get(f, 0)) for f in DAY_FIELDS}
    out["cost"] = billing.token_cost(out["billed_input_tokens"])
    return out


@router.get("/usage")
def get_usage(who: SelfUsage, store: StoreDep, start: DateQuery = None, end: DateQuery = None) -> dict[str, Any]:
    def in_range(d: date) -> bool:
        return (start is None or d >= start) and (end is None or d <= end)

    tenant_id = who.workspace.id
    days: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    # Needs runs(tenant_id, created_at); the status is checked here.
    for r in store.find(Run, ("tenant_id", "==", tenant_id), *_range_filters(start, end)):
        if r.status == "done":
            day = days[r.created_at.date()]
            day["calls_analyzed"] += 1
            day["jev_requests"] += r.n_requests
            day["billed_input_tokens"] += r.tokens_input
            day["output_tokens"] += r.tokens_output
    # Over-limit calls weren't run, so they use nothing; counted for visibility only.
    for c in store.find(Call, ("tenant_id", "==", tenant_id), ("status", "==", "over_limit")):
        if in_range(c.received_at.date()):
            days[c.received_at.date()]["over_limit_calls"] += 1
            days[c.received_at.date()]["over_limit_tokens"] += c.transcript_tokens

    totals = {f: sum(v.get(f, 0) for v in days.values()) for f in DAY_FIELDS}
    return {
        "pricing": {"unit": "per 1M input tokens used", "price": billing.plans()["payg"].price_per_million},
        "token_budget": get_settings().token_budget,
        "days": [{"date": d.isoformat(), **_shape_day(v)} for d, v in sorted(days.items())],
        "totals": _shape_day(totals),
    }


# ── Per person ────────────────────────────────────────────────────────────────


def _bounds(start: date | None, end: date | None) -> tuple[datetime, datetime]:
    today = utcnow().date()
    first = datetime.combine(start or today.replace(day=1), time.min, tzinfo=UTC)
    last = datetime.combine((end or today) + timedelta(days=1), time.min, tzinfo=UTC)
    return first, last


def _spend(micros: int) -> float | None:
    """Money, or null: billing is off."""
    return billing.to_usd(micros) if billing.enabled() else None


def person_out(m: Member, user: User | None) -> dict[str, Any]:
    u = user or User(id=m.user_id)
    return {"id": u.id, "name": u.name, "avatar_url": u.avatar_url, "role": m.role, "email": u.email or ""}


def _users_of(store: Store, members: list[Member]) -> dict[str, User]:
    return {u.id: u for m in members if (u := store.get(User, m.user_id)) is not None}


def _usage_per_person(store: Store, tenant_id: str, first: datetime, last: datetime) -> dict[str | None, dict[str, int]]:
    per: dict[str | None, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in usage.events(store, tenant_id, first, last):
        per[e.user_id]["tokens"] += e.tokens
        per[e.user_id]["analysis"] += e.kind == "analysis"
        per[e.user_id]["questions"] += e.kind == "alteria_ask"
    return per


def _members_usage(store: Store, tenant: Tenant, start: date | None, end: date | None, only: str | None) -> dict[str, Any]:
    first, last = _bounds(start, end)
    per = _usage_per_person(store, tenant.id, first, last)
    members = [m for m in workspaces.members_of(store, tenant.id) if only in (None, m.user_id)]
    users = _users_of(store, members)
    month = usage.month_start()
    lines = [_member_line(store, tenant, m, users.get(m.user_id), per[m.user_id], month) for m in members]
    return {
        "start": first.date().isoformat(), "end": (last - timedelta(days=1)).date().isoformat(),
        "workspace": {"tokens": sum(p["tokens"] for p in per.values()), "spend": _spend(0),
                      "conversations": sum(p["analysis"] for p in per.values())},
        "members": sorted(lines, key=lambda x: -x["tokens"]),
    }


def _member_line(store: Store, tenant: Tenant, m: Member, user: User | None, used: dict[str, int], month: datetime) -> dict[str, Any]:
    allowed = usage.allowance_micros(store, tenant, m.user_id, m.role)
    return {
        "member": person_out(m, user), "tokens": used["tokens"], "spend": _spend(0),
        "conversations": used["analysis"], "alteria_questions": used["questions"],
        "allowance": {"monthly_usd": billing.to_usd(allowed) if allowed is not None else None,
                      "used_usd": billing.to_usd(usage.spent_micros(store, tenant.id, month, m.user_id)),
                      "resets_at": usage.next_month_start()},
    }


@router.get("/usage/me")
def my_usage(who: SelfUsage, store: StoreDep, start: DateQuery = None, end: DateQuery = None) -> dict[str, Any]:
    """The workspace's total, and your own line with your allowance."""
    return _members_usage(store, who.workspace, start, end, only=who.user.id)


@router.get("/usage/members")
def members_usage(who: Admins, store: StoreDep, start: DateQuery = None, end: DateQuery = None) -> dict[str, Any]:
    """Everyone's usage and allowance: owner and admins."""
    return _members_usage(store, who.workspace, start, end, only=None)


# ── Allowances (B66) ──────────────────────────────────────────────────────────


def _policy_out(store: Store, tenant: Tenant) -> dict[str, Any]:
    p = usage.policy(tenant)
    budget = usage.budget_micros(store, tenant, p)
    month = usage.month_start()
    members = workspaces.members_of(store, tenant.id)
    users = _users_of(store, members)
    people = []
    for m in members:
        share = p.share(m.user_id, m.role)
        people.append({
            "member": person_out(m, users.get(m.user_id)), "override": p.overrides.get(m.user_id),
            "effective_usd": _spend(round(share * budget)) if share is not None else None,
            "used_usd": billing.to_usd(usage.spent_micros(store, tenant.id, month, m.user_id)),
        })
    return {"budget": {"basis": p.basis, "monthly_usd": p.monthly_usd, "effective_usd": _spend(budget)},
            "roles": p.roles, "people": people, "resets_at": usage.next_month_start()}


@router.get("/usage/allowances")
def get_allowances(who: Admins, store: StoreDep) -> dict[str, Any]:
    return _policy_out(store, who.workspace)


Share = Annotated[float, Field(ge=0, le=1)]


class BudgetIn(BaseModel):
    basis: Literal["balance", "fixed"]
    monthly_usd: float | None = None


class AllowancesIn(BaseModel):
    budget: BudgetIn | None = None
    roles: dict[Literal["member", "viewer"], Share] | None = None
    # Per person: a share, or null to go back to their role's.
    overrides: dict[str, Share | None] | None = None


@router.put("/usage/allowances")
def save_allowances(body: AllowancesIn, who: Admins, store: StoreDep) -> dict[str, Any]:
    """Stored and shown, not enforced: billing is off."""
    tenant = who.workspace
    p = usage.policy(tenant)
    saved: dict[str, Any] = {"basis": p.basis, "monthly_usd": p.monthly_usd, "roles": p.roles, "overrides": p.overrides}
    if body.budget:
        if body.budget.basis == "fixed" and not (body.budget.monthly_usd or 0) > 0:
            raise invalid("A fixed budget needs an amount")
        saved["basis"] = body.budget.basis
        saved["monthly_usd"] = body.budget.monthly_usd if body.budget.basis == "fixed" else None
    saved["roles"] = {**saved["roles"], **(body.roles or {})}
    members = {m.user_id for m in workspaces.members_of(store, tenant.id)}
    for user_id, share in (body.overrides or {}).items():
        if user_id not in members:
            raise invalid(f"{user_id} isn't in the workspace")
        if share is None:
            saved["overrides"].pop(user_id, None)
        else:
            saved["overrides"][user_id] = share
    tenant.allowance_policy = saved
    store.update(Tenant, tenant.id, allowance_policy=saved)
    return _policy_out(store, tenant)


# ── Settings overview (B46) ───────────────────────────────────────────────────


def _recent(store: Store, tenant_id: str, user_id: str) -> list[dict[str, Any]]:
    """What happened lately. Chats are yours or shared: a teammate's private chat stays private."""
    newest = {"order_by": "updated_at", "descending": True, "limit": 3}
    uploads = store.find(Upload, ("tenant_id", "==", tenant_id), order_by="created_at", descending=True, limit=3)
    mine = store.find(Thread, ("tenant_id", "==", tenant_id), ("owner_id", "==", user_id), **newest)
    shared = store.find(Thread, ("tenant_id", "==", tenant_id), ("shared", "==", True), **newest)
    chats = sorted({t.id: t for t in mine + shared}.values(), key=lambda t: t.updated_at, reverse=True)[:3]
    boards = store.find(Dashboard, ("tenant_id", "==", tenant_id), order_by="updated_at", descending=True, limit=2)
    items = (
        [{"kind": "upload", "text": f"Analysed {u.filename}", "at": u.created_at, "href": f"/results/{u.id}"} for u in uploads]
        + [{"kind": "chat", "text": f"Asked alteria: {t.title}", "at": t.updated_at, "href": f"/ask/{t.id}"} for t in chats]
        + [{"kind": "dashboard", "text": f"Updated the dashboard {d.name}", "at": d.updated_at, "href": f"/dashboards/{d.id}"} for d in boards]
    )
    return sorted(items, key=lambda x: x["at"], reverse=True)[:RECENT]


@router.get("/account/overview")
def overview(who: MemberDep, store: StoreDep) -> dict[str, Any]:
    """What the workspace has built and used, across its projects."""
    tenant_id = who.workspace.id
    events = usage.events(store, tenant_id, utcnow() - timedelta(days=OVERVIEW_DAYS))

    def count(model, *where) -> int:
        return store.count(model, ("tenant_id", "==", tenant_id), *where)

    return {
        "counts": {
            "projects": count(Project),
            "trackers": count(Tracker),
            "dashboards": count(Dashboard),
            "conversations": count(Call, ("status", "==", "done"), ("deleted", "==", False)),
            "chats": count(Thread),
            "members": count(Member),
        },
        "month": {"tokens": sum(e.tokens for e in events), "spend": _spend(0),
                  "conversations": sum(e.kind == "analysis" for e in events)},
        "recent": _recent(store, tenant_id, who.user.id),
    }
