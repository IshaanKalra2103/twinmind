"""GET /export — full session bundle for grading.

Zero upstream calls. Requires only a known `X-Session-Id`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends

from .. import prompts
from ..config import settings
from ..deps import get_repo, require_existing_session
from ..models import (
    ChatMessage,
    ExportBatch,
    ExportBundle,
    ExportChatMessage,
    ExportDefaults,
    ExportMeta,
    ExportSession,
    ExportSuggestion,
    TranscriptSegment,
)
from ..session import SessionRepository

router = APIRouter(tags=["export"])


@router.get("/export", response_model=ExportBundle)
async def export_bundle(
    session_id: UUID = Depends(require_existing_session),
    repo: SessionRepository = Depends(get_repo),
) -> ExportBundle:
    session_row = await repo.get_session(session_id)
    segments = await repo.list_segments(session_id)
    batches = await repo.list_batches_with_suggestions(session_id)
    chat_rows = await repo.list_chat_messages(session_id)
    clicked = await repo.clicked_suggestion_ids(session_id)

    # assert session_row — require_existing_session already vetted it.
    assert session_row is not None

    return ExportBundle(
        session=ExportSession(
            id=session_row["id"],
            created_at=session_row["created_at"],
            ended_at=None,
        ),
        transcript=[TranscriptSegment(**s) for s in segments],
        suggestion_batches=[
            ExportBatch(
                id=b["id"],
                created_at=b["created_at"],
                transcript_window_chars=b["transcript_window_chars"],
                transcript_window_used=b["transcript_window_used"],
                prompt_used=b["prompt_used"],
                suggestions=[
                    ExportSuggestion(
                        id=s["id"],
                        type=s["type"],
                        preview=s["preview"],
                        rationale=s.get("rationale"),
                        clicked=(s["id"] in clicked),
                    )
                    for s in b["suggestions"]
                ],
            )
            for b in batches
        ],
        chat=[
            ExportChatMessage(
                **{
                    k: v
                    for k, v in ChatMessage(**m).model_dump().items()
                    if k in ExportChatMessage.model_fields
                }
            )
            for m in chat_rows
        ],
        meta=ExportMeta(
            exported_at=datetime.now(UTC),
            default_suggestion_prompt_version=prompts.SUGGESTION_PROMPT_VERSION,
            defaults=ExportDefaults(
                context_window_suggestions_chars=settings.context_window_suggestions_chars,
                context_window_expanded_chars=settings.context_window_expanded_chars,
                model_transcribe=settings.model_transcribe,
                model_chat=settings.model_chat,
            ),
        ),
    )
