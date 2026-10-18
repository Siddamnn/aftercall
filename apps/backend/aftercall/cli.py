"""Admin commands (they use the configured store, so set STORE_BACKEND=firestore for real data):
    python -m aftercall.cli create-tenant "Acme Collections" [--owner-email a@acme.com --owner-name "Asha"]
    python -m aftercall.cli rotate-key w-1a2b3c4d5e6f
    python -m aftercall.cli alteria-costs --days 30
    python -m aftercall.cli backfill-latest      # once, for calls analysed before they carried their latest answers
"""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta

from aftercall import latest, workspaces
from aftercall.models import AlteriaRequest, AuditEntry, Tenant, User, utcnow
from aftercall.store import Store, get_store


@dataclass(frozen=True)
class NewTenant:
    id: str
    slug: str
    api_key: str  # shown once; only its hash is stored


def create_tenant(name: str, owner_email: str | None = None, owner_name: str | None = None, store: Store | None = None) -> NewTenant:
    store = store or get_store()
    owner = User(name=owner_name or "Owner", email=owner_email, email_verified=owner_email is not None)
    store.put(owner)
    tenant, api_key = workspaces.create(store, name, owner)
    return NewTenant(tenant.id, tenant.slug, api_key)


def rotate_key(tenant_id: str, store: Store | None = None) -> str:
    store = store or get_store()
    tenant = store.get(Tenant, tenant_id)
    if tenant is None:
        raise SystemExit(f"no tenant {tenant_id}")
    api_key = workspaces.rotate_key(store, tenant)
    store.put(AuditEntry(tenant_id=tenant_id, actor="cli", action="api_key.rotate"))
    return api_key


def alteria_costs(days: int, store: Store | None = None) -> None:
    store = store or get_store()
    since = utcnow() - timedelta(days=days)
    rows: dict[tuple, list[AlteriaRequest]] = defaultdict(list)
    for r in store.find(AlteriaRequest, ("created_at", ">=", since)):
        rows[(r.task, r.routed_tier, r.tier or "-", r.model or "-")].append(r)
    print(f"{'task':14} {'routed':9} {'answered':9} {'model':34} {'requests':>8} {'ok':>5} {'retries':>7} {'cost':>9}")
    total = 0.0
    for (task, routed, tier, model), group in sorted(rows.items()):
        cost = sum(r.cost_usd for r in group)
        total += cost
        print(f"{task:14} {routed:9} {tier:9} {model:34} {len(group):8} {sum(r.ok for r in group):5} "
              f"{sum(r.attempts for r in group) - len(group):7} {f'${cost:.4f}':>9}")
    print(f"total over {days} days: ${total:.4f} (plus Jev routing, about $0.00003 a request)")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aftercall")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-tenant", help="create a workspace and print its API key (shown once)")
    p.add_argument("name")
    p.add_argument("--owner-email")
    p.add_argument("--owner-name")
    p = sub.add_parser("rotate-key", help="replace a workspace's API key; the old one stops working")
    p.add_argument("tenant_id")
    p = sub.add_parser("alteria-costs", help="what alteria cost us, by task, tier and model")
    p.add_argument("--days", type=int, default=30)
    sub.add_parser("backfill-latest", help="copy each call's latest answers onto the call (for calls analysed before that)")
    return parser


def main() -> None:
    args = _parser().parse_args()
    match args.command:
        case "create-tenant":
            tenant = create_tenant(args.name, args.owner_email, args.owner_name)
            print(f"tenant_id={tenant.id}\nslug={tenant.slug}\napi_key={tenant.api_key}")
        case "rotate-key":
            print(f"api_key={rotate_key(args.tenant_id)}")
        case "alteria-costs":
            alteria_costs(args.days)
        case "backfill-latest":
            print(f"updated {latest.backfill(get_store())} calls")


if __name__ == "__main__":
    main()
