"""Chat endpoints: happy path, unknown suggestion_id 404, stream contract."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app import groq_client


async def _seed_segment(client, monkeypatch, text: str = "We talked about EMEA margins."):
    async def fake_transcribe(**kwargs):
        return text

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)
    files = {"audio": ("c.webm", b"\x00", "audio/webm")}
    data = {"started_at": datetime.now(UTC).isoformat()}
    r = await client.post(
        "/transcribe", headers={"X-Groq-Api-Key": "k"}, files=files, data=data
    )
    assert r.status_code == 200
    return r.headers["X-Session-Id"]


@pytest.mark.asyncio
async def test_chat_happy_path(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)

    async def fake_chat(**kwargs):
        return {
            "content": "Here is a detailed answer.",
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        }

    monkeypatch.setattr(groq_client, "chat", fake_chat)
    r = await client.post(
        "/chat",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={"question": "What did they say about EMEA?"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["message"]["content"] == "Here is a detailed answer."
    assert body["message"]["role"] == "assistant"


@pytest.mark.asyncio
async def test_chat_unknown_suggestion_id_404(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)
    bogus = str(uuid4())
    r = await client.post(
        "/chat",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={"suggestion_id": bogus, "question": "Tell me more."},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_chat_stream_emits_start_token_done(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)

    async def fake_stream(**kwargs):
        async def gen():
            for t in ["Hello", " ", "world"]:
                yield t

        return gen()

    # chat_stream is an async generator; we assign the async generator
    # factory directly.
    async def fake_chat_stream(**kwargs):
        for t in ["Hello", " ", "world"]:
            yield t

    monkeypatch.setattr(groq_client, "chat_stream", fake_chat_stream)

    async with client.stream(
        "POST",
        "/chat-stream",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={"question": "Hi"},
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        body = b""
        async for chunk in r.aiter_bytes():
            body += chunk
            if b"event: done" in body:
                break
        text = body.decode()
        assert "event: start" in text
        assert "event: token" in text
        assert "event: done" in text
