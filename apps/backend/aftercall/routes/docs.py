"""Docs feedback (B65): "Was this helpful?" from the public help centre."""

import hashlib
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from aftercall.deps import StoreDep
from aftercall.models import DocFeedback, utcnow

router = APIRouter()
PER_HOUR = 20


class FeedbackIn(BaseModel):
    slug: str = Field(min_length=1, max_length=200)
    helpful: bool
    comment: str | None = Field(default=None, max_length=1000)


def _sender(request: Request) -> str:
    address = request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "")
    return hashlib.sha256(address.encode()).hexdigest()


@router.post("/docs/feedback", status_code=status.HTTP_204_NO_CONTENT)
def docs_feedback(body: FeedbackIn, request: Request, store: StoreDep) -> Response:
    """Public, no sign-in. At most PER_HOUR from one address an hour."""
    sender = _sender(request)
    recent = store.count(DocFeedback, ("sender", "==", sender), ("created_at", ">=", utcnow() - timedelta(hours=1)))
    if recent >= PER_HOUR:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Thanks! That's plenty of feedback for now.", headers={"Retry-After": "3600"})
    store.put(DocFeedback(slug=body.slug, helpful=body.helpful, comment=(body.comment or "").strip() or None, sender=sender))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
