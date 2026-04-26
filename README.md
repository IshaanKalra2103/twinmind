# TwinMind — Live Suggestions

A web app that listens to live mic audio, transcribes it in ~30s chunks, and
continuously surfaces **exactly 3** suggestion cards derived from the recent
transcript. Clicking a card opens a longer-form answer in a right-hand chat
panel; users can also type questions directly. One continuous chat per
session. No login, no cross-reload persistence.

- **Live demo:** https://twinmind-suggestions.vercel.app — paste your Groq API key in Settings on first load.
- **Stack:** Next.js 16 + TypeScript + CSS Modules. Groq (Whisper Large V3 + GPT-OSS 120B) called directly from the browser. No backend.
- **Journey & lessons:** see [`JOURNEY.md`](./JOURNEY.md) for the long-form chronological story (over-architected → ripped out → prompt + latency fixes → deploy), the unlearn / re-learn list, and a Google Drive link to the full local agent-journal archive.

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
that the brief explicitly says shouldn't persist. See the
**[Journey & mistakes](#the-journey-honest-version)** section below
for the full rationale, including the `gpt-oss-120b` reasoning-token
trap and the polling-interval bug we caught and fixed in the same
post-audit pass.

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

---

## The journey (honest version)

The brief explicitly says **"do not over-engineer"** and **"we are not
evaluating production-readiness at scale."** Reading that on day one and
*actually believing it* turn out to be different things. Here's what we
shipped, what we threw away, and why — kept in the README on purpose so
the reviewer can see the trajectory, not just the final code.

### Mistake 1 — building infrastructure to match the job description, not the brief

The first architecture had a **FastAPI backend in Python**, **Supabase
Postgres** for session state, **Cloud Run** for hosting, and a
**streaming chat-stream endpoint** that proxied SSE from Groq. There was
a `/healthz`, an asyncpg connection pool, an apply-schema script, the
works. The reasoning was: *the role posting mentions GCP / Cloud Run /
RESTful APIs, so a real backend is signal.*

That logic was wrong. The role description tells you what someone wants
to hire for; it does not tell you what *this assignment* is graded on.
The brief was unambiguous about both — top-3 axes are **suggestion
quality, answer quality, prompt engineering** — and "do not
over-engineer" was a literal sentence in the spec. None of those axes
move with a backend in front of them.

### Mistake 2 — keeping the backend after it had nothing left to do

After a couple of revisions the backend's responsibilities had collapsed:

- **Session store:** removed (the brief says no cross-reload persistence,
  so there's nothing to store).
- **API-key custody:** the brief explicitly says the user pastes their
  own key into Settings — so the key has to be in the browser anyway.
  Forwarding it through a proxy adds latency without adding security.
- **Transcript ownership:** initially the server appended each chunk to
  a server-side transcript; once persistence was dropped, the server was
  just echoing the chunk back into React state.

Every endpoint had become a key-forwarding shim. We verified Groq's
`/openai/v1/*` returned `access-control-allow-origin: *` for both chat
and transcription with `curl -sI -X OPTIONS …`, then **deleted the
entire `server/` tree** (`decision-010-client-only-no-backend`). The
two commits that did the rip-out are still in the history; if Groq
revokes browser CORS one day, rebuilding a thin proxy from
`602e5bb^` is a ~150-line job.

The lesson, written down so future-me can find it:

> **Signal-driven architecture is still over-architecture if the
> product does not need it.** A backend earns its place when it hides
> a secret the browser shouldn't have, owns state the product must
> persist, or runs logic the user can't be trusted with — not when it
> mirrors a sentence from the job description. The interview is the
> right surface for "here's what a proxy would look like."

### Mistake 3 — adding an explicit `reasoning` JSON field to a reasoning-native model

Late in the build I added a top-level `"reasoning"` field to the
suggestion JSON schema (cheap chain-of-thought the client discards) — a
trick that's well-documented for non-reasoning models like
`llama-3.x`. On `gpt-oss-120b` it broke immediately:

```
Suggestions failed: 400 — json_validate_failed
"max completion tokens reached before generating a valid document"
```

`gpt-oss-120b` is **reasoning-native** — its internal CoT tokens count
against `max_completion_tokens`. Asking for a JSON `reasoning` field on
top of that is double-CoT; the model burned the entire 600-token budget
on internal thinking and never emitted any visible JSON.

The fix was three lines:

1. **Removed the explicit `reasoning` JSON field.** It was redundant for
   a reasoning-native model.
2. **Added `reasoning_effort: "low"`** to the suggestions call. Groq
   exposes this knob for `gpt-oss-*`; `low` cuts internal CoT
   dramatically. Suggestions are short, structured, time-sensitive —
   they don't need deep reasoning.
3. **Bumped `max_tokens` 600 → 1500** as a safety margin. Chat
   (expanded answers) keeps the default — those *do* benefit from
   deeper reasoning, so they get the full budget.

The takeaway: *a prompt-engineering trick that's correct on one
model family can be a footgun on another*. Read the model's reasoning
behaviour before importing patterns.

### Mistake 4 — interval recreated on every batch

`useSuggestionsPolling.refresh` originally closed over `state.batches`,
so every successful batch caused the callback to be recreated, which
caused the 30s `setInterval` inside its `useEffect` to be torn down
and reinstalled. Worked fine in practice (the new interval picked up
the next tick) but the dependency was wrong and could have caused
double-fires on a slow render.

Fix: mirror state into a `stateRef` and make `refresh` depend only on
`dispatch`. The auto-refresh interval now installs once per recording
session.

### What we kept that the spec didn't strictly require

A few choices we'd defend rather than apologise for:

- **A 32-test Vitest suite.** The brief doesn't ask for tests, but the
  role description says "write tests without being asked." Reducer,
  parser, SSE, panels, hallucination filter — all covered. This is a
  hiring signal, not over-engineering.
- **Editable prompts + an optional `meetingContext` field in Settings.**
  The brief asks for editable prompts; the meeting-context slot is one
  extra textarea but it's the cheapest single quality lever in the
  whole app — a one-line description ("sales discovery call with a
  fintech prospect") visibly sharpens cards.
- **First-chunk suggestion trigger.** Without it, the first batch lands
  ~60s after pressing record (one chunk + one polling tick). With it,
  the first batch lands immediately after the first chunk (~30s). This
  is one of the two latency numbers the brief explicitly grades.
- **CSS Modules over Tailwind.** The reference prototype ships its own
  palette; porting CSS variables is cleaner than re-theming.

### Where the time actually went

Roughly, in retrospect:

| Hours (of effort, not chronological time) | On |
|---|---|
| ~10% | Audio capture + Whisper chunking (`MediaRecorder` stop/restart cycle) |
| ~15% | UI layout port from the prototype |
| **~40%** | **Prompt engineering — suggestion type-mix rule, hard grounding with quotes, thin-transcript fallback, anti-repetition memory, JSON schema** |
| ~10% | Chat streaming over OpenAI-SSE + non-streaming fallback |
| ~10% | Building (then deleting) the FastAPI / Supabase / Cloud Run backend |
| ~10% | Tests, settings UI, export bundle, polish |
| ~5% | Diagnosing the `gpt-oss-120b` reasoning-token starvation |

The 40% on prompts is on purpose. It's the top-priority axis on the
rubric, and the brief is explicit: *"Spend your time on prompts,
context, model choice, latency, and clean code — not UI exploration."*

### What we'd do with another week

- **Rolling transcript summariser** so chat answers in multi-hour
  sessions don't pass the full transcript every turn.
- **Voice-activity detection** to skip Whisper calls during silence.
- **Suggestion pinning** — let the user mark a card so it survives the
  next refresh.
- **Per-meeting profiles** stored in localStorage — pre-baked
  `meetingContext` + prompt bundles for "sales discovery", "1:1",
  "interview", etc.

The full per-decision history (numbered, immutable, with each decision
recording what it superseded and why) is kept locally under
`.agent/journal/agent-journal/` — that directory is in `.gitignore`
because it's a working notebook, not part of the service. The
load-bearing decisions are summarised inline above.
