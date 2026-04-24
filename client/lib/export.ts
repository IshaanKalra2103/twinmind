/**
 * Build the exportable session bundle from local React state.
 * Shape mirrors what the grading brief asks for: transcript + every
 * suggestion batch + full chat with timestamps and the prompts used.
 */

import { SEGMENT_CHARS } from "./defaults";
import type { SessionState, Settings } from "@/types/session";

export interface ExportBundle {
  exported_at: string;
  settings: Settings & {
    suggestion_context_chars: number;
    expanded_context_chars: number;
  };
  transcript: Array<{
    id: string;
    text: string;
    started_at: string;
    received_at: string;
  }>;
  suggestion_batches: Array<{
    id: string;
    created_at: string;
    suggestions: Array<{
      id: string;
      type: string;
      preview: string;
      rationale: string | null;
      clicked: boolean;
    }>;
  }>;
  chat: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    triggered_by_suggestion_id: string | null;
    error: string | null;
  }>;
}

export function buildExport(state: SessionState): ExportBundle {
  return {
    exported_at: new Date().toISOString(),
    settings: {
      ...state.settings,
      suggestion_context_chars:
        state.settings.suggestionContextSegments * SEGMENT_CHARS,
      expanded_context_chars:
        state.settings.expandedContextSegments * SEGMENT_CHARS,
    },
    transcript: state.transcript.map((t) => ({
      id: t.id,
      text: t.text,
      started_at: t.startedAt,
      received_at: t.receivedAt,
    })),
    // Reverse so the oldest batch is first (export reads top-to-bottom like
    // a timeline; the UI order is newest-first for display).
    suggestion_batches: [...state.batches].reverse().map((b) => ({
      id: b.id,
      created_at: b.createdAt,
      suggestions: b.suggestions.map((s) => ({
        id: s.id,
        type: s.type,
        preview: s.preview,
        rationale: s.rationale ?? null,
        clicked: !!s.clicked,
      })),
    })),
    chat: state.chat.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
      triggered_by_suggestion_id: m.triggeredBySuggestionId ?? null,
      error: m.error ?? null,
    })),
  };
}
