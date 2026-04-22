"use client";

import { useCallback, useRef, useState } from "react";
import { chat, chatStream } from "@/lib/api";
import { makeId } from "@/lib/ids";
import { SEGMENT_CHARS } from "@/lib/defaults";
import { useSession } from "@/lib/sessionStore";
import { TAG_LABEL } from "@/components/SuggestionCard/SuggestionCard";
import type { ChatMessage, Suggestion } from "@/types/session";

export interface SendArgs {
  question: string;
  suggestion?: Suggestion | null;
}

export function useChatStream() {
  const { state, dispatch } = useSession();
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async ({ question, suggestion }: SendArgs) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      if (busy) return;
      if (!state.apiKey.trim()) {
        dispatch({
          type: "setError",
          error: "Paste your Groq API key in Settings first.",
        });
        return;
      }

      const isExpanded = !!suggestion;
      const userMsg: ChatMessage = {
        id: makeId("msg"),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
        suggestionLabel: suggestion ? TAG_LABEL[suggestion.type] : null,
        triggeredBySuggestionId: suggestion?.id ?? null,
      };
      const assistantId = makeId("msg");
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        triggeredBySuggestionId: suggestion?.id ?? null,
        streaming: true,
      };

      dispatch({ type: "addChatMessage", message: userMsg });
      dispatch({ type: "addChatMessage", message: assistantMsg });
      if (suggestion)
        dispatch({
          type: "markSuggestionClicked",
          suggestionId: suggestion.id,
        });

      const ctx = { apiKey: state.apiKey, sessionId: state.sessionId };
      const body = {
        question: trimmed,
        suggestion_id: suggestion?.id ?? null,
        prompt_override: isExpanded
          ? state.settings.expandedAnswerPrompt
          : state.settings.chatPrompt,
        context_window_chars:
          state.settings.expandedContextSegments * SEGMENT_CHARS,
        mode: (isExpanded ? "expanded" : "chat") as "expanded" | "chat",
      };

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      let receivedAnyToken = false;
      let streamErrored = false;

      try {
        for await (const ev of chatStream({ ctx, body, signal: ctrl.signal })) {
          if (ev.type === "start") {
            if (ev.sessionId && ev.sessionId !== state.sessionId)
              dispatch({ type: "setSessionId", sessionId: ev.sessionId });
          } else if (ev.type === "token") {
            receivedAnyToken = true;
            dispatch({
              type: "appendToAssistant",
              messageId: assistantId,
              delta: ev.data.delta,
            });
          } else if (ev.type === "done") {
            dispatch({ type: "finishAssistant", messageId: assistantId });
          } else if (ev.type === "error") {
            streamErrored = true;
            dispatch({
              type: "finishAssistant",
              messageId: assistantId,
              error: ev.data.message,
            });
          }
        }
        if (!receivedAnyToken && !streamErrored) {
          // Stream closed without any content — treat as failure, fall back.
          throw new Error("empty stream");
        }
      } catch (err) {
        // Fall back to /chat on any streaming failure.
        if (ctrl.signal.aborted) return;
        const streamErr = err instanceof Error ? err.message : String(err);
        try {
          const { data, sessionId } = await chat({ ctx, body });
          if (sessionId && sessionId !== state.sessionId)
            dispatch({ type: "setSessionId", sessionId });
          dispatch({
            type: "appendToAssistant",
            messageId: assistantId,
            delta: data.message.content,
          });
          dispatch({ type: "finishAssistant", messageId: assistantId });
        } catch (fallbackErr) {
          const msg =
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr);
          dispatch({
            type: "finishAssistant",
            messageId: assistantId,
            error: `Stream failed (${streamErr}); fallback failed: ${msg}`,
          });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, dispatch, state.apiKey, state.sessionId, state.settings]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, busy };
}
