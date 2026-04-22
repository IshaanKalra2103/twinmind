"""Async wrappers around the Groq SDK for the four upstream calls we make.

The Groq SDK ships an `AsyncGroq` client. Each function builds a fresh
client per-request with the user's API key. No persistent client: keys are
per-request per decision-002.

VERIFY model ids (`config.py`): at time of writing Groq exposed
`whisper-large-v3` and `openai/gpt-oss-120b`. If Groq renames them, update
`settings.model_transcribe` / `settings.model_chat`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from groq import AsyncGroq

from .config import settings

log = logging.getLogger(__name__)


def _client(api_key: str) -> AsyncGroq:
    return AsyncGroq(api_key=api_key)


# --- Transcribe -------------------------------------------------------


async def transcribe(
    *,
    api_key: str,
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    language: str | None = None,
) -> str:
    """Whisper Large V3 → plain transcript string. Empty on silence."""
    client = _client(api_key)
    kwargs: dict[str, Any] = {
        "model": settings.model_transcribe,
        "file": (filename, audio_bytes, content_type),
        "response_format": "text",
    }
    if language:
        kwargs["language"] = language
    # The SDK returns a string for response_format="text".
    result = await client.audio.transcriptions.create(**kwargs)
    if isinstance(result, str):
        return result
    # Some SDK versions return an object with .text.
    return getattr(result, "text", "") or ""


# --- Suggestions (JSON) -----------------------------------------------


async def suggestions_json(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 500,
    temperature: float = 0.4,
) -> str:
    """Single completion returning the raw text; caller parses JSON."""
    client = _client(api_key)
    resp = await client.chat.completions.create(
        model=settings.model_chat,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content or ""


# --- Chat — non-streaming ----------------------------------------------


async def chat(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 700,
    temperature: float = 0.5,
) -> dict[str, Any]:
    """One-shot chat completion. Returns {content, usage}."""
    client = _client(api_key)
    resp = await client.chat.completions.create(
        model=settings.model_chat,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=temperature,
    )
    content = resp.choices[0].message.content or ""
    usage = getattr(resp, "usage", None)
    return {
        "content": content,
        "usage": {
            "prompt_tokens": getattr(usage, "prompt_tokens", None),
            "completion_tokens": getattr(usage, "completion_tokens", None),
        },
    }


# --- Chat — streaming --------------------------------------------------


async def chat_stream(
    *,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 700,
    temperature: float = 0.5,
) -> AsyncIterator[str]:
    """Yield token deltas as they arrive. Caller accumulates."""
    client = _client(api_key)
    stream = await client.chat.completions.create(
        model=settings.model_chat,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True,
    )
    async for chunk in stream:
        try:
            delta = chunk.choices[0].delta
            content = getattr(delta, "content", None)
        except (IndexError, AttributeError):
            content = None
        if content:
            yield content
