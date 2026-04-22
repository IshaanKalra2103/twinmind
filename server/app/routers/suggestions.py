"""POST /suggestions — exactly 3 suggestions from the recent transcript.

Prompt is the graded core; see `prompts.py`. One retry on bad JSON.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from .. import groq_client, prompts
from ..config import settings
from ..deps import get_api_key, get_repo, get_session_id
from ..models import (
    Suggestion,
    SuggestionBatch,
    SuggestionsRequest,
    SuggestionsResponse,
)
from ..session import SessionRepository

log = logging.getLogger(__name__)

router = APIRouter(tags=["suggestions"])

VALID_TYPES = {
    "question",
    "talking_point",
    "answer",
    "fact_check",
    "clarifying_info",
}


def _parse_suggestions_json(raw: str) -> list[dict]:
    """Return a list of exactly 3 suggestion dicts or raise ValueError."""
    data = json.loads(raw)
    if not isinstance(data, dict) or "suggestions" not in data:
        raise ValueError("Missing 'suggestions' key at top level.")
    items = data["suggestions"]
    if not isinstance(items, list) or len(items) != 3:
        raise ValueError(f"Expected 3 suggestions, got {len(items) if isinstance(items, list) else 'non-list'}.")
    out: list[dict] = []
    for i, s in enumerate(items):
        if not isinstance(s, dict):
            raise ValueError(f"suggestions[{i}] is not an object.")
        t = s.get("type")
        preview = s.get("preview")
        if t not in VALID_TYPES:
            raise ValueError(f"suggestions[{i}].type invalid: {t!r}")
        if not isinstance(preview, str) or not preview.strip():
            raise ValueError(f"suggestions[{i}].preview missing or empty.")
        out.append(
            {
                "type": t,
                "preview": preview.strip()[:280],  # defensive cap
                "rationale": (s.get("rationale") or "").strip()[:200] or None,
            }
        )
    return out


def _build_user_prompt(transcript_window: str, previous_batch_previews: list[str]) -> str:
    if previous_batch_previews:
        prev = "\n".join(f"- {p}" for p in previous_batch_previews)
    else:
        prev = "(none — this is the first batch)"
    # DEFAULT_SUGGESTION_PROMPT is used as the system prompt. The user
    # prompt only delivers the dynamic variables; keep it minimal so the
    # model can't drift away from the system prompt's contract.
    return (
        "transcript_window:\n"
        f"{transcript_window}\n"
        "---\n"
        "previous_batch_previews:\n"
        f"{prev}"
    )


@router.post("/suggestions", response_model=SuggestionsResponse)
async def suggestions(
    body: SuggestionsRequest | None = None,
    api_key: str = Depends(get_api_key),
    session_id: UUID = Depends(get_session_id),
    repo: SessionRepository = Depends(get_repo),
) -> SuggestionsResponse:
    body = body or SuggestionsRequest()
    window_chars = body.context_window_chars or settings.context_window_suggestions_chars

    full = await repo.concat_transcript(session_id)
    if not full.strip():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Transcript is empty — no suggestions can be produced yet.",
        )
    window = full[-window_chars:]

    prev_previews: list[str] = []
    if body.include_previous_batch_hint:
        prev_previews = await repo.get_previous_batch_previews(session_id, limit=1)

    system_prompt = body.prompt_override or prompts.DEFAULT_SUGGESTION_PROMPT
    user_prompt = _build_user_prompt(window, prev_previews)

    # One shot + one retry on bad JSON.
    attempts = 0
    last_err: Exception | None = None
    parsed: list[dict] | None = None
    while attempts < 2 and parsed is None:
        attempts += 1
        try:
            raw = await groq_client.suggestions_json(
                api_key=api_key,
                system_prompt=(
                    prompts.SUGGESTION_JSON_RETRY_PREFIX + system_prompt
                    if attempts == 2
                    else system_prompt
                ),
                user_prompt=user_prompt,
            )
            parsed = _parse_suggestions_json(raw)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            log.warning("suggestions attempt %d failed: %s", attempts, exc)

    if parsed is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Suggestions upstream failed: {last_err}",
        )

    # Soft diversity warning — do not re-prompt (latency hit).
    types = {s["type"] for s in parsed}
    if len(types) == 1 and "?" not in window:
        log.info("suggestions: single-type batch — type=%s", next(iter(types)))

    batch_row = await repo.insert_suggestion_batch(
        session_id,
        transcript_window_chars=len(window),
        transcript_window_used=window,
        prompt_used=system_prompt,
        prompt_version=prompts.SUGGESTION_PROMPT_VERSION,
        suggestions=parsed,
    )

    return SuggestionsResponse(
        session_id=session_id,
        batch=SuggestionBatch(
            id=batch_row["id"],
            created_at=batch_row["created_at"],
            transcript_window_chars=batch_row["transcript_window_chars"],
            suggestions=[Suggestion(**s) for s in batch_row["suggestions"]],
        ),
    )
