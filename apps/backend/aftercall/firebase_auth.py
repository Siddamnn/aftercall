"""Firebase Authentication: verifies the ID token the web sends as `Authorization: Bearer`.

People sign in with Google in the browser; the backend only checks tokens, from our own project, and
turns their claims into user fields. Nothing here runs without a project id (FIREBASE_PROJECT_ID, else GCP_PROJECT).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import firebase_admin
from firebase_admin import auth, exceptions

from aftercall.config import get_settings

GOOGLE_PROVIDER = "google.com"


class FirebaseAuthError(Exception):
    pass


@dataclass(frozen=True)
class FirebaseSession:
    """Who a verified token is, and when they last signed in (not when the token was minted)."""

    uid: str
    email: str | None
    email_verified: bool
    name: str
    picture: str | None
    google: bool
    auth_time: datetime


def project_id() -> str:
    s = get_settings()
    return s.firebase_project_id or s.gcp_project


def enabled() -> bool:
    return bool(project_id())


@lru_cache
def _app(project: str) -> firebase_admin.App:
    return firebase_admin.initialize_app(options={"projectId": project}, name=f"aftercall-{project}")


def verify(token: str) -> FirebaseSession:
    """The session in a Firebase ID token, or FirebaseAuthError when it isn't valid, expired or revoked."""
    if not enabled():
        raise FirebaseAuthError("Firebase sign-in isn't configured")
    try:
        claims = auth.verify_id_token(token, app=_app(project_id()))
    except (ValueError, exceptions.FirebaseError) as exc:
        raise FirebaseAuthError(str(exc)) from None
    return session_from_claims(claims)


def session_from_claims(claims: dict[str, Any]) -> FirebaseSession:
    provider = (claims.get("firebase") or {}).get("sign_in_provider")
    return FirebaseSession(
        uid=claims["uid"], email=(claims.get("email") or "").lower() or None,
        email_verified=bool(claims.get("email_verified")), name=claims.get("name") or "",
        picture=claims.get("picture"), google=provider == GOOGLE_PROVIDER,
        auth_time=datetime.fromtimestamp(claims.get("auth_time") or claims["iat"], UTC),
    )
