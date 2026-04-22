"""Happy path for /transcribe: Groq is mocked to return a fixed string."""

from datetime import UTC, datetime

import pytest

from app import groq_client


@pytest.mark.asyncio
async def test_transcribe_happy_path(client, monkeypatch):
    async def fake_transcribe(**kwargs):
        return "Hello world, this is a test."

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)

    files = {"audio": ("clip.webm", b"\x00\x01\x02", "audio/webm")}
    data = {"started_at": datetime.now(UTC).isoformat()}
    r = await client.post(
        "/transcribe",
        headers={"X-Groq-Api-Key": "k"},
        files=files,
        data=data,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["segment"]["text"] == "Hello world, this is a test."
    assert "X-Session-Id" in r.headers


@pytest.mark.asyncio
async def test_transcribe_skips_empty_transcript(client, monkeypatch):
    async def fake_transcribe(**kwargs):
        return "  "

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)

    files = {"audio": ("clip.webm", b"\x00", "audio/webm")}
    data = {"started_at": datetime.now(UTC).isoformat()}
    r = await client.post(
        "/transcribe",
        headers={"X-Groq-Api-Key": "k"},
        files=files,
        data=data,
    )
    assert r.status_code == 200
    assert r.json()["segment"] is None
