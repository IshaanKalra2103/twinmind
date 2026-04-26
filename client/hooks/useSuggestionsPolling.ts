"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatCompletion } from "@/lib/groq";
import { buildSuggestionsMessages } from "@/lib/prompts";
import { parseSuggestionsJson } from "@/lib/suggestions";
import { makeId } from "@/lib/ids";
import { SEGMENT_CHARS } from "@/lib/defaults";
import { useSession } from "@/lib/sessionStore";
import type { SessionState, Suggestion, SuggestionBatch } from "@/types/session";

/**
 * Polls Groq once per cycle to produce 3 fresh suggestions. The ~30s
 * countdown ticks once per second; when it hits 0, refresh + reset. Also
 * exposes a manual refresh. Pauses while there is no transcript yet or no
 * API key.
 *
 * `refresh` is a stable callback — it reads state via a ref so adding a
 * batch (which mutates `state.batches`) doesn't recreate the callback or
 * tear down the auto-refresh interval.
 */
export function useSuggestionsPolling() {
  const { state, dispatch } = useSession();
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  // Mirror state in a ref so `refresh` can read the latest values without
  // being recreated on every state change.
  const stateRef = useRef<SessionState>(state);
  stateRef.current = state;

  const canRefresh =
    state.hydrated &&
    !!state.apiKey.trim() &&
    state.transcript.length > 0;
  const canRefreshRef = useRef(canRefresh);
  canRefreshRef.current = canRefresh;

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    const s = stateRef.current;
    if (!s.apiKey.trim()) return;
    if (s.transcript.length === 0) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const transcript = s.transcript.map((t) => t.text).join("\n");
      const previousBatchPreviews =
        s.batches[0]?.suggestions.map((x) => x.preview) ?? [];
      const windowChars =
        s.settings.suggestionContextSegments * SEGMENT_CHARS;

      // One attempt + one retry on bad JSON.
      let parsed: ReturnType<typeof parseSuggestionsJson> | null = null;
      let lastErr: unknown = null;
      let lastRaw: string | null = null;
      for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
        try {
          const raw = await chatCompletion({
            apiKey: s.apiKey,
            messages: buildSuggestionsMessages({
              systemPrompt: s.settings.liveSuggestionPrompt,
              transcript,
              windowChars,
              previousBatchPreviews,
              meetingContext: s.settings.meetingContext,
              retry: attempt === 1,
            }),
            temperature: 0.4,
            // Headroom: gpt-oss-120b's internal reasoning tokens count
            // against this. Even with reasoning_effort="low", give the
            // visible JSON ~1000 tokens of room.
            maxTokens: 1500,
            responseFormatJson: true,
            // Structured short JSON — we don't want deep CoT here, just
            // valid output. Keeps the visible budget from being starved.
            reasoningEffort: "low",
          });
          lastRaw = raw;
          parsed = parseSuggestionsJson(raw);
        } catch (err) {
          lastErr = err;
          // Surface the raw model output to the browser console so a parse
          // failure is debuggable without enabling network capture.
          if (lastRaw !== null) {
            // eslint-disable-next-line no-console
            console.error(
              "[suggestions] parse failed (attempt %d): %s\nraw: %s",
              attempt + 1,
              err instanceof Error ? err.message : String(err),
              lastRaw
            );
          }
        }
      }
      if (parsed === null) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      }

      const suggestions: Suggestion[] = parsed.map((x) => ({
        id: makeId("sug"),
        type: x.type,
        preview: x.preview,
        rationale: x.rationale,
        fresh: true,
      }));
      const batch: SuggestionBatch = {
        id: makeId("batch"),
        createdAt: new Date().toISOString(),
        suggestions,
      };
      dispatch({ type: "addBatch", batch });
      dispatch({ type: "setError", error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "setError", error: `Suggestions failed: ${msg}` });
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      dispatch({ type: "resetCountdown", seconds: 30 });
    }
  }, [dispatch]);

  // 1Hz countdown tick while recording.
  useEffect(() => {
    if (!state.isRecording) return;
    const iv = setInterval(() => {
      if (!canRefreshRef.current) return;
      dispatch({ type: "tickCountdown" });
    }, 1000);
    return () => clearInterval(iv);
  }, [state.isRecording, dispatch]);

  // Drive the auto-refresh from its own interval. With a stable `refresh`,
  // this interval only re-installs when the recording flag flips.
  useEffect(() => {
    if (!state.isRecording) return;
    const iv = setInterval(() => {
      if (canRefreshRef.current) void refresh();
    }, 30_000);
    return () => clearInterval(iv);
  }, [state.isRecording, refresh]);

  return { loading, canRefresh, refresh };
}
