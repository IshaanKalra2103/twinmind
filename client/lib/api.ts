import type {
  ChatRequest,
  ChatResponse,
  ExportResponse,
  SseDoneData,
  SseErrorData,
  SseStartData,
  SseTokenData,
  SuggestionsRequest,
  SuggestionsResponse,
  TranscribeResponse,
} from "@/types/api";
import { parseSseStream } from "./sse";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000";

export interface ApiContext {
  /** Groq key from localStorage (never hardcoded). */
  apiKey: string;
  /** Session id. Null on the very first request; server mints one and echoes. */
  sessionId: string | null;
}

function headers(ctx: ApiContext, extra: Record<string, string> = {}): HeadersInit {
  const h: Record<string, string> = { ...extra };
  if (ctx.apiKey) h["X-Groq-Api-Key"] = ctx.apiKey;
  if (ctx.sessionId) h["X-Session-Id"] = ctx.sessionId;
  return h;
}

/** Extract session id the server possibly minted (decision-001). */
function sessionIdFrom(res: Response, body: { session_id?: string } | null): string | null {
  const h = res.headers.get("X-Session-Id");
  if (h) return h;
  if (body && typeof body.session_id === "string") return body.session_id;
  return null;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let msg = `${res.status} ${res.statusText}`;
  try {
    const text = await res.text();
    if (text) msg = `${msg}: ${text}`;
  } catch {
    // ignore
  }
  throw new Error(msg);
}

// ───────────────────────── /transcribe ─────────────────────────

export interface TranscribeArgs {
  ctx: ApiContext;
  audio: Blob;
  startedAt: string;
  language?: string;
  signal?: AbortSignal;
}

export async function transcribe({
  ctx,
  audio,
  startedAt,
  language,
  signal,
}: TranscribeArgs): Promise<{ data: TranscribeResponse; sessionId: string | null }> {
  const form = new FormData();
  // Chrome default is webm/opus; Safari is mp4. Name is cosmetic — server reads MIME.
  const ext = audio.type.includes("mp4") ? "m4a" : "webm";
  form.append("audio", audio, `chunk.${ext}`);
  form.append("started_at", startedAt);
  if (language) form.append("language", language);

  const res = await fetch(`${BASE_URL}/transcribe`, {
    method: "POST",
    body: form,
    headers: headers(ctx),
    signal,
  });
  await assertOk(res);
  const data = (await res.json()) as TranscribeResponse;
  return { data, sessionId: sessionIdFrom(res, data) };
}

// ───────────────────────── /suggestions ─────────────────────────

export async function getSuggestions(args: {
  ctx: ApiContext;
  body: SuggestionsRequest;
  signal?: AbortSignal;
}): Promise<{ data: SuggestionsResponse; sessionId: string | null }> {
  const res = await fetch(`${BASE_URL}/suggestions`, {
    method: "POST",
    headers: headers(args.ctx, { "Content-Type": "application/json" }),
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  await assertOk(res);
  const data = (await res.json()) as SuggestionsResponse;
  return { data, sessionId: sessionIdFrom(res, data) };
}

// ───────────────────────── /chat & /chat-stream ─────────────────────────

export async function chat(args: {
  ctx: ApiContext;
  body: ChatRequest;
  signal?: AbortSignal;
}): Promise<{ data: ChatResponse; sessionId: string | null }> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: headers(args.ctx, { "Content-Type": "application/json" }),
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  await assertOk(res);
  const data = (await res.json()) as ChatResponse;
  return { data, sessionId: sessionIdFrom(res, data) };
}

export type ChatStreamEvent =
  | { type: "start"; data: SseStartData; sessionId: string | null }
  | { type: "token"; data: SseTokenData }
  | { type: "done"; data: SseDoneData }
  | { type: "error"; data: SseErrorData };

/**
 * POST /chat-stream, parse SSE via fetch+ReadableStream (decision-003).
 * Yields typed events. Throws on network failure; caller decides whether to
 * fall back to /chat.
 */
export async function* chatStream(args: {
  ctx: ApiContext;
  body: ChatRequest;
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, void, void> {
  const res = await fetch(`${BASE_URL}/chat-stream`, {
    method: "POST",
    headers: headers(args.ctx, {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    }),
    body: JSON.stringify(args.body),
    signal: args.signal,
  });
  if (!res.ok || !res.body) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`chat-stream failed: ${res.status} ${res.statusText} ${text}`);
  }

  const sessionId = res.headers.get("X-Session-Id");

  for await (const frame of parseSseStream(res.body)) {
    switch (frame.event) {
      case "start": {
        const data = JSON.parse(frame.data) as SseStartData;
        yield { type: "start", data, sessionId };
        break;
      }
      case "token": {
        const data = JSON.parse(frame.data) as SseTokenData;
        yield { type: "token", data };
        break;
      }
      case "done": {
        const data = JSON.parse(frame.data) as SseDoneData;
        yield { type: "done", data };
        return;
      }
      case "error": {
        const data = JSON.parse(frame.data) as SseErrorData;
        yield { type: "error", data };
        return;
      }
      // "message" / unknown — ignore.
    }
  }
}

// ───────────────────────── /export ─────────────────────────

export async function exportSession(args: {
  ctx: ApiContext;
  signal?: AbortSignal;
}): Promise<ExportResponse> {
  const res = await fetch(`${BASE_URL}/export`, {
    method: "GET",
    headers: headers(args.ctx),
    signal: args.signal,
  });
  await assertOk(res);
  return (await res.json()) as ExportResponse;
}
