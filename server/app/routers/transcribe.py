"""POST /transcribe — one audio chunk in, one transcript segment out.

Per decision-007, the server owns the canonical transcript. This handler
transcribes with Whisper, skips empty results, and appends to the session.
"""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from .. import groq_client
from ..deps import get_api_key, get_repo, get_session_id
from ..models import TranscribeResponse, TranscriptSegment
from ..session import SessionRepository

log = logging.getLogger(__name__)

router = APIRouter(tags=["transcribe"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB upload cap.

# Obvious Whisper hallucinations on silent inputs. Kept tiny; add as needed.
HALLUCINATION_DENYLIST = {
    "thanks for watching!",
    "thank you for watching.",
    "subscribe to the channel",
    ".",
}


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    audio: UploadFile = File(...),
    started_at: str = Form(...),
    language: str | None = Form(default=None),
    api_key: str = Depends(get_api_key),
    session_id: UUID = Depends(get_session_id),
    repo: SessionRepository = Depends(get_repo),
) -> TranscribeResponse:
    if audio is None or audio.filename is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing audio part.")
    data = await audio.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty audio part.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Audio chunk exceeds 25 MB.",
        )
    try:
        started_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    except ValueError as err:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Invalid started_at: {err}"
        ) from err

    try:
        text = await groq_client.transcribe(
            api_key=api_key,
            audio_bytes=data,
            filename=audio.filename,
            content_type=audio.content_type or "audio/webm",
            language=language,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Groq transcribe failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Upstream transcription failed."
        ) from exc

    text_clean = (text or "").strip()
    if not text_clean or text_clean.lower() in HALLUCINATION_DENYLIST:
        # Silent or hallucinated — do not append.
        return TranscribeResponse(session_id=session_id, segment=None)

    row = await repo.append_segment(session_id, text_clean, started_dt)
    return TranscribeResponse(
        session_id=session_id,
        segment=TranscriptSegment(**row),
    )
