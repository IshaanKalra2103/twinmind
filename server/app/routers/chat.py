"""POST /chat and POST /chat-stream.

`/chat-stream` is POST (decision-003) — `fetch + ReadableStream` on the
client, so we can carry `X-Groq-Api-Key` as a header. `sse-starlette`
handles framing, disconnect detection, and the 15s keep-alive ping.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from .. import groq_client, prompts
from ..config import settings
from ..deps import get_api_key, get_repo, get_session_id
from ..models import ChatMessage, ChatRequest, ChatResponse, ChatUsage
from ..session import SessionRepository
from ..sse import sse_event

log = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


async def _build_context(
    *,
    repo: SessionRepository,
    session_id: UUID,
    body: ChatRequest,
) -> tuple[str, str, str, dict[str, Any] | None]:
    """Return (system_prompt, user_prompt, mode, suggestion_row).

    `mode` is "expanded" if a suggestion was clicked, else "chat".
    """
    # Look up the suggestion if provided.
    sug: dict[str, Any] | None = None
    if body.suggestion_id is not None:
        sug = await repo.find_suggestion(body.suggestion_id)
        if sug is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Unknown suggestion_id.",
            )
        if sug["session_id"] != session_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="suggestion_id belongs to a different session.",
            )

    # Transcript window.
    if sug is not None:
        window_chars = body.context_window_chars or settings.context_window_expanded_chars
    else:
        window_chars = body.context_window_chars or settings.context_window_chat_chars
    full = await repo.concat_transcript(session_id)
    window = full[-window_chars:] if full else "(transcript is empty)"

    if sug is not None:
        mode = "expanded"
        system_prompt = body.prompt_override or prompts.DEFAULT_EXPANDED_ANSWER_PROMPT
        sug_block = (
            f"type: {sug['type']}\n"
            f"preview: {sug['preview']}\n"
            f"rationale: {sug.get('rationale') or '(none)'}"
        )
        user_prompt = (
            "transcript_window:\n"
            f"{window}\n"
            "---\n"
            "suggestion:\n"
            f"{sug_block}\n"
            "---\n"
            "user_question:\n"
            f"{body.question or '(none — user clicked the card)'}"
        )
    else:
        if not body.question or not body.question.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either `question` or `suggestion_id` is required.",
            )
        mode = "chat"
        system_prompt = body.prompt_override or prompts.DEFAULT_CHAT_PROMPT
        turns = await repo.recent_chat_turns(session_id, settings.chat_history_turns)
        if turns:
            history = "\n".join(f"{t['role']}: {t['content']}" for t in turns)
        else:
            history = "(no prior turns)"
        user_prompt = (
            "transcript_window:\n"
            f"{window}\n"
            "---\n"
            "chat_history:\n"
            f"{history}\n"
            "---\n"
            "user_question:\n"
            f"{body.question}"
        )
    return system_prompt, user_prompt, mode, sug


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    body: ChatRequest,
    api_key: str = Depends(get_api_key),
    session_id: UUID = Depends(get_session_id),
    repo: SessionRepository = Depends(get_repo),
) -> ChatResponse:
    system_prompt, user_prompt, _mode, sug = await _build_context(
        repo=repo, session_id=session_id, body=body
    )

    # Insert the user message first so /export reflects the click/question
    # even if the upstream call fails.
    user_content = body.question or (sug["preview"] if sug else "")
    await repo.insert_chat_message(
        session_id,
        role="user",
        content=user_content,
        triggered_by_suggestion_id=sug["id"] if sug else None,
    )

    try:
        result = await groq_client.chat(
            api_key=api_key,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("chat upstream failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Upstream chat failed."
        ) from exc

    msg_row = await repo.insert_chat_message(
        session_id,
        role="assistant",
        content=result["content"],
        triggered_by_suggestion_id=sug["id"] if sug else None,
    )

    return ChatResponse(
        session_id=session_id,
        message=ChatMessage(**msg_row),
        usage=ChatUsage(**result["usage"]) if result.get("usage") else None,
    )


@router.post("/chat-stream")
async def chat_stream_endpoint(
    body: ChatRequest,
    api_key: str = Depends(get_api_key),
    session_id: UUID = Depends(get_session_id),
    repo: SessionRepository = Depends(get_repo),
) -> EventSourceResponse:
    system_prompt, user_prompt, _mode, sug = await _build_context(
        repo=repo, session_id=session_id, body=body
    )

    # Record the user turn before the stream opens.
    user_content = body.question or (sug["preview"] if sug else "")
    await repo.insert_chat_message(
        session_id,
        role="user",
        content=user_content,
        triggered_by_suggestion_id=sug["id"] if sug else None,
    )

    # Pre-mint the assistant message id so the client can match `start` to
    # the eventual row. The row itself is inserted on `done` / `error`.
    message_id = uuid4()
    created_at = datetime.now(UTC)

    async def event_generator():
        accumulated: list[str] = []
        finished_ok = False
        try:
            yield sse_event(
                "start",
                {"message_id": str(message_id), "created_at": created_at.isoformat()},
            )
            async for delta in groq_client.chat_stream(
                api_key=api_key,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            ):
                accumulated.append(delta)
                yield sse_event("token", {"delta": delta})
            finished_ok = True
            yield sse_event(
                "done",
                {
                    "message_id": str(message_id),
                    "finish_reason": "stop",
                    "usage": {},
                },
            )
        except asyncio.CancelledError:
            # Client disconnected. Save what we have, then re-raise so
            # sse-starlette closes cleanly.
            log.info("chat-stream cancelled mid-flight")
            await repo.insert_chat_message(
                session_id,
                role="assistant",
                content="".join(accumulated),
                triggered_by_suggestion_id=sug["id"] if sug else None,
                finished=False,
            )
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("chat-stream upstream failed: %s", exc)
            yield sse_event(
                "error",
                {"code": "upstream_error", "message": str(exc)},
            )
            await repo.insert_chat_message(
                session_id,
                role="assistant",
                content="".join(accumulated),
                triggered_by_suggestion_id=sug["id"] if sug else None,
                finished=False,
            )
            return
        finally:
            if finished_ok:
                await repo.insert_chat_message(
                    session_id,
                    role="assistant",
                    content="".join(accumulated),
                    triggered_by_suggestion_id=sug["id"] if sug else None,
                    finished=True,
                )

    return EventSourceResponse(event_generator(), ping=15)
