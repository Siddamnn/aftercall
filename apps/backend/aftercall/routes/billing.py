"""Billing is off: the plan and the pricing page read as "free, no credits". Nothing can be bought,
so there are no checkout, top-up, subscription, ledger or invoice endpoints (they answer 404)."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from aftercall import billing, pricing, usage
from aftercall.deps import MemberDep, StoreDep

router = APIRouter()


class BillingOut(BaseModel):
    enabled: bool
    plan: str
    balance: float
    period_start: datetime | None
    period_end: datetime | None
    auto_renew: bool
    included_tokens: int
    included_tokens_used: int
    alteria: bool
    plans: list[dict[str, Any]]
    features: dict[str, bool]
    limits: dict[str, int | None]
    currency: dict[str, Any]
    auto_top_up: dict[str, Any] | None = None
    promotion: dict[str, Any] | None = None
    subscription: dict[str, Any] | None = None


@router.get("/billing")
def get_billing(request: Request, who: MemberDep, store: StoreDep) -> BillingOut:
    """The plan with billing off: pay as you go at no charge, every feature open, no limits."""
    tenant = who.workspace
    acc = billing.account(store, tenant.id)
    return BillingOut(
        enabled=billing.enabled(), plan=acc.plan, balance=0.0, period_start=None, period_end=None, auto_renew=False,
        included_tokens=0, included_tokens_used=0, alteria=billing.plans()[acc.plan].alteria, plans=[],
        features=billing.features(acc), limits=billing.limits(acc, usage.count(store, tenant.id, "alteria_ask")),
        currency=pricing.display_currency(request, tenant, store),
    )


@router.get("/pricing")
def public_pricing(request: Request, store: StoreDep) -> dict[str, Any]:
    """For the pricing page, signed in or not: no plans are for sale."""
    return {"enabled": billing.enabled(), "plans": [], "currency": pricing.display_currency(request, None, store),
            "promotion": None, "min_top_up_usd": 0.0}
