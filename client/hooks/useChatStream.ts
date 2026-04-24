"use client";

import { useCallback, useRef, useState } from "react";
import { chatCompletion, chatCompletionStream } from "@/lib/groq";
import { buildChatMessages, buildExpandedMessages } from "@/lib/prompts";
import { makeId } from "@/lib/ids";
import { SEGMENT_CHARS } from "@/lib/defaults";
import { useSession } from "@/lib/sessionStore";
import { TAG_LABEL } from "@/components/SuggestionCard/SuggestionCard";
import type { ChatMessage, Suggestion } from "@/types/session";
import type { ChatMessage as GroqMessage } from "@/lib/groq";

// Kept small — user and assistant alternate, so 6 turns ≈ 3 exchanges.
const CHAT_HISTORY_TURNS = 6;

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

      const transcript = state.transcript.map((t) => t.text).join("\n");
      const windowChars =
        state.settings.expandedContextSegments * SEGMENT_CHARS;

      let messages: GroqMessage[];
      if (isExpanded && suggestion) {
        messages = buildExpandedMessages({
          systemPrompt: state.settings.expandedAnswerPrompt,
          transcript,
          windowChars,
          suggestion,
          userQuestion: trimmed,
        });
      } else {
        messages = buildChatMessages({
          systemPrompt: state.settings.chatPrompt,
          transcript,
          windowChars,
          chatHistory: state.chat,
          historyTurns: CHAT_HISTORY_TURNS,
          userQuestion: trimmed,
        });
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusy(true);
      let receivedAny = false;
      let streamErr: Error | null = null;

      try {
        for await (const delta of chatCompletionStream({
          apiKey: state.apiKey,
          messages,
          temperature: isExpanded ? 0.3 : 0.5,
          signal: ctrl.signal,
        })) {
          receivedAny = true;
          dispatch({
            type: "appendToAssistant",
            messageId: assistantId,
            delta,
          });
        }
        if (!receivedAny) throw new Error("empty stream");
        dispatch({ type: "finishAssistant", messageId: assistantId });
      } catch (err) {
        if (ctrl.signal.aborted) {
          dispatch({ type: "finishAssistant", messageId: assistantId });
          return;
        }
        streamErr = err instanceof Error ? err : new Error(String(err));
        // Fall back to non-streaming chat completion.
        try {
          const content = await chatCompletion({
            apiKey: state.apiKey,
            messages,
            temperature: isExpanded ? 0.3 : 0.5,
          });
          dispatch({
            type: "appendToAssistant",
            messageId: assistantId,
            delta: content,
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
            error: `Stream failed (${streamErr.message}); fallback failed: ${msg}`,
          });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, dispatch, state.apiKey, state.transcript, state.chat, state.settings]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, busy };
}
