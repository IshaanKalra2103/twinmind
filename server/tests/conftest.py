"""Pytest fixtures.

We patch `app.db` with an in-memory SessionRepository double so tests run
with no Postgres dependency. Integration tests against a real DB can be
added later — see README "Real Supabase testing" — but aren't required for
the initial suite.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set env before importing app so config picks it up.
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("GROQ_API_KEY", "test-key")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


class _FakeRepo:
    """Minimal in-memory stand-in for SessionRepository.

    Implements only the methods the routers call. Keeps data structures
    intentionally flat so tests can inspect them.
    """

    def __init__(self) -> None:
        self.sessions: dict[UUID, dict[str, Any]] = {}
        self.segments: list[dict[str, Any]] = []
        self.batches: list[dict[str, Any]] = []
        self.suggestions_by_id: dict[UUID, dict[str, Any]] = {}
        self.chat: list[dict[str, Any]] = []

    async def create_session(self) -> UUID:
        sid = uuid4()
        self.sessions[sid] = {"id": sid, "created_at": datetime.now(UTC)}
        return sid

    async def session_exists(self, sid: UUID) -> bool:
        return sid in self.sessions

    async def touch(self, sid: UUID) -> None:  # no-op
        pass

    async def get_session(self, sid: UUID) -> dict[str, Any] | None:
        return self.sessions.get(sid)

    async def append_segment(self, sid: UUID, text: str, started_at) -> dict[str, Any]:
        row = {
            "id": uuid4(),
            "text": text,
            "started_at": started_at,
            "received_at": datetime.now(UTC),
            "session_id": sid,
        }
        self.segments.append(row)
        return row

    async def list_segments(self, sid: UUID) -> list[dict[str, Any]]:
        return [s for s in self.segments if s["session_id"] == sid]

    async def concat_transcript(self, sid: UUID) -> str:
        return "\n".join(s["text"] for s in self.segments if s["session_id"] == sid)

    async def insert_suggestion_batch(
        self,
        sid: UUID,
        *,
        transcript_window_chars: int,
        transcript_window_used: str,
        prompt_used: str,
        prompt_version: str,
        suggestions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        batch_id = uuid4()
        batch = {
            "id": batch_id,
            "session_id": sid,
            "created_at": datetime.now(UTC),
            "transcript_window_chars": transcript_window_chars,
            "transcript_window_used": transcript_window_used,
            "prompt_used": prompt_used,
            "prompt_version": prompt_version,
            "suggestions": [],
        }
        for s in suggestions:
            row = {
                "id": uuid4(),
                "type": s["type"],
                "preview": s["preview"],
                "rationale": s.get("rationale"),
                "batch_id": batch_id,
                "session_id": sid,
            }
            self.suggestions_by_id[row["id"]] = row
            batch["suggestions"].append(row)
        self.batches.append(batch)
        return batch

    async def get_previous_batch_previews(self, sid: UUID, limit: int = 1) -> list[str]:
        relevant = [b for b in self.batches if b["session_id"] == sid]
        relevant.sort(key=lambda b: b["created_at"], reverse=True)
        out: list[str] = []
        for b in relevant[:limit]:
            out.extend(s["preview"] for s in b["suggestions"])
        return out

    async def list_batches_with_suggestions(self, sid: UUID) -> list[dict[str, Any]]:
        return [b for b in self.batches if b["session_id"] == sid]

    async def find_suggestion(self, sug_id: UUID) -> dict[str, Any] | None:
        return self.suggestions_by_id.get(sug_id)

    async def insert_chat_message(
        self,
        sid: UUID,
        *,
        role: str,
        content: str,
        triggered_by_suggestion_id: UUID | None = None,
        finished: bool = True,
    ) -> dict[str, Any]:
        row = {
            "id": uuid4(),
            "role": role,
            "content": content,
            "created_at": datetime.now(UTC),
            "triggered_by_suggestion_id": triggered_by_suggestion_id,
            "finished": finished,
            "session_id": sid,
        }
        self.chat.append(row)
        return row

    async def list_chat_messages(self, sid: UUID) -> list[dict[str, Any]]:
        return [m for m in self.chat if m["session_id"] == sid]

    async def recent_chat_turns(self, sid: UUID, limit: int) -> list[dict[str, Any]]:
        msgs = [m for m in self.chat if m["session_id"] == sid]
        return msgs[-limit:]

    async def clicked_suggestion_ids(self, sid: UUID) -> set[UUID]:
        return {
            m["triggered_by_suggestion_id"]
            for m in self.chat
            if m["session_id"] == sid and m["triggered_by_suggestion_id"]
        }


@pytest.fixture
def fake_repo() -> _FakeRepo:
    return _FakeRepo()


@pytest_asyncio.fixture
async def client(fake_repo: _FakeRepo) -> AsyncIterator[AsyncClient]:
    """Yield an httpx AsyncClient bound to the app with `deps.get_repo`
    overridden to return our in-memory fake. `db.connect` is a no-op here —
    the lifespan will just log a warning when DATABASE_URL is absent.
    """
    from app.deps import get_repo
    from app.main import app

    app.dependency_overrides[get_repo] = lambda: fake_repo
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
