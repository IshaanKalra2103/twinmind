# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

TwinMind — **Live Suggestions** take-home assignment. A web app that listens to live mic audio, transcribes it in ~30s chunks, and continuously surfaces exactly **3 suggestion cards** derived from the recent transcript. Clicking a card opens a longer-form answer in a right-hand chat panel; users can also type questions directly. One continuous chat per session, no login, no persistence across reloads.

Full brief: `.agent/journal/Ask.md`. Do not re-derive product requirements — read that file.

## Repo layout

Monorepo, two workspaces:

- `client/` — Next.js 16 App Router + TypeScript (CSS Modules, no Tailwind).
- `server/` — FastAPI on Python 3.12 via **uv** (per `~/.claude/CLAUDE.md`). asyncpg → Supabase Postgres.

Plan, decisions, and sessions live under `.agent/journal/` as an Obsidian-style wiki; entry point is `.agent/journal/AgentJournal.md`. The coordinating agent logs every plan + major decision there — see the feedback memory.

## Build to the reference prototype, don't redesign

`.agent/references/twinmind.html` is the **authoritative UI/UX spec** — a single-file HTML/CSS/JS prototype. The 3-column layout (transcript | suggestions | chat), colors, card styles, mic button states, and interactions come from it. Port it into Next.js components; do not spend cycles on UI exploration. Per the brief: "Spend your time on prompts, context, model choice, latency, and clean code — not UI exploration."

## Non-negotiable technical constraints (from `Ask.md`)

These are assignment rules, not preferences:

- **Groq for everything.** Whisper Large V3 for transcription. **GPT-OSS 120B** for suggestions and chat. Same model for every candidate — the eval is prompt quality, not model choice.
- **Never hardcode or ship a Groq API key.** There must be a Settings screen where the user pastes their own key. The key lives client-side / in the user's session only.
- **Settings screen must expose editable prompts and context windows:** live-suggestion prompt, detailed-answer-on-click prompt, chat prompt, context window for live suggestions, context window for expanded answers. Hardcode sensible defaults; let the user override.
- **Exactly 3 suggestions per refresh.** Newest batch renders at the top; older batches stay visible below (stale styling). Mix of types — question to ask, talking point, answer to a question just asked, fact-check, clarifying info. Choosing the right mix for the moment is the core of what's being evaluated.
- **~30s cadence** for both transcript chunk append and suggestions refresh. Manual refresh button updates transcript then suggestions.
- **Chat streams first token fast.** Use SSE for `/chat-stream` with a non-SSE `/chat` fallback.
- **Export** produces transcript + every suggestion batch + full chat history with timestamps (JSON or plain text). This is how submissions are evaluated — keep it complete and well-structured.

## Backend endpoint contract (implemented)

Authoritative shapes in `.agent/journal/agent-journal/endpoints/*.md`.

- `POST /transcribe` — multipart audio chunk → transcript segment (Whisper Large V3).
- `POST /suggestions` — recent transcript → **exactly 3** suggestions, JSON-validated.
- `POST /chat-stream` — SSE (**POST** not GET — see `decision-003-chat-stream-post-not-get`); `event: start|token|done|error`.
- `POST /chat` — non-streaming fallback; same body as `/chat-stream`.
- `GET  /export` — full session bundle (transcript + all batches w/ prompt_used + chat, timestamped).
- `GET  /healthz` — `{"ok": true, "db": "up"|"down"}`.

Headers: `X-Groq-Api-Key` on every call except `/export` (user-provided; never stored server-side). `X-Session-Id` echoed by server on first response; client sends on every subsequent call.

Async end-to-end. Session state persists in Supabase Postgres via asyncpg (`decision-008-supabase-session-store`). Chat streaming writes to DB only on `done`/`error` (avoids per-token UPDATE storms).

## Evaluation priorities (so you know what to optimize)

In order, from the brief:
1. **Quality of live suggestions** — useful, well-timed, varied by context.
2. **Quality of detailed chat answers.**
3. **Prompt engineering** — what context, how much, how structured, when to surface what.
4. **Full-stack engineering** — frontend polish, audio capture/chunking, API structure, error handling.
5. **Code quality** — clean, readable, no dead code, useful README.
6. **Latency** — reload-to-first-suggestions and chat-send-to-first-token are both measured.

When making tradeoffs, prefer what moves (1)–(3) over (4)–(6). Do not over-engineer for scale — this is not a production-readiness eval.

## Agent coordination convention

When running as the coordinating agent, log every plan and major decision to the wiki under `.agent/journal/` — entry point `AgentJournal.md`. Decisions are numbered and immutable (supersede with a new number, don't rewrite). Sessions go under `agent-journal/sessions/YYYY-MM-DD-<topic>.md`. See the saved feedback memory for the full convention.

## Commands

### Backend (`server/`)

- `cd server && uv sync` — install deps (first time / after lockfile change).
- `cd server && uv run uvicorn app.main:app --reload --port 8000` — dev server (frontend expects port 8000).
- `cd server && uv run pytest -q` — tests (13 currently; pass without a live DB).
- `cd server && uv run ruff check --fix` — lint + autofix.

### Frontend (`client/`)

- `cd client && npm install` — install deps.
- `cd client && npm run dev` — dev server on `http://localhost:3000`.
- `cd client && npm run typecheck` — `tsc --noEmit`.
- `cd client && npm test` — vitest run.
- `cd client && npm run build` — production build (sanity check before deploy).

### Env

- `server/.env` (gitignored): `GROQ_API_KEY` optional dev fallback (production ignores it; always requires the header per `decision-002-api-key-per-request-header`); `DATABASE_URL` (Supabase session-pooler connection string — required); `ENV=dev|prod`; `ALLOWED_ORIGINS` (comma-separated).
- `client/.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` for dev; the Cloud Run URL in prod.

### Supabase setup (first time)

Create a project at supabase.com, copy the **session-pooler** connection string into `server/.env` as `DATABASE_URL`, then: `psql -f server/app/sql/schema.sql "$DATABASE_URL"`.

### Deploy

- **Backend → Cloud Run** via the `gcp-deploy` skill at `~/.claude/skills/gcp-deploy/`. Pre-answers per `decision-009-gcp-cloud-run`: region `us-central1`, service `twinmind-backend`, `1Gi`/`1 vCPU`, `min=0`/`max=10` (scale-to-zero), `DATABASE_URL` in Secret Manager.
- **Frontend → Vercel.** Standard Next.js deploy. Set `NEXT_PUBLIC_API_BASE_URL` to the Cloud Run URL. Remember to add the Vercel origin to the Cloud Run `ALLOWED_ORIGINS` env var.
