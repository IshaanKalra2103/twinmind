/**
 * Wire-shape types for the FastAPI backend. These mirror the contracts in
 * .agent/journal/agent-journal/endpoints/* verbatim. Do not drift.
 */

export type SuggestionType =
  | "question"
  | "talking_point"
  | "answer"
  | "fact_check"
  | "clarifying_info";

// POST /transcribe
export interface TranscribeSegment {
  id: string;
  text: string;
  started_at: string;
  received_at: string;
}
export interface TranscribeResponse {
  session_id: string;
  segment: TranscribeSegment;
}

// POST /suggestions
export interface SuggestionsRequest {
  prompt_override?: string | null;
  context_window_chars?: number;
  include_previous_batch_hint?: boolean;
}
export interface SuggestionItem {
  id: string;
  type: SuggestionType;
  preview: string;
  rationale: string;
}
export interface SuggestionBatchResponse {
  id: string;
  created_at: string;
  transcript_window_chars: number;
  suggestions: SuggestionItem[];
}
export interface SuggestionsResponse {
  session_id: string;
  batch: SuggestionBatchResponse;
}

// POST /chat-stream & POST /chat
export type ChatMode = "chat" | "expanded";
export interface ChatRequest {
  question: string;
  suggestion_id?: string | null;
  prompt_override?: string | null;
  context_window_chars?: number;
  mode?: ChatMode;
}
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
export interface ChatResponseMessage {
  id: string;
  role: "assistant";
  content: string;
  created_at: string;
  triggered_by_suggestion_id?: string | null;
}
export interface ChatResponse {
  session_id: string;
  message: ChatResponseMessage;
  usage?: ChatUsage;
}

// SSE event payloads (POST /chat-stream)
export interface SseStartData {
  message_id: string;
  created_at: string;
}
export interface SseTokenData {
  delta: string;
}
export interface SseDoneData {
  message_id: string;
  finish_reason: string;
  usage?: ChatUsage;
}
export interface SseErrorData {
  code: string;
  message: string;
}

// GET /export
export interface ExportResponse {
  session: { id: string; created_at: string; ended_at?: string };
  transcript: TranscribeSegment[];
  suggestion_batches: Array<{
    id: string;
    created_at: string;
    transcript_window_chars: number;
    transcript_window_used?: string;
    prompt_used?: string;
    suggestions: Array<SuggestionItem & { clicked?: boolean }>;
  }>;
  chat: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    triggered_by_suggestion_id?: string | null;
  }>;
  meta: Record<string, unknown>;
}
