"""Without X-Groq-Api-Key (and without the dev fallback) we return 401."""

import pytest

from app.config import settings


@pytest.mark.asyncio
async def test_missing_api_key_returns_401(client, monkeypatch):
    # Disable the dev fallback so the missing-header case is strict.
    monkeypatch.setattr(settings, "groq_api_key", None)
    r = await client.post("/suggestions", json={})
    assert r.status_code == 401
