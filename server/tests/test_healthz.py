import pytest


@pytest.mark.asyncio
async def test_healthz_returns_ok(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    # db is "down" because we don't wire a real pool in tests.
    assert body["db"] in {"up", "down"}
