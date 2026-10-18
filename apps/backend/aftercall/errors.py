"""Errors written for customers, with a code the page can act on.

402 is for the plan, credits, allowances and limits; 403 for the role. The body is
{"detail": "a readable sentence", "code": "...", "feature"?: "..."}.
"""

from typing import Literal

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

Code = Literal["plan_required", "role_required", "allowance_reached", "limit_reached", "onboarding_required"]


class Problem(HTTPException):
    def __init__(self, status_code: int, detail: str, code: Code, feature: str | None = None):
        super().__init__(status_code, detail)
        self.code = code
        self.feature = feature


def plan_required(detail: str, feature: str) -> Problem:
    return Problem(status.HTTP_402_PAYMENT_REQUIRED, detail, "plan_required", feature)


def limit_reached(detail: str) -> Problem:
    return Problem(status.HTTP_402_PAYMENT_REQUIRED, detail, "limit_reached")


def role_required(detail: str) -> Problem:
    return Problem(status.HTTP_403_FORBIDDEN, detail, "role_required")


def not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def invalid(*errors: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"errors": list(errors)})


async def problem_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, Problem)
    body = {"detail": exc.detail, "code": exc.code}
    if exc.feature:
        body["feature"] = exc.feature
    return JSONResponse(body, status_code=exc.status_code)
