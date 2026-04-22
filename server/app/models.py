"""Pydantic request/response schemas.

Shapes are authoritative per the endpoint contract pages under
`.agent/journal/agent-journal/endpoints/`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SuggestionType = Literal[
    "question",
    "talking_point",
    "answer",
    "fact_check",
    "clarifying_info",
]


# --- Transcribe -------------------------------------------------------


class TranscriptSegment(BaseModel):
    id: UUID
    text: str
    started_at: datetime
    received_at: datetime


class TranscribeResponse(BaseModel):
    session_id: UUID
    segment: TranscriptSegment | None = Field(
        default=None,
        description="None when the chunk was silent (empty transcript).",
    )


# --- Suggestions ------------------------------------------------------


class SuggestionsRequest(BaseModel):
    prompt_override: str | None = None
    context_window_chars: int | None = None
    include_previous_batch_hint: bool = True


class Suggestion(BaseModel):
    id: UUID
    type: SuggestionType
    preview: str
    rationale: str | None = None


class SuggestionBatch(BaseModel):
    id: UUID
    created_at: datetime
    transcript_window_chars: int
    suggestions: list[Suggestion]


class SuggestionsResponse(BaseModel):
    session_id: UUID
    batch: SuggestionBatch


# --- Chat (streaming + non-streaming share a body) --------------------


class ChatRequest(BaseModel):
    question: str | None = None
    suggestion_id: UUID | None = None
    prompt_override: str | None = None
    context_window_chars: int | None = None


class ChatMessage(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    triggered_by_suggestion_id: UUID | None = None


class ChatUsage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class ChatResponse(BaseModel):
    session_id: UUID
    message: ChatMessage
    usage: ChatUsage | None = None


# --- Export -----------------------------------------------------------


class ExportSession(BaseModel):
    id: UUID
    created_at: datetime
    ended_at: datetime | None = None


class ExportSuggestion(Suggestion):
    clicked: bool = False


class ExportBatch(BaseModel):
    id: UUID
    created_at: datetime
    transcript_window_chars: int
    transcript_window_used: str
    prompt_used: str
    suggestions: list[ExportSuggestion]


class ExportChatMessage(ChatMessage):
    pass


class ExportDefaults(BaseModel):
    context_window_suggestions_chars: int
    context_window_expanded_chars: int
    model_transcribe: str
    model_chat: str


class ExportMeta(BaseModel):
    exported_at: datetime
    default_suggestion_prompt_version: str
    defaults: ExportDefaults


class ExportBundle(BaseModel):
    session: ExportSession
    transcript: list[TranscriptSegment]
    suggestion_batches: list[ExportBatch]
    chat: list[ExportChatMessage]
    meta: ExportMeta
