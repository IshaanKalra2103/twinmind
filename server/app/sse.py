"""Tiny helper for SSE event formatting.

`sse-starlette` handles the framing for us (it yields `ServerSentEvent`
objects), but a single formatter keeps router code clean and testable.
"""

from __future__ import annotations

import json
from typing import Any

from sse_starlette.sse import ServerSentEvent


def sse_event(event: str, data: dict[str, Any]) -> ServerSentEvent:
    """Build a `ServerSentEvent` with a JSON-encoded payload."""
    return ServerSentEvent(data=json.dumps(data, default=str), event=event)
