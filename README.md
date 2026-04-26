# TwinMind — Live Suggestions

Listens to your mic, transcribes in 30-second chunks, surfaces three context-aware suggestion cards every refresh. Click a card to get a detailed answer in the chat panel, or just type a question. One chat per session. No login. Nothing persists across reloads.

- **Live:** https://twinmind-suggestions.vercel.app — paste your Groq API key in Settings on first load.
- **Repo:** https://github.com/IshaanKalra2103/twinmind
- **How this got built (long form):** [`JOURNEY.md`](./JOURNEY.md) — the over-architected first pass, the rip-out, the prompt fixes, the deploy.
- **Provenance archive (full local agent journal):** https://drive.google.com/drive/folders/1tjYUl9wn49lzzgrl5Vepj-gf1_4DhY5X?usp=sharing

## Layout

Three columns, modeled after the reference prototype.

```
┌───────────────────┬──────────────────────────┬───────────────────┐
│   Transcript      │   Live Suggestions       │   Chat            │
│   • appends every │   • exactly 3 cards      │   • click a card  │
│     ~30s          │     per refresh          │     → answer      │
│   • auto-scroll   │   • newest on top        │   • or type       │
│   • mic toggle    │   • ~30s auto-refresh    │   • streams fast  │
└───────────────────┴──────────────────────────┴───────────────────┘
```

Top right: **Settings** (Groq key, prompts, context windows, optional meeting context) and **Export** (full session as JSON).

## Run it

Node 20+ and a Groq key.

```bash
cd client
npm install
npm run dev    # http://localhost:3000
```

Click the gear, paste your key, click the mic. No backend to start.

## Stack and why

Next.js 16 + TypeScript + CSS Modules. Groq Whisper Large V3 for transcription. Groq GPT-OSS 120B for suggestions and chat. The browser calls `api.groq.com/openai/v1/*` directly with the user's pasted key. No backend.

A few specific calls worth flagging:

- **CSS Modules over Tailwind.** The reference prototype ships its own CSS variables. Porting them is cleaner than re-skinning with utility classes.
- **MediaRecorder, stop and restart every 30 seconds.** Each chunk is a complete WebM that Whisper accepts as-is. Slicing mid-stream produces fragments without proper headers and Whisper rejects them.
- **Groq direct from the browser.** Their `/openai/v1/*` endpoints return permissive CORS. The user's key is in localStorage either way; a proxy doesn't add security.
- **React state only.** Brief says no persistence across reloads. State lives in a reducer; reload starts fresh. That's the whole state model.
- **Vercel.** Static Next.js bundle. `vercel deploy` takes 30 seconds. Cloud Run for the same bundle is cold-start tax with no upside.

## Prompts

Defaults are in [`client/lib/defaults.ts`](client/lib/defaults.ts). All three (live suggestions, expanded-on-click, chat) are editable in Settings, plus an optional `meetingContext` slot ("sales discovery call with a fintech prospect", "interviewing a senior PM") that gets injected verbatim into the suggestion prompt. The `meetingContext` field is the cheapest quality lever in the app — one extra textarea, visibly sharper cards.

What the suggestion prompt actually does:

1. **Type mix.** Five card types: `question`, `talking_point`, `answer`, `fact_check`, `clarifying_info`. Rule: at least two types unless context demands otherwise (someone literally just asked a question → `answer` can dominate).
2. **Self-contained previews.** 140-char cap. Cards have to deliver value without a click. Click-through is a bonus, not the main surface.
3. **Hard grounding.** Every `rationale` ends with a verbatim ≤12-word transcript quote in backticks. No quote, no card. Kills the generic-meeting-advice failure mode (`"propose a round-table"`, `"do a temperature check"`).
4. **Thin-transcript fallback.** Under ~15 substantive words → three "waiting" cards instead of inventing content.
5. **Strict JSON.** `response_format: { type: "json_object" }` and a parser that throws on any deviation from the schema. One retry on bad JSON.

For `gpt-oss-120b` specifically, suggestions also pass `reasoning_effort: "low"` and `max_tokens: 1500`. It's a reasoning-native model: internal CoT tokens count against `max_tokens`, and default `medium` effort starves the visible JSON. Chat (expanded answers and free-typed questions) keeps full reasoning depth — those benefit from it.

