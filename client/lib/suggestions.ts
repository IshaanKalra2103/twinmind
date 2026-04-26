/**
 * Parse + validate the JSON response from the live-suggestions prompt.
 * The prompt demands exactly 3 items; anything else throws so the caller
 * can retry or surface an error. Extra top-level keys (e.g. `reasoning`,
 * which the prompt asks the model to emit as cheap chain-of-thought) are
 * intentionally ignored — we only consume `suggestions`.
 */

import type { SuggestionType } from "@/types/api";

const VALID_TYPES: ReadonlySet<SuggestionType> = new Set<SuggestionType>([
  "question",
  "talking_point",
  "answer",
  "fact_check",
  "clarifying_info",
]);

export interface ParsedSuggestion {
  type: SuggestionType;
  preview: string;
  rationale: string | null;
}

export function parseSuggestionsJson(raw: string): ParsedSuggestion[] {
  const data = JSON.parse(raw) as unknown;
  if (!data || typeof data !== "object" || !("suggestions" in data)) {
    throw new Error("Missing 'suggestions' key at top level.");
  }
  const items = (data as { suggestions: unknown }).suggestions;
  if (!Array.isArray(items)) {
    throw new Error("'suggestions' is not a list.");
  }
  if (items.length !== 3) {
    throw new Error(`Expected 3 suggestions, got ${items.length}.`);
  }
  return items.map((s, i) => {
    if (!s || typeof s !== "object") {
      throw new Error(`suggestions[${i}] is not an object.`);
    }
    const t = (s as { type?: unknown }).type;
    const preview = (s as { preview?: unknown }).preview;
    const rationale = (s as { rationale?: unknown }).rationale;
    if (typeof t !== "string" || !VALID_TYPES.has(t as SuggestionType)) {
      throw new Error(`suggestions[${i}].type invalid: ${JSON.stringify(t)}`);
    }
    if (typeof preview !== "string" || !preview.trim()) {
      throw new Error(`suggestions[${i}].preview missing or empty.`);
    }
    return {
      type: t as SuggestionType,
      preview: preview.trim().slice(0, 280),
      rationale:
        typeof rationale === "string" && rationale.trim()
          ? rationale.trim().slice(0, 200)
          : null,
    };
  });
}
