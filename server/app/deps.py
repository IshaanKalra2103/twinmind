"""FastAPI dependencies: API key, session id, repository."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status

from . import db
from .config import settings
from .session import SessionRepository


def get_api_key(
    x_groq_api_key: str | None = Header(default=None, alias="X-Groq-Api-Key"),
) -> str:
    """Extract the user's Groq API key from the request header.

    Decision 002: key rides every request; never persisted. In dev, if the
    header is absent, we fall back to `GROQ_API_KEY` from the environment so
    the developer can curl the API without juggling a header.
    """
    if x_groq_api_key:
        return x_groq_api_key
    if settings.env == "dev" and settings.groq_api_key:
        return settings.groq_api_key
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing X-Groq-Api-Key header.",
    )


def get_repo() -> SessionRepository:
    return SessionRepository(db.pool())


async def get_session_id(
    request: Request,
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
    repo: SessionRepository = Depends(get_repo),
) -> UUID:
    """Resolve or mint a session id.

    If the client sent `X-Session-Id`, validate it exists. If not, mint a
    new one and stash it on `request.state.new_session_id` so the response
    middleware can echo it back via the `X-Session-Id` header (see main.py).
    """
    if x_session_id:
        try:
            sid = UUID(x_session_id)
        except ValueError as err:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Session-Id (must be a uuid).",
            ) from err
        if not await repo.session_exists(sid):
            # Session id came in but the row is gone (restart, pruned).
            # Mint a new one rather than 404 — nicer UX.
            sid = await repo.create_session()
            request.state.new_session_id = str(sid)
        else:
            await repo.touch(sid)
        return sid
    sid = await repo.create_session()
    request.state.new_session_id = str(sid)
    return sid


async def require_existing_session(
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
    repo: SessionRepository = Depends(get_repo),
) -> UUID:
    """Strict variant: /export 404s if the session doesn't exist."""
    if not x_session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Session-Id.",
        )
    try:
        sid = UUID(x_session_id)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid X-Session-Id.",
        ) from err
    if not await repo.session_exists(sid):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unknown session id.",
        )
    return sid