Context windows in Settings are kept in *segments* rather than chars. One segment ≈ one 30s Whisper chunk. Defaults: 12 segments (~6 minutes) for live suggestions, 40 segments (~20 minutes) for chat and expanded answers.

The expanded-answer and chat prompts share one rule: lead with the answer. No preambles, no "great question." The expanded prompt frames the user as someone "in a live conversation who'll glance back in 10 seconds" — that framing produces tighter output than asking for brevity directly.

## Tradeoffs

- **No backend.** Brief says no login, no persistence, don't over-engineer. A proxy adds latency and nothing else here.
- **No Chrome extension.** Brief is a web app.
- **Strictly 3 suggestions.** The parser throws on the wrong count. Rare hard-fails surface visibly instead of degrading silently with two cards or four.
- **Key in localStorage.** Fine for a no-login demo. In-memory-only is a one-line change if it ever matters.
- **`clarifying_info` as a fifth card type** even though the prototype only colors four — the brief lists clarifying info explicitly as a kind of suggestion to surface.

## Repo

```
client/
  app/                    page shell + global layout
  components/             TopBar, MicButton, TranscriptPanel,
                          SuggestionsPanel, SuggestionCard, ChatPanel,
                          ChatMessage, SettingsModal, ExportButton, …
  hooks/                  useMediaRecorder, useSuggestionsPolling,
                          useChatStream
  lib/                    groq, prompts, suggestions (parser),
                          transcribeFilter (Whisper denylist), sse,
                          export, defaults, sessionStore
  test/                   Vitest, 32 tests
  types/                  shared TS types
```

## Tests + build

```bash
cd client
npm test           # vitest run, 32 tests
npm run typecheck  # tsc --noEmit
npm run build      # next build
```

## Deploy

Standard Next.js on Vercel. No build-time env vars. The user's Groq key is pasted into Settings at runtime.

## If Groq revokes browser CORS

Rebuild a thin proxy from `602e5bb^` — about 150 lines that forward the `Authorization` header to Groq. Until that day the proxy isn't worth maintaining.

---

## Journey, briefly

[`JOURNEY.md`](./JOURNEY.md) has the long version with debugging traces and the full unlearn / re-learn list. Short version below.

The first pass had a FastAPI backend on Cloud Run with Supabase Postgres. Over a few revisions every responsibility of that backend collapsed: the session store was gone (brief says no persistence), key custody was pointless (the user pastes the key into the browser), transcript ownership was pointless (the server was just echoing chunks back into React state). I verified Groq's CORS with `curl`, deleted `server/` in full, and rebuilt the real work as five client modules in `lib/`. That's `decision-010`.

A separate review pass after the rip-out found four issues, all on the rubric:

- `useSuggestionsPolling.refresh` had `state.batches` in its dep array, so every successful batch recreated the callback and tore down the 30-second `setInterval`. Fixed with a `stateRef` pattern; `refresh` now depends only on `dispatch` and the interval installs once per recording session.
- First suggestion was waiting a full polling cycle (~60s from pressing record). Now fires immediately when the first transcript chunk lands. Halves time-to-first-suggestion, which is one of the two latency numbers the brief explicitly grades.
- Optional `meetingContext` field added to Settings. Cheapest single quality lever in the build.
- I added a `reasoning` chain-of-thought field to the suggestion JSON schema. Standard trick on `llama-3.x`; broke `gpt-oss-120b`. It's a reasoning-native model and its internal CoT tokens count against `max_tokens`. The model burned the entire 600-token budget on internal thinking before emitting any visible JSON. Fix in three lines: removed the JSON field (redundant on a reasoning-native model anyway), added `reasoning_effort: "low"` for suggestions, bumped `max_tokens` to 1500.

The lesson I'd actually flag from this build: *signal-driven architecture is still over-engineering if the product doesn't need it.* The role description mentions GCP; the assignment doesn't require it. A backend that exists to forward tokens to Groq isn't infrastructure, it's a forwarding shim with extra steps. Same logic applied at deploy time — Cloud Run for a static bundle is cold-start tax with no upside.

About 40% of the actual effort here went into prompts: the type-mix rule, the grounding-by-quote requirement, the thin-transcript fallback, the JSON schema, the `meetingContext` slot, the `reasoning_effort` fix. That's where the rubric lives, and the brief is unambiguous about where to spend.
