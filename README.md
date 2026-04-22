# TwinMind — Live Suggestions

A web app that listens to live mic audio, transcribes it in ~30s chunks, and
continuously surfaces **exactly 3** suggestion cards derived from the recent
transcript. Clicking a card opens a longer-form answer in a right-hand chat
panel; users can also type questions directly. One continuous chat per
session. No login, no cross-reload persistence.

- **Live demo:** _TBD — will be deployed to Vercel (frontend) + GCP Cloud Run (backend)._
- **Stack:** Next.js 16 + TypeScript + CSS Modules · FastAPI (Python 3.12, uv) + asyncpg · Supabase Postgres · Groq (Whisper Large V3 + GPT-OSS 120B).

---

## What it looks like

Three columns, mirroring the reference prototype:

```
┌───────────────────┬──────────────────────────┬───────────────────┐
│   Transcript      │   Live Suggestions       │   Chat            │
│   (left)          │   (middle)               │   (right)         │
│                   │                          │                   │
│  • appends every  │  • exactly 3 cards per   │  • click a card → │
│    ~30s           │    refresh (~30s)        │    detailed answer│
│  • auto-scroll    │  • new batch on top,     │  • or type        │
│  • Start/stop mic │    older batches stale   │    anything       │
│                   │  • 5 card types, mixed   │  • streams first  │
│                   │    by the prompt         │    token fast     │
└───────────────────┴──────────────────────────┴───────────────────┘
```

Top-right actions: **Settings** (paste your Groq key + edit prompts/context
windows) and **Export** (JSON bundle of transcript + every suggestion batch +
full chat, with timestamps and the exact prompt used for each batch).

## Quick start (local, ~2 minutes)

