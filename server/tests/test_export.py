"""/export returns a well-shaped bundle after a transcribe + suggestions + chat."""

import json
from datetime import UTC, datetime

import pytest

from app import groq_client

GOOD_JSON = json.dumps(
    {
        "suggestions": [
            {"type": "question", "preview": "Ask about margins.", "rationale": "Margins mentioned."},
            {"type": "fact_check", "preview": "US CPI is 3.4%, not 2.1%.", "rationale": "CPI misstated."},
            {"type": "clarifying_info", "preview": "EMEA = Europe/ME/Africa.", "rationale": "Term used."},
        ]
    }
)


@pytest.mark.asyncio
async def test_export_bundle_shape(client, monkeypatch):
    # 1. transcribe
    async def fake_transcribe(**kwargs):
        return "Talk about EMEA margins."

    monkeypatch.setattr(groq_client, "transcribe", fake_transcribe)
    files = {"audio": ("c.webm", b"\x00", "audio/webm")}
    data = {"started_at": datetime.now(UTC).isoformat()}
    r = await client.post(
        "/transcribe", headers={"X-Groq-Api-Key": "k"}, files=files, data=data
    )
    sid = r.headers["X-Session-Id"]

    # 2. suggestions
    async def fake_suggestions_json(**kwargs):
        return GOOD_JSON

    monkeypatch.setattr(groq_client, "suggestions_json", fake_suggestions_json)
    r = await client.post(
        "/suggestions",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={},
    )
    assert r.status_code == 200
    sug_id = r.json()["batch"]["suggestions"][0]["id"]

    # 3. chat (clicks a suggestion)
    async def fake_chat(**kwargs):
        return {"content": "Detailed answer.", "usage": {"prompt_tokens": 1, "completion_tokens": 1}}

    monkeypatch.setattr(groq_client, "chat", fake_chat)
    r = await client.post(
        "/chat",
        headers={"X-Groq-Api-Key": "k", "X-Session-Id": sid},
        json={"suggestion_id": sug_id, "question": None},
    )
    assert r.status_code == 200, r.text

    # 4. export
    r = await client.get("/export", headers={"X-Session-Id": sid})
    assert r.status_code == 200, r.text
    body = r.json()

    # Session.
    assert body["session"]["id"] == sid

    # Transcript present.
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["text"] == "Talk about EMEA margins."

    # Batches include transcript_window_used and prompt_used.
    assert len(body["suggestion_batches"]) == 1
    b = body["suggestion_batches"][0]
    assert "transcript_window_used" in b
    assert "prompt_used" in b
    assert len(b["suggestions"]) == 3
    # clicked flag reflects chat.triggered_by_suggestion_id.
    clicked = [s for s in b["suggestions"] if s["clicked"]]
    assert len(clicked) == 1
    assert clicked[0]["id"] == sug_id

    # Chat rows.
    assert len(body["chat"]) == 2
    roles = [m["role"] for m in body["chat"]]
    assert roles == ["user", "assistant"]
    assert body["chat"][0]["triggered_by_suggestion_id"] == sug_id

    # Meta.
    assert body["meta"]["default_suggestion_prompt_version"] == "v1"
    assert body["meta"]["defaults"]["model_chat"]
