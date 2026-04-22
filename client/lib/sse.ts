/**
 * Minimal SSE frame parser for `fetch + ReadableStream`. Per W3C SSE:
 *   - Events are separated by a blank line (\n\n).
 *   - Each line inside an event is either `field: value`, `field:value`,
 *     or `:comment` (ignored).
 *   - Multiple `data:` lines in one event are joined with "\n".
 *
 * Yields one parsed frame per event. Safe to cancel via the caller aborting
 * the underlying `fetch`.
 */

export interface SseFrame {
  event: string; // default "message" per spec
  data: string;
  id?: string;
}

export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SseFrame, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Split on blank-line event boundaries. Tolerate \r\n\r\n and \n\n.
      let idx: number;
      while ((idx = firstFrameBoundary(buf)) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + boundaryLen(buf, idx));
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }

    // Flush any tail without a trailing blank line (tolerant).
    const tail = buf.trim();
    if (tail) {
      const frame = parseFrame(tail);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

function firstFrameBoundary(s: string): number {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function boundaryLen(s: string, at: number): number {
  return s.startsWith("\r\n\r\n", at) ? 4 : 2;
}

function parseFrame(raw: string): SseFrame | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const dataParts: string[] = [];
  let id: string | undefined;

  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue; // comment / keep-alive
    const colon = line.indexOf(":");
    // "field" with no colon is valid per spec (empty value) — skip silently.
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    // Spec: strip a single leading space after the colon if present.
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        dataParts.push(value);
        break;
      case "id":
        id = value;
        break;
      // "retry" and unknown fields are ignored for our purposes.
    }
  }

  if (dataParts.length === 0 && event === "message") return null;
  return { event, data: dataParts.join("\n"), id };
}