You need: Python 3.12, Node 20+, [uv](https://github.com/astral-sh/uv), and a
Groq API key (paste it in Settings — never commit it).

```bash
# 1) Provision a Supabase project
#    https://supabase.com → new project → copy the session-pooler
#    connection string (port 5432).

# 2) Backend
cd server
cp .env.example .env
# edit .env: set DATABASE_URL to the session-pooler string
uv sync
uv run python scripts/apply_schema.py     # applies app/sql/schema.sql
uv run uvicorn app.main:app --reload --port 8000

# 3) Frontend (new terminal)
cd client
npm install
npm run dev                                # http://localhost:3000
# Click the gear → paste your Groq API key → click the mic.
```

`/healthz` should return `{"ok":true,"db":"up"}`. Full backend recipes
(curl, SSE) are in [`server/README.md`](server/README.md).

> **Supabase pooler gotcha.** New (Postgres 17+) projects use
> `aws-1-<region>.pooler.supabase.com`, not the older `aws-0-*`. Copy the
> connection string directly from the dashboard — assembling it by hand
> will surface as `Tenant or user not found`.

## Stack choices and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 16 + TypeScript + CSS Modules** | Matches the reference prototype without re-theming; App Router lets us keep client state simple and SSR the shell. No Tailwind — the prototype ships its own palette and the CSS-var port is cleaner. |
| Audio capture | **MediaRecorder, stop/restart every ~30s** | Produces standalone, valid WebM chunks that Whisper can accept without re-wrapping. Avoids the gotcha where mid-stream slicing yields unplayable blobs. |
| Backend | **FastAPI + uv + asyncpg** | Async end-to-end (Groq is latency-bound on I/O); `uv` gives a reproducible lockfile with 10x faster installs; asyncpg talks to Supabase/Cloud SQL without ORM overhead. |
| LLM | **Groq — Whisper Large V3 + GPT-OSS 120B** | Brief requires this exact pair. Groq's latency budget is what makes 30s refresh + fast first-token chat feasible. |
| State | **Supabase Postgres (session pooler)** | Matches the hosted-Postgres path in one env-var swap to Cloud SQL. Schema is plain SQL (`server/app/sql/schema.sql`), no Supabase client libs — the service is portable Postgres. |
| Deploy | Frontend → **Vercel**. Backend → **GCP Cloud Run** (scale-to-zero). | Cold starts are acceptable for a demo; $0 idle. Secrets in Secret Manager. |
| Chat streaming | **SSE over POST** (not GET) | `EventSource` is GET-only and can't send `X-Groq-Api-Key` as a header — we'd have to stuff it into the URL, where it shows up in logs. `fetch + ReadableStream` keeps the key in a header and the body JSON. |

## Prompt strategy

Live suggestions are the primary evaluation axis. The defaults in
[`client/lib/defaults.ts`](client/lib/defaults.ts) (editable in Settings) are
tuned around three ideas:

**1. Type-mix is the whole game.** The prompt enumerates 5 card types
and demands the three cards cover at least 2 types unless a direct
question was just asked — then `answer` may dominate. This is where the
"right thing at the right time" judgement lives. The prompt intentionally
gives short definitions of each type rather than examples, so the model
generalises across meeting kinds (standup, sales call, debugging) instead
of mimicking a canned pattern.

**2. Preview must be self-contained.** `preview` is capped at 140 chars
and must "deliver value without a click." Click-through is a bonus
surface, not the main one — a reviewer glancing at the middle column
should already be getting something. `rationale` (≤100 chars) quotes
short phrases from the transcript when possible, so the grader can trace
*why* a card appeared.

**3. Strict JSON, no prose.** `{"suggestions":[…]}`. The server validates
`len == 3` and parses `type` against a Postgres `CHECK` constraint — any
free-form output or miscounted list fails fast and surfaces as a clean
error rather than garbage cards.

### Context windows

Two separate knobs, both editable in Settings:

- **Live suggestions:** 12 segments (~6 minutes of transcript). Enough
  context for the model to see topic drift without diluting the recency
  signal that makes suggestions feel "in the moment."
- **Expanded / chat answers:** 40 segments (~20 minutes). Longer-form
  answers benefit from the full arc of the conversation, not just the
  last minute.

A "segment" is the ~30s Whisper chunk the server actually stores, not
raw chars — it stays human-readable in Settings ("last 12 segments")
and converts to `context_window_chars` server-side.

### Expanded-answer and chat prompts

Both prompts are tuned to a single rule: **lead with the answer**. No
preambles, no "Great question!", no apologies. The expanded prompt
reminds the model the user is "in a live conversation and will glance
back in 10 seconds" — that framing consistently produces tighter output
than asking for brevity explicitly.

## Architecture & notable decisions

- **Server mints session IDs** (`X-Session-Id` echoed on first response,
  client sends it on all subsequent calls). No login, but sessions are
  UUIDs — not guessable.
- **API key is per-request header** (`X-Groq-Api-Key`), never persisted
  server-side. Default prompts stay server-side so they're not shipped in
  the JS bundle. Omitted only on `/export` (no upstream call).
- **`/transcribe` appends the transcript server-side.** The client
  uploads the 30s audio chunk and a `started_at` timestamp; it does not
  re-send transcript state on each subsequent call. Keeps request
  bodies small and the DB the single source of truth.
- **Chat streaming writes are O(1) per message.** Tokens accumulate in
  memory during the SSE response; one INSERT on `done` (or `error`).
  No per-token UPDATE storms.
- **Schema is plain SQL.** `server/app/sql/schema.sql` + a small
  `scripts/apply_schema.py` (asyncpg-based, no `psql` / libpq install
  needed). Idempotent; re-runnable safely.

Endpoint contracts are authoritative in
`.agent/journal/agent-journal/endpoints/` (kept local) and summarised in
`server/README.md`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/transcribe` | multipart audio chunk → transcript segment (Whisper) |
| POST | `/suggestions` | transcript window → exactly 3 suggestions (JSON) |
| POST | `/chat-stream` | SSE chat: `event: start\|token\|done\|error`, 15s ping |
| POST | `/chat` | non-streaming chat fallback |
| GET | `/export` | full session bundle (transcript + batches + chat, timestamped) |
| GET | `/healthz` | `{ ok, db }` liveness + DB ping |

## Tradeoffs

Honest calls I'd defend in a review:

- **Supabase, not Cloud SQL.** The role signals GCP-native Postgres, but
  for a single-submission demo Supabase's session pooler is zero-config
  and the schema + asyncpg code transfer to Cloud SQL by swapping
  `DATABASE_URL`. No code changes.
- **No Chrome extension.** The brief is a web app. Deploying the
  FastAPI service to Cloud Run (Secret Manager for `DATABASE_URL`,
  least-privilege IAM, scale-to-zero) is enough platform signal without
  spending days on an MV3 port that isn't graded.
- **Cloud Run `min=0`.** Cold-start on first request of an idle session
  (~1–2s). Cheaper than keeping one always-warm instance, and a demo
  meeting starts with clicking "Settings" first — by the time the mic
  is armed, the backend is warm. Reversible in one `gcloud` command if
  the cold-start shows up in grading.
- **Exactly 3, strictly.** The server raises if the model returns ≠3
  rather than silently truncating. Fewer ambiguous edge cases; the rare
  hard-fail surfaces as a visible error instead of degraded output.
- **`clarifying_info` exists as a 5th card type** even though the
  reference prototype only colours 4. The brief explicitly lists
  clarifying info as one of the kinds of suggestion we should produce,
  so it gets its own category in schema + prompt. Visual styling for
  it is conservative (distinct, not alarming).
- **Key in `localStorage`.** Acceptable for a no-login demo; documented
  in Settings. Swapping to in-memory-only is a one-line change if
  someone's reviewing the take-home on a shared machine.

## Repo layout

```
twinmind/
├── client/                  # Next.js 16 App Router (TypeScript, CSS Modules)
│   ├── app/                 # page shell + global layout
│   ├── components/          # TopBar, MicButton, TranscriptPanel,
│   │                        # SuggestionsPanel, SuggestionCard, ChatPanel,
│   │                        # ChatMessage, SettingsModal, ExportButton, …
│   ├── hooks/               # useMediaRecorder, useSuggestionsPolling,
│   │                        # useChatStream
│   ├── lib/                 # api client, sse parser, defaults (prompts),
│   │                        # session/apiKey store
│   ├── test/                # Vitest
│   └── types/               # shared TS types
└── server/                  # FastAPI + uv
    ├── app/
    │   ├── routers/         # transcribe, suggestions, chat, export
    │   ├── prompts.py       # server-side prompt templates + version stamp
    │   ├── groq_client.py   # per-request Groq client (no global state)
    │   ├── session.py       # asyncpg repository
    │   ├── db.py            # pool lifespan wiring
    │   └── sql/schema.sql   # authoritative DDL
    ├── scripts/apply_schema.py
    ├── tests/               # pytest (13 tests, in-memory repo, Groq monkeypatched)
    └── Dockerfile           # Cloud Run target
```

## Tests

- **Backend:** `cd server && uv run pytest -q` — 13 tests, runs offline.
  No DB required for the suite (tests use an in-memory fake); the Groq
  SDK is monkeypatched per test.
- **Frontend:** `cd client && npm test` — 23 Vitest tests covering the
  SSE parser, state reducer, and panel components.
- **Typecheck:** `cd client && npm run typecheck` (runs `tsc --noEmit`).
- **Lint:** `cd server && uv run ruff check --fix`.

## Deploy

- **Frontend → Vercel.** Default Next.js deploy. Set
  `NEXT_PUBLIC_API_BASE_URL` to the Cloud Run URL.
- **Backend → GCP Cloud Run** (`us-central1`, `1Gi` / `1 vCPU`, `min=0`,
  `max=10`). `DATABASE_URL` in Secret Manager, mounted via
  `--set-secrets`. Add the Vercel origin to `ALLOWED_ORIGINS`.

Backend details and curl recipes: [`server/README.md`](server/README.md).
