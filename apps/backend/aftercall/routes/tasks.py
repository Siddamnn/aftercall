"""Cloud Tasks callbacks. The service is public, so every request proves it comes from our queue's service account."""

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from google.auth import exceptions as auth_exceptions
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

from aftercall import worker
from aftercall.config import get_settings
from aftercall.deps import StoreDep

router = APIRouter(include_in_schema=False)


class RunCall(BaseModel):
    call_id: str


def _verify_invoker(authorization: str) -> None:
    """401 unless the bearer token is a Google-signed ID token for our URL, from the task invoker account."""
    s = get_settings()
    token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not a Cloud Tasks request")
    if not token or not s.task_invoker_email:
        raise unauthorized
    try:
        claims = id_token.verify_oauth2_token(token, google_requests.Request(), audience=s.task_service_url)
    except auth_exceptions.TransportError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Couldn't fetch Google's signing keys") from None
    except ValueError:
        raise unauthorized from None
    if claims.get("email") != s.task_invoker_email or not claims.get("email_verified"):
        raise unauthorized


@router.post("/tasks/run-call")
def run_call(body: RunCall, store: StoreDep, authorization: Annotated[str, Header()] = "") -> dict[str, bool]:
    """2xx when the call ran or another delivery already has it (no retry); an error response makes Cloud Tasks retry."""
    if not get_settings().cloud_tasks_queue:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _verify_invoker(authorization)
    return {"ran": worker.run_call(store, worker.default_engine(), body.call_id)}
