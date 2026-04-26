# Journey — TwinMind Live Suggestions

A reviewer-facing record of how this submission came together: what we
built first, what we threw away, what we had to unlearn, and what
landed. The
[`README.md`](./README.md#the-journey-honest-version) carries a tight
version of the same story for someone scanning; this file is the long
form, with the moments where things broke and the reasoning trail
behind every reversal.

> **Provenance archive (full agent journal).** The local working
> notebook (`.agent/journal/` — wiki-linked decisions, sessions,
> open-questions, plans) is preserved on Google Drive for anyone who
> wants the raw trail rather than this distillation:
>
> **🔗 [Google Drive — `.agent/` archive](TODO_REPLACE_WITH_DRIVE_LINK)**
>
> The archive is a *working notebook*, not source. It uses
> Obsidian-style `[[wikilinks]]`; numbered decisions are immutable
> (each new decision records what it superseded). Link added after
> upload; if you're reading this and the placeholder is still here,
> ping the repo owner.

---

## The build, in chronological order

### Phase 1 — Over-architected on day one (2026-04-22 → 2026-04-23)

The first pass was a **monorepo with a real backend**:

- `client/` — Next.js 16 + TypeScript + CSS Modules (this part stayed).
- `server/` — FastAPI in Python, five endpoints (`/transcribe`,
  `/suggestions`, `/chat`, `/chat-stream`, `/export`).
- **Supabase Postgres** as the session store, accessed via `asyncpg`.
- A `scripts/apply_schema.py` for one-shot schema setup.
- Dockerfile + a `gcp-deploy` skill plan to run on **Google Cloud Run**
  with `min=0` scale-to-zero.
- 13 backend tests (pytest), 23 frontend tests (vitest), all green.
- Two parallel sub-agents had built backend + frontend in lockstep,
  with integration contracts reconciled across worktrees.

It worked. It deployed locally. It was wrong anyway.

**Why it was wrong.** The role posting talks about GCP / Cloud Run /
RESTful APIs, and I had read those signals into the assignment scope.
But the brief — line 49 of `Ask.md`, verbatim — was unambiguous:

> **Do not over-engineer.** We are not evaluating production-readiness
> at scale. We are evaluating whether you can prompt an AI to make it
> useful in real time, and whether the code is something we would want
> in our codebase.

And the rubric, in priority order, leads with **suggestion quality,
detailed-answer quality, prompt engineering**. None of those move with
a backend in front of them.

Two architectural decisions from this phase survived; the rest got
deleted. The full per-decision history (with each reversal recording
what it superseded and why) is in the Google Drive archive linked
above.

### Phase 2 — The rip-out (2026-04-24)

Working through the backend on a quieter day, the user noticed the
backend's responsibilities had quietly collapsed:

- **Session store** — already removed once persistence was dropped per
  the brief. The "Supabase layer" was an empty pass-through.
- **API key custody** — pointless. The brief explicitly says the user
  pastes their key into Settings, so the key has to be in the browser
  anyway. A proxy adds latency without adding security.
- **Transcript ownership** — the server had been appending each chunk
  to a server-side transcript object, then echoing it back into React
  state on the next response. Round-trip with no purpose.
- **`/healthz`** returned `{ok: true}` with nothing to check.

Every endpoint was a Bearer-token forwarder.

The user's framing, verbatim:

> Something made me realize that I too overengineer stuff, however
> what is needed is simple prompt engineering combined with good
> architectural frontend decisions.

That was the correct read. We:

1. **Verified Groq's `/openai/v1/*` browser-direct CORS** with
   `curl -sI -X OPTIONS …`. Both `/audio/transcriptions` and
   `/chat/completions` return `access-control-allow-origin: *`.
2. **Deleted `server/` in full** — FastAPI app, asyncpg pool, Supabase
   plumbing, Dockerfile, pytest suite, `uv.lock`. Gone.
3. Reconstituted the real work as **five focused client modules**:
   - `client/lib/groq.ts` — direct `fetch` to Groq.
   - `client/lib/prompts.ts` — `messages[]` assembly.
   - `client/lib/suggestions.ts` — JSON validator.
   - `client/lib/transcribeFilter.ts` — Whisper hallucination denylist.
   - `client/lib/export.ts` — JSON bundle of session state.
4. **Removed `sessionId` plumbing everywhere** — reducer, hooks,
   tests, types. A tab is a session; reload starts a new one.
5. Chat SSE now reads OpenAI-style frames (`data: {json}\n\ndata:
   [DONE]`) directly from Groq's stream. Non-streaming fallback in
   place for transient failures.
6. Vitest stayed green at 32 tests; `tsc --noEmit` clean; `next build`
   green.

Committed as `602e5bb` ("Rip out backend: browser calls Groq
directly"). If Groq ever revokes browser CORS, the proxy rebuilds from
`602e5bb^` in ~150 lines.

The lesson, written down:

> **Signal-driven architecture is still over-architecture if the
> product does not need it.** A backend earns its place when it hides
> a secret the browser shouldn't have, owns state the product must
> persist, or runs logic the user can't be trusted with — not when it
> mirrors a sentence from the job description. The interview is the
> right surface for "here's what a proxy would look like."

### Phase 3 — Post-audit: prompt + latency fixes (2026-04-25)

A fresh review of the post-rip-out client surfaced four real issues —
each cheap to fix, each on the rubric.

#### 3a. Polling interval was being torn down on every batch

`useSuggestionsPolling.refresh` had `state.batches`, `state.transcript`,
and `state.settings.*` in its `useCallback` dep array. ESLint-clean,
functionally fine. But every successful batch added to `state.batches`
recreated `refresh`, which caused the polling `useEffect`
(depending on `refresh`) to tear down and reinstall the 30-second
`setInterval`. In practice this didn't lose batches; the new interval
picked up the next tick. But it was unnecessary churn that could
double-fire on a slow render.

**Fix.** `stateRef` pattern — mirror state into a ref each render,
read everything via `stateRef.current`, depend only on `dispatch`.
Now `refresh` is stable; the auto-refresh interval installs once per
recording session.

#### 3b. First suggestion was waiting for the polling cycle

The polling hook fired on the 30-second boundary. With one 30-second
audio chunk required before any transcript existed, time-to-first-
suggestion was ~60s after pressing record.

**Fix.** When `onChunk` successfully appends the first non-hallucinated
transcript line, fire `polling.refresh()` immediately via a
ref-stored copy. Reset the "fired" flag whenever the mic restarts.
Time-to-first-suggestion drops from ~60s to ~30s — half. This is one
of the two latency numbers the brief explicitly grades.

#### 3c. Missing the `meetingContext` quality lever

The reference reading of the assignment called out an optional
"meeting context" textarea ("sales discovery call with a fintech
prospect", "PM interviewing a senior candidate") as the single
cheapest quality lever for the suggestion prompt — one extra textarea
in Settings, one extra `meeting_context:` block in the prompt builder,
visibly sharper cards.

**Fix.** Added it. Optional, default `""`, injected verbatim only when
non-empty.

#### 3d. The `reasoning` JSON field broke the model

This is the one that taught me something I won't forget. I'd added a
top-level `"reasoning"` field to the suggestion JSON schema — cheap
chain-of-thought the client discards. **A well-documented pattern for
non-reasoning models** like `llama-3.x` where the model has no internal
CoT and benefits from think-out-loud scratch space.

On `gpt-oss-120b` (the model the brief mandates), the live deploy
produced this:

```
Suggestions failed: Chat completion failed — 400
{"error":{"message":"Failed to generate JSON. Please adjust your
prompt. See 'failed_generation' for more details.",
"type":"invalid_request_error","code":"json_validate_failed",
"failed_generation":"max completion tokens reached before generating
a valid document"}}
```

I removed the JSON `reasoning` field. Tried again:

```
"failed_generation": ""
```

Empty. The model produced nothing visible at all.

**The diagnosis took longer than it should have.** `gpt-oss-120b` is
a **reasoning-native** model. Its internal chain-of-thought tokens
count against `max_completion_tokens`. With `maxTokens: 600`, the
model burned the entire budget on internal thinking before emitting
any visible JSON. Even after removing the redundant JSON `reasoning`
field, internal reasoning alone exceeded the budget for non-trivial
transcripts.

**The fix, three lines:**

1. Removed the explicit `"reasoning"` JSON field. *(Reverted.)*
2. Added `reasoning_effort: "low"` to the suggestions call. Groq
   exposes this knob for `gpt-oss-*` — `low` cuts internal CoT
   dramatically. Suggestions are short, structured, time-sensitive;
   they don't benefit from deep reasoning.
3. Bumped `maxTokens` 600 → 1500 as headroom.

Plumbed `reasoningEffort` through `lib/groq.ts` for both
`chatCompletion` and `chatCompletionStream`. Suggestions opt in;
chat keeps default depth so expanded answers still get full reasoning
budget.

The lesson:

> **Prompt-engineering tricks that work on one model family can be
> footguns on another.** Read the model's reasoning behaviour before
> importing patterns. For reasoning-native models: visible-output
> budget needs explicit headroom or `reasoning_effort` control; the
> "fake CoT in JSON" trick is redundant at best, broken at worst.

#### 3e. (The localStorage gotcha)

Saved settings in `localStorage` survive deploys. The settings reducer
hydrates with `{...DEFAULT_SETTINGS, ...parsed}` — saved values win
over new defaults. So when we shipped a fixed prompt, any test session
that had saved the broken prompt earlier still saw the broken version
until the user clicked **Reset** in Settings. This isn't a code change,
it's a humans-need-to-know note — surfaced in the README's debugging
section.

### Phase 4 — Deploy (2026-04-26)

The reflexive "does the role mention GCP, then deploy on GCP"
question came up here, and the answer was *the same trap that
produced the rip-out.* This is a static Next.js client; there is
nothing GCP-specific to deploy. Cloud Run for a static bundle is
cold-start tax with no upside; bucket-and-CDN is hours of IAM for
what `vercel deploy` does in 30 seconds. **The role-signal play is
the interview answer**, not the deploy target. Decision: **Vercel.**

Process:

1. CLI was at 44.6.3 — too old; Vercel's API endpoint requires
   ≥47.2.2. Upgraded to 52.0.0.
2. `vercel --yes` from `client/` linked the project as
   `ishaankalra2103s-projects/client` and went straight to a `READY`
   production build (40s, 3 routes prerendered as static).
3. **Subdomain hunt** on `*.vercel.app` (first-come-first-served
   globally):
   - `twinmind.vercel.app` — taken
   - `twinmind-live.vercel.app` — taken
   - `twinmind-copilot.vercel.app` — taken
   - **`twinmind-suggestions.vercel.app` — claimed.**
   - `twinmind-ik.vercel.app` — also claimed as fallback.
4. **Vercel Authentication** was on by default (Hobby tier ships with
   it enabled). Every URL returned `HTTP 401` until the project owner
   toggled it off in Project Settings → Deployment Protection. CLI
   cannot do this; dashboard-only. Surfaced this to the user.

Final live URL: **https://twinmind-suggestions.vercel.app**.

---

## Things we had to unlearn

A short list. Each entry is something I had to actively *unlearn*
during the build — not a thing I never knew, but a habit or default
that turned out wrong for this assignment.

1. **"Match the team's stack" is the wrong heuristic for a
   time-boxed assessment.** The brief is the rubric. Build for the
   brief; demonstrate range in the interview.
2. **A backend earns its keep through real responsibility, not
   architectural decoration.** When every endpoint is a token
   forwarder, the layer is moral hazard.
3. **Cheap-CoT-in-JSON is model-family-specific.** What works on
   `llama-3.x` breaks `gpt-oss-120b`. Read the model's reasoning
   behaviour before importing patterns.
4. **Dependency-array compliance is the floor, not the goal.** If a
   callback's identity is observed downstream, every dep that mutates
   becomes a churn source. `stateRef` is the right tool for "latest
   values, stable identity."
5. **Polling loops should let the first tick be event-driven** when
   an event is meaningful. Wall-clock-only first-tick adds latency
   for free.
6. **Per-user `localStorage` is a hidden production-rollout boundary.**
   When prompt-engineering changes ship, *test devices may still hold
   the old prompt*. Either Reset → Save in Settings, or clear
   localStorage, before claiming a fix works.
7. **Deploy URLs are not necessarily public URLs.** Platform auth
   defaults shift; verify the deployed URL works in an incognito
   window before submitting it.

## Things we kept that the spec didn't strictly require

A few choices we'd defend in a review:

- **A 32-test Vitest suite.** The brief doesn't ask; the role
  description says "write tests without being asked." Reducer, parser,
  SSE, panels, hallucination filter — all covered.
- **Editable prompts + `meetingContext` in Settings.** Brief asks for
  editable prompts; the meeting-context slot is the cheapest single
  quality lever in the whole app.
- **First-chunk suggestion trigger.** Brief grades reload-to-first-
  suggestion latency explicitly; this halves it.
- **CSS Modules over Tailwind.** The reference prototype ships its
  own palette; porting CSS variables is cleaner than re-theming.
- **One streaming + one non-streaming chat path.** Brief says "Chat
  streams first token fast" but the fallback is what makes it
  trustworthy under network flake.

## Where the time actually went

| Effort share | On |
|---|---|
| ~10% | Audio capture + Whisper chunking (`MediaRecorder` stop/restart cycle) |
| ~15% | UI layout port from the reference prototype |
| **~40%** | **Prompt engineering — type-mix rule, hard grounding with quotes, thin-transcript fallback, anti-repetition memory, JSON schema** |
| ~10% | Chat streaming over OpenAI-SSE + non-streaming fallback |
| ~10% | Building (then deleting) the FastAPI / Supabase / Cloud Run backend |
| ~10% | Tests, settings UI, export bundle, polish |
| ~5% | Diagnosing the `gpt-oss-120b` reasoning-token starvation |

The 40% on prompts is on purpose. It's the top-priority axis on the
rubric, and the brief is unambiguous about where to spend.

## What we'd do with another week

- **Rolling transcript summariser** so chat answers in multi-hour
  sessions don't pass the full transcript every turn.
- **Voice-activity detection** to skip Whisper calls during silence
  (cheap cost win).
- **Suggestion pinning** — let the user mark a card so it survives
  the next refresh.
- **Per-meeting profiles** stored in `localStorage` — pre-baked
  `meetingContext` + prompt bundles for "sales discovery", "1:1",
  "interview", etc.
- **A second transcription pass on each chunk for diarisation** —
  Whisper Large V3 on Groq doesn't expose it natively, but a focused
  second call could.

---

## Pointers

- **README:** [`README.md`](./README.md) — setup, stack, prompt
  strategy, tradeoffs.
- **Code:** all under [`client/`](./client/). The five modules in
  `client/lib/` (`groq`, `prompts`, `suggestions`,
  `transcribeFilter`, `export`) carry the work the deleted backend
  used to do.
- **Live demo:** https://twinmind-suggestions.vercel.app — paste your
  Groq API key in Settings on first load.
- **Local agent journal archive:** Google Drive link at the top of
  this file. The full per-decision history with supersedes-chains
  lives there for anyone who wants the raw trail.
