/**
 * Whisper hallucinates phantom phrases on silent or near-silent audio —
 * "thanks for watching", subscribe prompts, single foreign-language words,
 * brackets like [music]. Filter them before they land in the transcript.
 */

const HALLUCINATION_LITERALS: ReadonlySet<string> = new Set([
  "",
  "thank you",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thanks for watching!",
  "subscribe to the channel",
  "please subscribe",
  "like and subscribe",
  "bye",
  "goodbye",
  "hmm",
  "hm",
  "uh",
  "um",
  "yeah",
  "ok",
  "okay",
  "you",
  "the",
  "music",
  "[music]",
  "(music)",
  "applause",
  "[applause]",
  "silence",
  "[silence]",
  "takk for ating med",
  "takk",
  "tack",
  "danke",
  "gracias",
  "merci",
]);

function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return true;
  return false;
}

export function isHallucination(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?…]+$/, "").trim();
  if (HALLUCINATION_LITERALS.has(normalized)) return true;
  // Short non-ASCII drifts (single Nordic/German words on silence).
  if (normalized.length <= 25 && hasNonAscii(normalized)) return true;
  return false;
}
