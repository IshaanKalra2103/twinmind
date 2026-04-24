/**
 * Direct Groq client. The browser holds the user's API key (pasted in
 * Settings, stored in localStorage) and calls Groq directly — no proxy.
 * Groq's `/openai/v1/*` endpoints are CORS-enabled for any origin.
 */

import { parseSseStream } from "./sse";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const MODEL_TRANSCRIBE = "whisper-large-v3";
const MODEL_CHAT = "openai/gpt-oss-120b";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function assertOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.text();
    if (body) detail += `: ${body.slice(0, 500)}`;
  } catch {
    // ignore
  }
  throw new Error(`${what} failed — ${detail}`);
}

// ───────────────────────── Transcription ─────────────────────────

export interface TranscribeArgs {
  apiKey: string;
  audio: Blob;
  filename: string;
  /** ISO-639-1 code. Default "en" — unpinned Whisper drifts into foreign
   *  phantom output on near-silent audio. */
  language?: string;
  signal?: AbortSignal;
}

/** Returns the transcribed text (possibly empty) from a single audio chunk. */
export async function transcribeAudio({
  apiKey,
  audio,
  filename,
  language = "en",
  signal,
}: TranscribeArgs): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", MODEL_TRANSCRIBE);
  form.append("language", language);
  form.append("response_format", "json");

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  await assertOk(res, "Transcription");
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}

// ───────────────────────── Chat (non-streaming) ─────────────────────────

export interface ChatArgs {
  apiKey: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Set to force JSON-object output (used for /suggestions). */
  responseFormatJson?: boolean;
  signal?: AbortSignal;
}

export async function chatCompletion({
  apiKey,
  messages,
  temperature = 0.4,
  maxTokens,
  responseFormatJson,
  signal,
}: ChatArgs): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL_CHAT,
    messages,
    temperature,
    stream: false,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (responseFormatJson) body.response_format = { type: "json_object" };

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  await assertOk(res, "Chat completion");
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

// ───────────────────────── Chat (streaming) ─────────────────────────

/**
 * Streams tokens from Groq's chat completions endpoint. The wire format is
 * OpenAI-compatible: lines of `data: {json}` with a terminal `data: [DONE]`.
 */
export async function* chatCompletionStream({
  apiKey,
  messages,
  temperature = 0.4,
  maxTokens,
  signal,
}: ChatArgs): AsyncGenerator<string, void, void> {
  const body: Record<string, unknown> = {
    model: MODEL_CHAT,
    messages,
    temperature,
    stream: true,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    await assertOk(res, "Chat stream");
    throw new Error("Chat stream: no response body");
  }

  for await (const frame of parseSseStream(res.body)) {
    const payload = frame.data;
    if (payload === "[DONE]") return;
    let parsed: {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // Groq occasionally emits keepalive-style comments
    }
    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}
