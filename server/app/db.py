"""Asyncpg pool wiring, wired into the FastAPI lifespan.

`connect()` is idempotent — repeat calls return the existing pool.
`ping()` round-trips a SELECT 1 for /healthz. `close()` is called by
the lifespan on shutdown.
"""

from __future__ import annotations

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def connect() -> asyncpg.Pool | None:
    """Open the pool if configured. Returns None when DATABASE_URL is unset
    (dev mode without a DB — /healthz still works, routes that need it 500).
    """
    global _pool
    if _pool is not None:
        return _pool
    if not settings.database_url:
        return None
    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=5,
        command_timeout=10,
    )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    """Return the active pool or raise — used inside request handlers."""
    if _pool is None:
        raise RuntimeError(
            "Database pool not initialized. Set DATABASE_URL and restart."
        )
    return _pool


async def ping() -> bool:
    """True if the pool is up and can round-trip a trivial query."""
    if _pool is None:
        return False
    try:
        async with _pool.acquire() as conn:
            await conn.fetchval("select 1")
        return True
    except Exception:  # noqa: BLE001 — health check swallows everything
        return False
