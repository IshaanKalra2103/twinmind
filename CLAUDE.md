# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

TwinMind — **Live Suggestions** take-home assignment. A web app that listens to live mic audio, transcribes it in ~30s chunks, and continuously surfaces exactly **3 suggestion cards** derived from the recent transcript. Clicking a card opens a longer-form answer in a right-hand chat panel; users can also type questions directly. One continuous chat per session, no login, no persistence across reloads.

Full brief: `.agent/journal/Ask.md`. Do not re-derive product requirements — read that file.

## Architecture

**Client-only.** Single Next.js 16 workspace. The browser calls Groq directly (`https://api.groq.com/openai/v1/*`) using the user-pasted API key. There is no backend, no database, no proxy. Session state lives in React state; chat history is passed as `messages[]` on every chat request. See `decision-010-client-only-no-backend.md` for the rationale.

## Repo layout

One workspace:

- `client/` — Next.js 16 App Router + TypeScript (CSS Modules, no Tailwind).

Plan, decisions, and sessions live under `.agent/journal/` as an Obsidian-style wiki; entry point is `.agent/journal/AgentJournal.md`. The coordinating agent logs every plan + major decision there — see the feedback memory.

## Build to the reference prototype, don't redesign

`.agent/references/twinmind.html` is the **authoritative UI/UX spec** — a single-file HTML/CSS/JS prototype. The 3-column layout (transcript | suggestions | chat), colors, card styles, mic button states, and interactions come from it. Port it into Next.js components; do not spend cycles on UI exploration. Per the brief: "Spend your time on prompts, context, model choice, latency, and clean code — not UI exploration."

## Non-negotiable technical constraints (from `Ask.md`)

These are assignment rules, not preferences:

- **Groq for everything.** Whisper Large V3 for transcription. **GPT-OSS 120B** for suggestions and chat. Same model for every candidate — the eval is prompt quality, not model choice.
- **Never hardcode or ship a Groq API key.** There must be a Settings screen where the user pastes their own key. The key lives in `localStorage` only.
- **Settings screen must expose editable prompts and context windows:** live-suggestion prompt, detailed-answer-on-click prompt, chat prompt, context window for live suggestions, context window for expanded answers. Hardcode sensible defaults; let the user override.
- **Exactly 3 suggestions per refresh.** Newest batch renders at the top; older batches stay visible below (stale styling). Mix of types — question to ask, talking point, answer to a question just asked, fact-check, clarifying info. Choosing the right mix for the moment is the core of what's being evaluated.
- **~30s cadence** for both transcript chunk append and suggestions refresh. Manual refresh button updates transcript then suggestions.
- **Chat streams first token fast.** Use streaming chat completions with a non-streaming fallback.
- **Export** produces transcript + every suggestion batch + full chat history with timestamps (JSON). This is how submissions are evaluated — keep it complete and well-structured.

## Where the pipeline lives

- `client/lib/groq.ts` — direct HTTP calls to Groq. `transcribeAudio`, `chatCompletion`, `chatCompletionStream` (yields token deltas).
- `client/lib/prompts.ts` — assembles `messages[]` (system + user) for suggestions / expanded-answer / chat from the editable system prompts plus current transcript / chat history / previous batch previews.
- `client/lib/suggestions.ts` — parse + validate the 3-suggestion JSON (hard-fails on wrong count or unknown type).
- `client/lib/transcribeFilter.ts` — Whisper phantom denylist (filters "thanks for watching", `[Music]`, short foreign-language drifts).
- `client/lib/defaults.ts` — editable default prompts + context window sizes.
- `client/lib/sessionStore.tsx` — reducer + context for transcript, batches, chat, settings, apiKey. No `sessionId` — there is none.
- `client/lib/export.ts` — serializes React state to the export JSON bundle.
- `client/hooks/useMediaRecorder.ts` — 30s stop/restart cycle (decision-004).
- `client/hooks/useSuggestionsPolling.ts` — drives the ~30s refresh + manual refresh; previous-batch previews come from `state.batches[0]` for anti-repetition.
- `client/hooks/useChatStream.ts` — streams tokens from Groq; on empty/error stream, falls back to the non-streaming endpoint.

## Evaluation priorities (so you know what to optimize)

In order, from the brief:
1. **Quality of live suggestions** — useful, well-timed, varied by context.
2. **Quality of detailed chat answers.**
3. **Prompt engineering** — what context, how much, how structured, when to surface what.
4. **Full-stack engineering** — frontend polish, audio capture/chunking, API structure, error handling.
5. **Code quality** — clean, readable, no dead code, useful README.
6. **Latency** — reload-to-first-suggestions and chat-send-to-first-token are both measured.

When making tradeoffs, prefer what moves (1)–(3) over (4)–(6). Do not over-engineer — we already removed the backend for this reason.

## Agent coordination convention

When running as the coordinating agent, log every plan and major decision to the wiki under `.agent/journal/` — entry point `AgentJournal.md`. Decisions are numbered and immutable (supersede with a new number, don't rewrite). Sessions go under `agent-journal/sessions/YYYY-MM-DD-<topic>.md`. See the saved feedback memory for the full convention.

## Commands

### Frontend (`client/`)

- `cd client && npm install` — install deps.
- `cd client && npm run dev` — dev server on `http://localhost:3000`.
- `cd client && npm run typecheck` — `tsc --noEmit`.
- `cd client && npm test` — vitest run (32 tests as of the rip-out).
- `cd client && npm run build` — production build.

### Env

No `.env` is required — the user pastes their Groq key into Settings at runtime. `client/.env.local` is not used.

### Deploy

- **Frontend → Vercel.** Standard Next.js deploy. Nothing else to deploy.
