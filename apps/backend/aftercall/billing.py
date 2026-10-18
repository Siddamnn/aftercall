"""Billing is off in this build: nothing is held, charged or refused; estimates show tokens only.

The functions the rest of aftercall calls are kept, with "billing off" answers, so uploads, the worker
and the routes read the same whether or not billing ever comes back. Every feature is open and there
are no limits. Tokens are still recorded as usage events (usage.py).
"""

from dataclasses import dataclass, field

from aftercall.store import Store

MICROS = 1_000_000


class BillingError(Exception):
    pass


class NotEnoughCredits(BillingError):
    """HTTP 402. Never raised while billing is off; uploads still catch it."""


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    monthly_usd: float | None  # None: not for sale
    included_tokens: int
    price_per_million: float | None
    alteria: bool


@dataclass(frozen=True)
class Account:
    """What a workspace's plan looks like with billing off: free, no credits, nothing to renew."""

    tenant_id: str
    plan: str = "payg"
    balance_micros: int = 0


@dataclass(frozen=True)
class Quote:
    tokens: int
    included_tokens: int = 0
    micros: int = 0
    balance_micros: int = 0
    per_call: list[tuple[int, int]] = field(default_factory=list)  # per call: (included tokens, micros)

    @property
    def shortfall_micros(self) -> int:
        return 0


def enabled() -> bool:
    return False


def plans() -> dict[str, Plan]:
    return {
        "payg": Plan("payg", "Pay as you go", 0.0, 0, None, alteria=True),
        "pro": Plan("pro", "Pro", None, 0, None, alteria=True),
    }


def pro_ready() -> bool:
    return False


def token_cost(tokens: int) -> float | None:
    """Tokens have no price here."""
    return None


def account(store: Store, tenant_id: str, lock: bool = False) -> Account:
    return Account(tenant_id)


def features(acc: Account) -> dict[str, bool]:
    return {"share_chats": True, "bulk_export": True, "import_documents": True, "audit_log": True}


def limits(acc: Account, ask_trial_used: int) -> dict[str, int | None]:
    return {"teammates": None, "projects": None, "alteria_trial_left": None}


def to_micros(usd: float) -> int:
    return round(usd * MICROS)


def to_usd(micros: int) -> float:
    return round(micros / MICROS, 6)


def money(micros: int) -> str:
    """$1.25, or $0.0042 for amounts under a dollar."""
    usd = micros / MICROS
    return f"${usd:,.2f}" if abs(usd) >= 1 or usd == 0 else f"${usd:.4f}".rstrip("0")


def quote(acc: Account, call_tokens: list[int]) -> Quote:
    """What running calls with these estimated tokens would take: tokens, no money."""
    return Quote(tokens=sum(call_tokens), per_call=[(0, 0)] * len(call_tokens))


def shortfall_message(q: Quote) -> str:
    return ""


def hold(store: Store, acc: Account, upload_id: str, calls: list, q: Quote) -> None:
    """Nothing is set aside."""


def settle(store: Store, call, tokens_used: int) -> None:
    """Nothing is charged."""
