# TwinMind — Live Suggestions

A web app that listens to live mic audio, transcribes it in ~30s chunks, and
continuously surfaces **exactly 3** suggestion cards derived from the recent
transcript. Clicking a card opens a longer-form answer in a right-hand chat
panel; users can also type questions directly. One continuous chat per
session. No login, no cross-reload persistence.

- **Live demo:** _TBD — will be deployed to Vercel._
- **Stack:** Next.js 16 + TypeScript + CSS Modules. Groq (Whisper Large V3 + GPT-OSS 120B) called directly from the browser. No backend.

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
full chat, with timestamps).

## Quick start (~30 seconds)

You need Node 20+ and a Groq API key (paste it in Settings — never commit it).

```bash
cd client
npm install
npm run dev     # http://localhost:3000
# Click the gear → paste your Groq API key → click the mic.
```

That's it. There is no backend to run. The browser calls Groq directly.

## Architecture (in one paragraph)

**Client-only.** The user pastes their Groq key into Settings; the browser
calls `api.groq.com/openai/v1/*` directly using that key. Session state —
transcript, suggestion batches, chat — lives in React state and disappears
on reload, which is exactly what the brief asks for. Chat multi-turn
continuity is achieved by passing the last few chat turns as `messages[]`
on every request; Groq's streaming chat completions endpoint returns
standard OpenAI SSE which the app reads via `fetch + ReadableStream`.

Earlier revisions had a FastAPI proxy (Cloud Run + Supabase). After an
audit, every responsibility of that backend turned out to be either
(a) forwarding the key the browser already has, or (b) holding state
that the brief explicitly says shouldn't persist. See
[`decision-010-client-only-no-backend.md`](.agent/journal/agent-journal/decisions/decision-010-client-only-no-backend.md)
for the full rationale.

## Stack choices and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js 16 + TypeScript + CSS Modules** | Matches the reference prototype without re-theming. App Router keeps client state simple. No Tailwind — the prototype ships its own palette and the CSS-var port is cleaner. |
| Audio capture | **MediaRecorder, stop/restart every ~30s** | Produces standalone, valid WebM chunks that Whisper accepts without re-wrapping. Avoids the gotcha where mid-stream slicing yields unplayable blobs. |
| LLM calls | **Direct browser → Groq** | Groq's `/openai/v1/*` endpoints return permissive CORS (`access-control-allow-origin: *`). The user's key is in localStorage; a proxy would not add security. |
| LLM | **Groq — Whisper Large V3 + GPT-OSS 120B** | Brief requires this exact pair. Groq's latency budget is what makes 30s refresh + fast first-token chat feasible. |
| State | **React state only** | Brief: no login, no persistence across reloads. React state is the session. Tab reload = fresh session. |
| Chat streaming | **`fetch + ReadableStream` over OpenAI-SSE** | Groq streams `data: {json}\n\ndata: [DONE]` per OpenAI convention. No `EventSource`, no custom framing. Fallback to non-streaming `chat/completions` on any stream error. |
| Deploy | **Vercel** | Static Next.js build. Nothing else to deploy. |

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

**3. Strict JSON, no prose.** `{"suggestions":[…]}`. The parser validates
`len == 3` and parses `type` against a fixed enum — any free-form output
or miscounted list fails fast. The suggestions call uses Groq's
`response_format: { type: "json_object" }` to bias the model toward
clean JSON, and on parse failure we retry once with a stricter prefix.

### Context windows

Two separate knobs, both editable in Settings:

- **Live suggestions:** 12 segments (~6 minutes of transcript). Enough
  context for the model to see topic drift without diluting the recency
  signal that makes suggestions feel "in the moment."
- **Expanded / chat answers:** 40 segments (~20 minutes). Longer-form
  answers benefit from the full arc of the conversation, not just the
  last minute.

A "segment" is one ~30s Whisper chunk — it stays human-readable in
Settings ("last 12 segments") and converts to a char budget before the
Groq call.

### Expanded-answer and chat prompts

Both prompts are tuned to a single rule: **lead with the answer**. No
preambles, no "Great question!", no apologies. The expanded prompt
reminds the model the user is "in a live conversation and will glance
back in 10 seconds" — that framing consistently produces tighter output
than asking for brevity explicitly.

## Tradeoffs

Honest calls I'd defend in a review:

- **No backend.** The brief says no login, no cross-reload persistence,
  and "don't over-engineer." A proxy would only add latency and a deploy
  target. The job description mentions GCP/Cloud Run — I'd defend that
  backend chops in the interview ("here's what a proxy layer would look
  like") rather than shipping one that exists to forward headers.
- **No Chrome extension.** The brief is a web app. Going MV3 would burn
  days the brief doesn't grade.
- **Exactly 3, strictly.** The parser throws if the model returns ≠3
  rather than silently truncating. Fewer ambiguous edge cases; the rare
  hard-fail surfaces as a visible error instead of degraded output.
- **`clarifying_info` exists as a 5th card type** even though the
  reference prototype only colours 4. The brief explicitly lists
  clarifying info as one of the kinds of suggestion we should produce,
  so it gets its own category in the enum + prompt.
- **Key in `localStorage`.** Acceptable for a no-login demo; documented
  in Settings. Swapping to in-memory-only is a one-line change if
  someone's reviewing on a shared machine.

## Repo layout

```
twinmind/
└── client/                  # Next.js 16 App Router (TypeScript, CSS Modules)
    ├── app/                 # page shell + global layout
    ├── components/          # TopBar, MicButton, TranscriptPanel,
    │                        # SuggestionsPanel, SuggestionCard, ChatPanel,
    │                        # ChatMessage, SettingsModal, ExportButton, …
    ├── hooks/               # useMediaRecorder, useSuggestionsPolling,
    │                        # useChatStream
    ├── lib/                 # groq (direct HTTP), prompts, suggestions
    │                        # (JSON parser), transcribeFilter (Whisper
    │                        # phantom denylist), sse (parser), export,
    │                        # defaults (prompts + knobs), sessionStore
    ├── test/                # Vitest (32 tests)
    └── types/               # shared TS types
```

## Tests

- `cd client && npm test` — 32 Vitest tests covering the SSE parser,
  reducer, panels, JSON validator, and hallucination filter.
- `cd client && npm run typecheck` — `tsc --noEmit`.
- `cd client && npm run build` — production Next.js build.

## Deploy

Vercel, standard Next.js deploy. No env vars required at build time —
the user's Groq key is pasted at runtime into Settings and stored in
`localStorage`.

## If CORS ever breaks

If Groq one day stops allowing browser origins, the fix is a ~150-line
Cloud Run service that forwards the `Authorization` header to Groq
unchanged. The git history before this README has a working reference.
