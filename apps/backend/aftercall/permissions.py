"""What each role may do (B54). The one source: routes declare what they need with require()."""

ROLES = ("owner", "admin", "member", "viewer")

ALL = (
    "analyse", "trackers.edit", "dashboards.edit", "ask", "projects.manage", "billing.view", "billing.manage",
    "usage.self", "usage.members", "team.manage", "workspace.edit",
)

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "owner": ALL,
    "admin": ALL,
    "member": ("analyse", "trackers.edit", "dashboards.edit", "ask", "billing.view", "usage.self"),
    # Viewers read everything shared with them and ask alteria within their allowance (B66).
    "viewer": ("ask",),
}

REFUSALS: dict[str, str] = {
    "analyse": "Viewers can't analyse conversations. Ask an admin to make you a member.",
    "trackers.edit": "Viewers can't change trackers. Ask an admin to make you a member.",
    "dashboards.edit": "Viewers can't change dashboards. Ask an admin to make you a member.",
    "ask": "Your role can't ask alteria.",
    "projects.manage": "Only the owner and admins can manage projects.",
    "billing.view": "Viewers can't see the workspace's credits.",
    "billing.manage": "Only the owner and admins can pay for the workspace.",
    "usage.self": "Viewers don't see usage.",
    "usage.members": "Only the owner and admins can see everyone's usage and set allowances.",
    "team.manage": "Only the owner and admins can manage the team.",
    "workspace.edit": "Only the owner and admins can change the workspace.",
}


def can(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, ())


def is_admin(role: str) -> bool:
    return role in ("owner", "admin")
