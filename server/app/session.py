"""SessionRepository — Supabase-backed store for per-session state.

All CRUD lives here. Routers never run raw SQL; they call these methods.
The repository holds an asyncpg Pool; for each call we acquire a
connection for the minimum critical section.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg


class SessionRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    # --- Sessions ------------------------------------------------------

    async def create_session(self) -> UUID:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "insert into sessions default values returning id"
            )
            return row["id"]

    async def session_exists(self, session_id: UUID) -> bool:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "select 1 from sessions where id = $1", session_id
            )
            return row is not None

    async def touch(self, session_id: UUID) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "update sessions set last_touched = now() where id = $1",
                session_id,
            )

    async def get_session(self, session_id: UUID) -> dict[str, Any] | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "select id, created_at from sessions where id = $1",
                session_id,
            )
            return dict(row) if row else None

    # --- Transcript ----------------------------------------------------

    async def append_segment(
        self,
        session_id: UUID,
        text: str,
        started_at: datetime,
    ) -> dict[str, Any]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into transcript_segments (session_id, text, started_at)
                values ($1, $2, $3)
                returning id, text, started_at, received_at
                """,
                session_id,
                text,
                started_at,
            )
            return dict(row)

    async def list_segments(self, session_id: UUID) -> list[dict[str, Any]]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select id, text, started_at, received_at
                from transcript_segments
                where session_id = $1
                order by received_at asc
                """,
                session_id,
            )
            return [dict(r) for r in rows]

    async def concat_transcript(self, session_id: UUID) -> str:
        """Return the full transcript as one string, ordered by arrival."""
        segments = await self.list_segments(session_id)
        return "\n".join(s["text"] for s in segments)

    # --- Suggestion batches -------------------------------------------

    async def insert_suggestion_batch(
        self,
        session_id: UUID,
        *,
        transcript_window_chars: int,
        transcript_window_used: str,
        prompt_used: str,
        prompt_version: str,
        suggestions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Insert a batch + its 3 suggestion rows in a single transaction.

        `suggestions` items: {type, preview, rationale}
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                batch = await conn.fetchrow(
                    """
                    insert into suggestion_batches (
                      session_id, transcript_window_chars,
                      transcript_window_used, prompt_used, prompt_version
                    )
                    values ($1, $2, $3, $4, $5)
                    returning id, created_at,
                              transcript_window_chars,
                              transcript_window_used, prompt_used, prompt_version
                    """,
                    session_id,
                    transcript_window_chars,
                    transcript_window_used,
                    prompt_used,
                    prompt_version,
                )
                batch_id: UUID = batch["id"]
                inserted: list[dict[str, Any]] = []
                for s in suggestions:
                    row = await conn.fetchrow(
                        """
                        insert into suggestions (batch_id, type, preview, rationale)
                        values ($1, $2, $3, $4)
                        returning id, type, preview, rationale
                        """,
                        batch_id,
                        s["type"],
                        s["preview"],
                        s.get("rationale"),
                    )
                    inserted.append(dict(row))
                return {**dict(batch), "suggestions": inserted}

    async def get_previous_batch_previews(
        self,
        session_id: UUID,
        limit: int = 1,
    ) -> list[str]:
        """Return the previews of the most recent N batches' suggestions.

        Used for anti-repetition in the live-suggestion prompt.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select s.preview
                from suggestions s
                join suggestion_batches b on b.id = s.batch_id
                where b.session_id = $1
                order by b.created_at desc
                limit $2
                """,
                session_id,
                limit * 3,  # 3 suggestions per batch
            )
            return [r["preview"] for r in rows]

    async def list_batches_with_suggestions(
        self, session_id: UUID
    ) -> list[dict[str, Any]]:
        async with self._pool.acquire() as conn:
            batches = await conn.fetch(
                """
                select id, created_at, transcript_window_chars,
                       transcript_window_used, prompt_used, prompt_version
                from suggestion_batches
                where session_id = $1
                order by created_at asc
                """,
                session_id,
            )
            result: list[dict[str, Any]] = []
            for b in batches:
                sugs = await conn.fetch(
                    """
                    select id, type, preview, rationale
                    from suggestions
                    where batch_id = $1
                    """,
                    b["id"],
                )
                result.append({**dict(b), "suggestions": [dict(s) for s in sugs]})
            return result

    async def find_suggestion(
        self, suggestion_id: UUID
    ) -> dict[str, Any] | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                select s.id, s.type, s.preview, s.rationale, b.session_id
                from suggestions s
                join suggestion_batches b on b.id = s.batch_id
                where s.id = $1
                """,
                suggestion_id,
            )
            return dict(row) if row else None

    # --- Chat ----------------------------------------------------------

    async def insert_chat_message(
        self,
        session_id: UUID,
        *,
        role: str,
        content: str,
        triggered_by_suggestion_id: UUID | None = None,
        finished: bool = True,
    ) -> dict[str, Any]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                insert into chat_messages (
                  session_id, role, content,
                  triggered_by_suggestion_id, finished
                )
                values ($1, $2, $3, $4, $5)
                returning id, role, content, created_at,
                          triggered_by_suggestion_id, finished
                """,
                session_id,
                role,
                content,
                triggered_by_suggestion_id,
                finished,
            )
            return dict(row)

    async def list_chat_messages(
        self, session_id: UUID
    ) -> list[dict[str, Any]]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select id, role, content, created_at,
                       triggered_by_suggestion_id, finished
                from chat_messages
                where session_id = $1
                order by created_at asc
                """,
                session_id,
            )
            return [dict(r) for r in rows]

    async def recent_chat_turns(
        self, session_id: UUID, limit: int
    ) -> list[dict[str, Any]]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select role, content
                from chat_messages
                where session_id = $1
                order by created_at desc
                limit $2
                """,
                session_id,
                limit,
            )
            return list(reversed([dict(r) for r in rows]))

    # --- Derived for export -------------------------------------------

    async def clicked_suggestion_ids(self, session_id: UUID) -> set[UUID]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                select distinct triggered_by_suggestion_id as id
                from chat_messages
                where session_id = $1 and triggered_by_suggestion_id is not null
                """,
                session_id,
            )
            return {r["id"] for r in rows if r["id"] is not None}
