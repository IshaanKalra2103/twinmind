import type { SuggestionType } from "./api";

/** Client-side session model. The whole thing lives in React state — no
 *  persistence across reloads, per brief. */

export interface TranscriptLine {
  id: string;
  text: string;
  startedAt: string;
  receivedAt: string;
  /** For fade-in animation; cleared after render. */
  isNew?: boolean;
}

export interface Suggestion {
  id: string;
  type: SuggestionType;
  preview: string;
  rationale?: string | null;
  /** true only for the current (latest) batch. */
  fresh: boolean;
  /** true once the user has clicked the card. */
  clicked?: boolean;
}

export interface SuggestionBatch {
  id: string;
  createdAt: string;
  suggestions: Suggestion[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Label chip for user messages that originated from a suggestion click. */
  suggestionLabel?: string | null;
  triggeredBySuggestionId?: string | null;
  /** Only set while assistant tokens are arriving. */
  streaming?: boolean;
  /** Populated on stream error or fallback failure. */
  error?: string | null;
}

/**
 * Settings live in localStorage under `twinmind.settings`. Context windows are
 * stored in *segments* (number of 30s transcript chunks); converted to chars
 * at call time with SEGMENT_CHARS.
 */
export interface Settings {
  liveSuggestionPrompt: string;
  expandedAnswerPrompt: string;
  chatPrompt: string;
  suggestionContextSegments: number;
  expandedContextSegments: number;
}

export interface SessionState {
  apiKey: string;
  settings: Settings;
  /** Persisted-slices have hydrated from localStorage. */
  hydrated: boolean;
  isRecording: boolean;
  transcript: TranscriptLine[];
  batches: SuggestionBatch[]; // newest first
  chat: ChatMessage[];
  /** Countdown to the next suggestions auto-refresh, in seconds. */
  countdown: number;
  /** Last unexpected error surfaced via a banner. */
  lastError: string | null;
}

export type SessionAction =
  | { type: "hydrate"; apiKey: string; settings: Settings }
  | { type: "setApiKey"; apiKey: string }
  | { type: "setSettings"; settings: Settings }
  | { type: "setRecording"; recording: boolean }
  | { type: "appendTranscript"; line: TranscriptLine }
  | { type: "addBatch"; batch: SuggestionBatch }
  | { type: "markSuggestionClicked"; suggestionId: string }
  | { type: "tickCountdown" }
  | { type: "resetCountdown"; seconds?: number }
  | { type: "addChatMessage"; message: ChatMessage }
  | { type: "appendToAssistant"; messageId: string; delta: string }
  | {
      type: "finishAssistant";
      messageId: string;
      error?: string | null;
    }
  | { type: "setError"; error: string | null };
