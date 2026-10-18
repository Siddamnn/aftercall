"""Workspaces (B50): the tenant, its address, who may join by email domain, and its API key."""

import hashlib
import re
import secrets

from aftercall.models import Member, Project, Tenant, User, slugify
from aftercall.store import Store

SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
SLUG_RULE = "Use 3 to 40 lowercase letters, numbers and single dashes, starting and ending with a letter or number."
RESERVED_SLUGS = frozenset({
    "admin", "api", "app", "aftercall", "alteria", "login", "signup", "settings", "pricing", "help",
    "invite", "invites", "onboarding", "www", "docs", "status", "internal",
})
# Anyone can get an address at these, so they never let people join a workspace.
PUBLIC_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
    "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "zoho.com", "yandex.com",
})
DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


def hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


def new_api_key() -> str:
    return f"ac_{secrets.token_urlsafe(32)}"


def slug_problem(slug: str) -> str | None:
    return None if SLUG.match(slug) and "--" not in slug else SLUG_RULE


def slug_free(store: Store, slug: str, tenant_id: str | None = None) -> bool:
    if slug in RESERVED_SLUGS:
        return False
    owner = store.first(Tenant, ("slug", "==", slug))
    return owner is None or owner.id == tenant_id


def free_slug(store: Store, base: str) -> str:
    if slug_problem(base):
        base = "workspace"
    slug, n = base, 2
    while not slug_free(store, slug):
        slug, n = f"{base[:36]}-{n}", n + 1
    return slug


def email_domain(email: str | None) -> str | None:
    return email.rsplit("@", 1)[1].lower() if email and "@" in email else None


def create(store: Store, name: str, owner: User | None, slug: str | None = None, api_key: str | None = None) -> tuple[Tenant, str]:
    """A workspace with its owner and default project. Returns it and its API key (shown once)."""
    api_key = api_key or new_api_key()
    slug = free_slug(store, slug or slugify(name, "workspace"))
    tenant = Tenant(name=name, api_key_hash=hash_key(api_key), slug=slug)
    store.put(tenant)
    if owner is not None:
        store.put(Member(tenant_id=tenant.id, user_id=owner.id, role="owner"))
    default_project(store, tenant)
    return tenant, api_key


def default_project(store: Store, tenant: Tenant) -> Project:
    """The workspace's default project, made on first use."""
    found = store.find(Project, ("tenant_id", "==", tenant.id), ("is_default", "==", True))
    project = next((p for p in found if p.deleted_at is None), None)
    if project is None:
        project = Project(tenant_id=tenant.id, name=tenant.name[:60] or "Default", is_default=True)
        store.put(project)
    return project


def by_api_key(store: Store, api_key: str) -> Tenant | None:
    return store.first(Tenant, ("api_key_hash", "==", hash_key(api_key)))


def members_of(store: Store, tenant_id: str) -> list[Member]:
    """Everyone in the workspace, earliest joined first."""
    return sorted(store.find(Member, ("tenant_id", "==", tenant_id)), key=lambda m: m.joined_at)


def memberships_of(store: Store, user_id: str) -> list[Member]:
    """The workspaces a person is in."""
    return store.find(Member, ("user_id", "==", user_id))


def owner_of(store: Store, tenant: Tenant) -> User:
    """The workspace's owner. An API key acts as them; a workspace made without people gets one."""
    owner = next((m for m in members_of(store, tenant.id) if m.role == "owner"), None)
    if owner is not None and (user := store.get(User, owner.user_id)) is not None:
        return user
    user = User(name="Owner")
    store.put_many([user, Member(tenant_id=tenant.id, user_id=user.id, role="owner")])
    return user


def rotate_key(store: Store, tenant: Tenant) -> str:
    api_key = new_api_key()
    tenant.api_key_hash = hash_key(api_key)
    store.update(Tenant, tenant.id, api_key_hash=tenant.api_key_hash)
    return api_key


def seed_demo(store: Store, api_key: str) -> Tenant:
    """The demo workspace whose API key is `api_key` (DEV_API_KEY): made once, then found again."""
    found = by_api_key(store, api_key)
    if found is not None:
        return found
    owner = User(name="Demo owner")
    store.put(owner)
    return create(store, "Demo workspace", owner, slug="demo", api_key=api_key)[0]
