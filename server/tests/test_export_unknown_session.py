from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_export_unknown_session_404(client):
    r = await client.get("/export", headers={"X-Session-Id": str(uuid4())})
    assert r.status_code == 404
