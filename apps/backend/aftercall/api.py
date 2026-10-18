"""The HTTP API: the app and its routers (one per area, in aftercall/routes/).

Calls are analysed by Cloud Tasks hitting `POST /tasks/run-call` (or in-process without a queue),
not by a thread here.
"""

import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from aftercall import workspaces
from aftercall.config import get_settings
from aftercall.errors import Problem, problem_handler
from aftercall.routes import (
    alteria,
    billing,
    dashboards,
    docs,
    insights,
    notifications,
    people,
    projects,
    tasks,
    trackers,
    uploads,
    usage,
    workspace,
)
from aftercall.store import get_store

log = logging.getLogger("aftercall.api")
API_PREFIX = "/api"


class StripApiPrefix:
    """Firebase Hosting forwards `/api/...` whole; the routes have no prefix, so drop it. Unprefixed paths pass through."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            path = scope["path"]
            if path == API_PREFIX or path.startswith(API_PREFIX + "/"):
                scope = {**scope, "path": path[len(API_PREFIX):] or "/"}
                raw = scope.get("raw_path")
                if raw and raw.startswith(API_PREFIX.encode()):
                    scope["raw_path"] = raw[len(API_PREFIX):] or b"/"
        await self.app(scope, receive, send)


def allowed_origins() -> list[str]:
    return [o.rstrip("/") for o in re.split(r"[,\s]+", get_settings().cors_origins) if o]


class OriginGuard:
    """Refuses browser requests from pages on other sites. CORS alone only stops a page reading the
    answer; a simple POST would still run. Requests without an Origin header (scripts with an API key,
    Cloud Tasks) pass, and still need their credentials."""

    def __init__(self, app: ASGIApp, origins: list[str]) -> None:
        self.app = app
        self.origins = set(origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            origin = dict(scope["headers"]).get(b"origin", b"").decode("latin-1").rstrip("/")
            if origin and origin not in self.origins:
                await JSONResponse({"detail": "This API only accepts requests from aftercall's own site"}, 403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.store_backend == "memory" and settings.dev_api_key:
        workspaces.seed_demo(get_store(), settings.dev_api_key)
        log.info("demo workspace ready (memory store)")
    yield


show_docs = get_settings().api_docs
app = FastAPI(title="aftercall", version="0.2.0", lifespan=lifespan,
              docs_url="/docs" if show_docs else None, redoc_url="/redoc" if show_docs else None,
              openapi_url="/openapi.json" if show_docs else None)
app.add_exception_handler(Problem, problem_handler)

# Outermost first: the guard runs before CORS, so another site never gets a CORS answer either.
if origins := allowed_origins():
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type", "X-API-Key", "X-Project"],
    )
    app.add_middleware(OriginGuard, origins=origins)
app.add_middleware(StripApiPrefix)

# /calls/export.csv (insights) must come before /calls/{call_id} (uploads).
for area in (insights, uploads, trackers, dashboards, projects, alteria, people, workspace, notifications, usage, billing, docs, tasks):
    app.include_router(area.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
