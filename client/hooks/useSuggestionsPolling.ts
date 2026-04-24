"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { chatCompletion } from "@/lib/groq";
import { buildSuggestionsMessages } from "@/lib/prompts";
import { parseSuggestionsJson } from "@/lib/suggestions";
import { makeId } from "@/lib/ids";
import { SEGMENT_CHARS } from "@/lib/defaults";
import { useSession } from "@/lib/sessionStore";
import type { Suggestion, SuggestionBatch } from "@/types/session";

/**
 * Polls Groq once per cycle to produce 3 fresh suggestions. The ~30s
 * countdown ticks once per second; when it hits 0, refresh + reset. Also
 * exposes a manual refresh. Pauses while there is no transcript yet or no
 * API key.
 */
export function useSuggestionsPolling() {
  const { state, dispatch } = useSession();
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  // Keep the countdown tick from closing over stale `canRefresh`.
  const canRefreshRef = useRef(false);

  const canRefresh =
    state.hydrated &&
    !!state.apiKey.trim() &&
    state.transcript.length > 0;
  canRefreshRef.current = canRefresh;

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!state.apiKey.trim()) return;
    if (state.transcript.length === 0) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const transcript = state.transcript.map((t) => t.text).join("\n");
      const previousBatchPreviews =
        state.batches[0]?.suggestions.map((s) => s.preview) ?? [];
      const windowChars =
        state.settings.suggestionContextSegments * SEGMENT_CHARS;

      // One attempt + one retry on bad JSON.
      let parsed: ReturnType<typeof parseSuggestionsJson> | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
        try {
          const raw = await chatCompletion({
            apiKey: state.apiKey,
            messages: buildSuggestionsMessages({
              systemPrompt: state.settings.liveSuggestionPrompt,
              transcript,
              windowChars,
              previousBatchPreviews,
              retry: attempt === 1,
            }),
            temperature: 0.5,
            maxTokens: 500,
            responseFormatJson: true,
          });
          parsed = parseSuggestionsJson(raw);
        } catch (err) {
          lastErr = err;
        }
      }
      if (parsed === null) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      }

      const suggestions: Suggestion[] = parsed.map((s) => ({
        id: makeId("sug"),
        type: s.type,
        preview: s.preview,
        rationale: s.rationale,
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
  }, [
    state.apiKey,
    state.transcript,
    state.batches,
    state.settings.liveSuggestionPrompt,
    state.settings.suggestionContextSegments,
    dispatch,
  ]);

  // 1Hz countdown tick while recording.
  useEffect(() => {
    if (!state.isRecording) return;
    const iv = setInterval(() => {
      if (!canRefreshRef.current) return;
      dispatch({ type: "tickCountdown" });
    }, 1000);
    return () => clearInterval(iv);
  }, [state.isRecording, dispatch]);

  // Drive the auto-refresh from its own interval rather than syncing with
  // the per-second countdown tick (avoids off-by-one firing).
  useEffect(() => {
    if (!state.isRecording) return;
    const iv = setInterval(() => {
      if (canRefreshRef.current) void refresh();
    }, 30_000);
    return () => clearInterval(iv);
  }, [state.isRecording, refresh]);

  return { loading, canRefresh, refresh };
}
