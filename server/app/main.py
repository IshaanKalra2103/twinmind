"""FastAPI app entrypoint.

Composition root: middleware, routers, lifespan. Keep business logic out —
prompts, Groq, DB helpers live in their own modules.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import settings
from .routers import chat as chat_router
from .routers import export as export_router
from .routers import suggestions as suggestions_router
from .routers import transcribe as transcribe_router

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","name":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: open the DB pool (no-op if DATABASE_URL is unset).
    pool = await db.connect()
    if pool is None:
        log.warning(
            "DATABASE_URL not set — starting without a DB pool. "
            "Routes needing DB will return 500."
        )
    yield
    await db.close()


app = FastAPI(
    title="TwinMind Backend",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.env != "prod" else None,
    redoc_url=None,
)


# --- Middleware -------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origin_list,
    allow_credentials=False,  # X-Groq-Api-Key is a header, not a cookie.
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id", "X-Request-Id"],
)


@app.middleware("http")
async def request_id_and_session_echo(request: Request, call_next):
    """Stamp every request with an X-Request-Id and echo back any session id
    the deps layer minted during this request.
    """
    req_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = req_id
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001
        log.exception("Unhandled exception: %s", exc)
        response = JSONResponse(
            status_code=500,
            content={"detail": "Internal server error.", "request_id": req_id},
        )
    response.headers["X-Request-Id"] = req_id
    new_sid = getattr(request.state, "new_session_id", None)
    if new_sid:
        response.headers["X-Session-Id"] = new_sid
    return response


# --- Health -----------------------------------------------------------


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    """Cheap liveness: app is up, pool ping is best-effort."""
    return {"ok": True, "db": "up" if await db.ping() else "down"}


# --- Routers ----------------------------------------------------------

app.include_router(transcribe_router.router)
app.include_router(suggestions_router.router)
app.include_router(chat_router.router)
app.include_router(export_router.router)
