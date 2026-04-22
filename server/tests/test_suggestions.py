"""Suggestions endpoint: happy path, empty-transcript 409, bad-JSON retry."""

import json
from datetime import UTC, datetime

import pytest

from app import groq_client

GOOD_JSON = json.dumps(
    {
        "suggestions": [
            {
                "type": "question",
                "preview": "Ask about the Q3 revenue miss in EMEA specifically.",
                "rationale": "Speaker mentioned revenue but glossed over EMEA.",
            },
            {
                "type": "fact_check",
                "preview": "The US CPI figure quoted (2.1%) is stale — latest print is 3.4%.",
                "rationale": "CPI claim made at T+12s does not match current data.",
            },
            {
                "type": "clarifying_info",
                "preview": "EMEA = Europe, Middle East, Africa; used in sales segmentation.",
                "rationale": "Term EMEA used without definition.",
            },
        ]
    }
)


async def _seed_segment(client, monkeypatch, text: str = "Let's discuss Q3 revenue in EMEA."):
    """Drop one transcript segment via /transcribe."""

    async def fake_transcribe(**kwargs):
        return text

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)
    files = {"audio": ("clip.webm", b"\x00", "audio/webm")}
    data = {"started_at": datetime.now(UTC).isoformat()}
    r = await client.post(
        "/transcribe", headers={"X-Groq-Api-Key": "k"}, files=files, data=data
    )
    assert r.status_code == 200
    return r.headers["X-Session-Id"]


@pytest.mark.asyncio
async def test_suggestions_happy_path(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)

    async def fake_suggestions_json(**kwargs):
        return GOOD_JSON

    monkeypatch.setattr(groq_client, "suggestions_json", fake_suggestions_json)
    r = await client.post(
        "/suggestions",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["batch"]["suggestions"]) == 3
    types = {s["type"] for s in body["batch"]["suggestions"]}
    assert types.issubset(
        {"question", "talking_point", "answer", "fact_check", "clarifying_info"}
    )


@pytest.mark.asyncio
async def test_suggestions_empty_transcript_409(client):
    # No segment seeded.
    r = await client.post(
        "/suggestions",
        headers={"X-Groq-Api-Key": "k"},
        json={},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_suggestions_bad_json_retries_then_succeeds(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)

    calls = {"n": 0}

    async def flaky_suggestions_json(**kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return "not-json at all ~~~"
        return GOOD_JSON

    monkeypatch.setattr(groq_client, "suggestions_json", flaky_suggestions_json)
    r = await client.post(
        "/suggestions",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={},
    )
    assert r.status_code == 200, r.text
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_suggestions_bad_json_twice_returns_502(client, monkeypatch):
    sid = await _seed_segment(client, monkeypatch)

    async def always_bad(**kwargs):
        return "still not json"

    monkeypatch.setattr(groq_client, "suggestions_json", always_bad)
    r = await client.post(
        "/suggestions",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={},
    )
    assert r.status_code == 502
