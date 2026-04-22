# TwinMind Backend

FastAPI service that transcribes live meeting audio, generates three
context-aware live suggestions every ~30s, streams chat answers over SSE,
and produces a full session export bundle for grading.

Authoritative plan: `.agent/journal/agent-journal/plans/plan-backend.md`.
Architecture decisions: `.agent/journal/agent-journal/decisions/` (001, 002,
003, 007, 008, 009). Endpoint contracts: `.agent/journal/agent-journal/endpoints/`.

## Stack

- **FastAPI** on Python 3.12, deps managed by **uv**.
- **Groq** SDK for transcription (`whisper-large-v3`) and chat
  (`openai/gpt-oss-120b`). The user's Groq API key rides every request as
  `X-Groq-Api-Key` and is never persisted (decision-002).
- **Supabase Postgres** via **asyncpg** for session state (decision-008).
- **sse-starlette** for `/chat-stream` (decision-003: POST, not GET).
- **pytest + pytest-asyncio** for tests; `respx` / monkeypatching fakes the
  Groq SDK so the suite runs offline.
- **Cloud Run** target — see `decision-009-gcp-cloud-run.md`. Deploy flow
  is the `gcp-deploy` skill; not part of this service's code.

## Setup

```bash
cd server
uv sync                 # installs runtime + dev deps
cp .env.example .env    # fill in DATABASE_URL
```

### Required env vars

| Var | Purpose |
|---|---|
| `ENV` | `dev` or `prod`. In `dev`, a `GROQ_API_KEY` in `.env` is used as a fallback when `X-Groq-Api-Key` isn't sent. In `prod`, the header is required. |
| `DATABASE_URL` | Supabase Postgres connection string. Required for every route except `/healthz`. |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins. Include the Vercel URL in prod. |
| `GROQ_API_KEY` | Optional dev fallback only. Never populate in prod. |

### Supabase provisioning

1. Create a project at <https://supabase.com>. Any region is fine;
   `us-east-1` pairs well with Cloud Run `us-central1`.
2. Project Settings → Database → **Connection string** → copy the
   **Session pooler** URI (port 5432 — not the pgBouncer transaction-mode
   URL on 6543; asyncpg prepared statements need session mode). Paste
   into `.env` as `DATABASE_URL`.

   > **Pooler host gotcha.** New Supabase projects (Postgres 17+) use
   > `aws-1-<region>.pooler.supabase.com`, not the older
   > `aws-0-<region>.pooler.supabase.com`. Using the wrong one surfaces
   > as `asyncpg.exceptions.InternalServerError: Tenant or user not
   > found`. Copy the string directly from the dashboard rather than
   > hand-assembling it.
3. Apply the schema (no `psql` required — uses asyncpg):
   ```bash
   uv run python scripts/apply_schema.py
   ```
   Expected output ends with `ok.` and lists the five tables.
4. `psql` alternative (if you already have libpq installed):
   ```bash
   psql -f app/sql/schema.sql "$DATABASE_URL"
   ```

### Run the dev server

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Port 8000 matches the frontend default (`NEXT_PUBLIC_API_BASE_URL`).
The Dockerfile binds 8080 for Cloud Run; `$PORT` is env-driven so both
work. `/healthz` is up immediately; other routes need `DATABASE_URL`.

## Tests

```bash
uv run pytest -q
```

The suite uses an in-memory `_FakeRepo` (see `tests/conftest.py`), so no
Postgres is required. The Groq SDK is monkeypatched per test. To run an
integration test against a real Supabase branch, point `DATABASE_URL` at
it and add tests using the real `SessionRepository` — the current suite
deliberately does not touch the DB.

## Endpoints (summary)

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `{ ok, db }` — lightweight liveness + DB ping. |
| POST | `/transcribe` | multipart webm -> transcript segment. Server appends to session. |
| POST | `/suggestions` | exactly 3 suggestions from the last N chars of transcript. |
| POST | `/chat` | non-streaming chat answer. |
| POST | `/chat-stream` | SSE (`start`/`token`/`done`/`error`), 15s ping. |
| GET | `/export` | full session bundle as JSON. |

All endpoints that call Groq require `X-Groq-Api-Key`. Everything except
`/healthz` and the first request of a session also uses `X-Session-Id`;
if absent the server mints one and echoes it back on the response.

## Curl recipes

```bash
# Health
curl -s http://localhost:8000/healthz

# First call mints a session id; capture it for subsequent requests.
SID=$(curl -s -D - -X POST http://localhost:8000/transcribe \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -F "audio=@sample.webm;type=audio/webm" \
  -F "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o /dev/null \
  | awk '/^[Xx]-[Ss]ession-[Ii]d:/ {print $2}' | tr -d '\r')

echo "session: $SID"

# Live suggestions
curl -s -X POST http://localhost:8000/suggestions \
  -H "Content-Type: application/json" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -H "X-Session-Id: $SID" \
  -d '{}' | jq

# Chat (non-streaming)
curl -s -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -H "X-Session-Id: $SID" \
  -d '{"question":"What did they just say about revenue?"}' | jq

# Chat (SSE) — `-N` disables buffering.
curl -N -X POST http://localhost:8000/chat-stream \
  -H "Content-Type: application/json" \
  -H "X-Groq-Api-Key: $GROQ_API_KEY" \
  -H "X-Session-Id: $SID" \
  -d '{"question":"Summarize the conversation so far."}'

# Export
curl -s http://localhost:8000/export \
  -H "X-Session-Id: $SID" | jq
```

## Deploy

Runs on Cloud Run via the `gcp-deploy` skill. Service config lives in
`decision-009-gcp-cloud-run.md`. Dockerfile is in this directory.

## Key design notes (for the reviewer)

- **Prompts live server-side.** Default live-suggestion, expanded-answer,
  and chat prompts are in `app/prompts.py`, version-stamped, and echoed
  verbatim into `/export` per-batch so graders can trace what produced
  each suggestion.
- **Server owns the transcript.** `POST /transcribe` appends to the
  session. `POST /suggestions` slices the last N chars server-side.
  Request bodies stay small (decision-007).
- **`/chat-stream` is POST.** `EventSource` can't carry `X-Groq-Api-Key`;
  `fetch + ReadableStream` can (decision-003).
- **Streaming writes are O(1).** Tokens accumulate in memory during the
  SSE response; one INSERT on `done` (or `error`) — no per-token UPDATE.
- **Key is per-request.** `get_api_key` reads the header; `ENV=dev` adds
  a fallback from `.env` for curl convenience; `ENV=prod` does not.
