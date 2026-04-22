"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSuggestions } from "@/lib/api";
import { makeId } from "@/lib/ids";
import { SEGMENT_CHARS } from "@/lib/defaults";
import { useSession } from "@/lib/sessionStore";
import type { Suggestion, SuggestionBatch } from "@/types/session";

/**
 * Polls /suggestions once per cycle. Tick the visible countdown once per
 * second; when it hits 0, refresh + reset to 30. Also exposes a manual
 * refresh. Pauses while there is no transcript yet (409) or no API key.
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
      const { data, sessionId } = await getSuggestions({
        ctx: { apiKey: state.apiKey, sessionId: state.sessionId },
        body: {
          prompt_override: state.settings.liveSuggestionPrompt,
          context_window_chars:
            state.settings.suggestionContextSegments * SEGMENT_CHARS,
          include_previous_batch_hint: true,
        },
      });
      if (sessionId && sessionId !== state.sessionId) {
        dispatch({ type: "setSessionId", sessionId });
      }
      const suggestions: Suggestion[] = data.batch.suggestions.map((s) => ({
        id: s.id || makeId("sug"),
        type: s.type,
        preview: s.preview,
        rationale: s.rationale,
        fresh: true,
      }));
      const batch: SuggestionBatch = {
        id: data.batch.id || makeId("batch"),
        createdAt: data.batch.created_at || new Date().toISOString(),
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
    state.sessionId,
    state.transcript.length,
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

  // When the countdown hits 0 (value 30 is the freshly-reset state), fire.
  // `countdown === 1` this tick means next tick dispatches `tickCountdown`
  // which rolls to 30 via the reducer — so use `=== 30` resetting pattern:
  // easier to watch for when countdown just wrapped. Instead, drive refresh
  // from an effect that watches isRecording and uses its own timer.
  useEffect(() => {
    if (!state.isRecording) return;
    const iv = setInterval(() => {
      if (canRefreshRef.current) void refresh();
    }, 30_000);
    return () => clearInterval(iv);
  }, [state.isRecording, refresh]);

  return { loading, canRefresh, refresh };
}
