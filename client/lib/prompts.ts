/**
 * Prompt assembly. Given the editable system prompts from Settings plus the
 * live context (transcript slice, prior batch previews, chat history, etc.),
 * build the `messages[]` array to send to Groq.
 */

import type { ChatMessage as GroqMessage } from "./groq";
import type { ChatMessage, Suggestion } from "@/types/session";

const SUGGESTION_JSON_RETRY_PREFIX =
  "Your previous response was not valid JSON. " +
  "Emit ONLY a JSON object matching the schema. " +
  "No prose, no markdown, no code fences. Start with `{` and end with `}`.\n\n";

function tail(transcript: string, chars: number): string {
  return transcript.length > chars ? transcript.slice(-chars) : transcript;
}

// ───────────────────────── /suggestions ─────────────────────────

export interface SuggestionsPromptArgs {
  systemPrompt: string;
  transcript: string;
  windowChars: number;
  previousBatchPreviews: string[];
  /** Optional one-line description of the meeting; injected verbatim. */
  meetingContext?: string;
  retry?: boolean;
}

export function buildSuggestionsMessages({
  systemPrompt,
  transcript,
  windowChars,
  previousBatchPreviews,
  meetingContext,
  retry,
}: SuggestionsPromptArgs): GroqMessage[] {
  const system = retry ? SUGGESTION_JSON_RETRY_PREFIX + systemPrompt : systemPrompt;
  const window = tail(transcript, windowChars);
  const prev =
    previousBatchPreviews.length === 0
      ? "(none — this is the first batch)"
      : previousBatchPreviews.map((p) => `- ${p}`).join("\n");
  const ctx = meetingContext?.trim();
  const parts = [
    "transcript_window:",
    window,
    "---",
    "previous_batch_previews:",
    prev,
  ];
  if (ctx) parts.push("---", "meeting_context:", ctx);
  return [
    { role: "system", content: system },
    { role: "user", content: parts.join("\n") },
  ];
}

// ───────────────────────── /chat (expanded on click) ─────────────────────────

export interface ExpandedPromptArgs {
  systemPrompt: string;
  transcript: string;
  windowChars: number;
  suggestion: Suggestion;
  userQuestion?: string | null;
}

export function buildExpandedMessages({
  systemPrompt,
  transcript,
  windowChars,
  suggestion,
  userQuestion,
}: ExpandedPromptArgs): GroqMessage[] {
  const window = tail(transcript, windowChars);
  const sugBlock = [
    `type: ${suggestion.type}`,
    `preview: ${suggestion.preview}`,
    `rationale: ${suggestion.rationale ?? "(none)"}`,
  ].join("\n");
  const user = [
    "transcript_window:",
    window,
    "---",
    "suggestion:",
    sugBlock,
    "---",
    "user_question:",
    userQuestion && userQuestion.trim()
      ? userQuestion
      : "(none — user clicked the card)",
  ].join("\n");
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: user },
  ];
}

// ───────────────────────── /chat (typed question) ─────────────────────────

export interface ChatPromptArgs {
  systemPrompt: string;
  transcript: string;
  windowChars: number;
  chatHistory: ChatMessage[];
  historyTurns: number;
  userQuestion: string;
}

export function buildChatMessages({
  systemPrompt,
  transcript,
  windowChars,
  chatHistory,
  historyTurns,
  userQuestion,
}: ChatPromptArgs): GroqMessage[] {
  const window = tail(transcript, windowChars);
  const recent = chatHistory
    .filter((m) => m.content.trim())
    .slice(-historyTurns);
  const historyText =
    recent.length === 0
      ? "(no prior turns)"
      : recent.map((m) => `${m.role}: ${m.content}`).join("\n");
  const user = [
    "transcript_window:",
    window,
    "---",
    "chat_history:",
    historyText,
    "---",
    "user_question:",
    userQuestion,
  ].join("\n");
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: user },
  ];
}
