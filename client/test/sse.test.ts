import { describe, expect, it } from "vitest";
import { parseSseStream } from "@/lib/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const frame of parseSseStream(stream)) out.push(frame);
  return out;
}

describe("parseSseStream", () => {
  it("splits frames on a blank line", async () => {
    const stream = streamOf([
      'event: start\ndata: {"message_id":"m1"}\n\n',
      'event: token\ndata: {"delta":"hi"}\n\n',
      'event: done\ndata: {"message_id":"m1"}\n\n',
    ]);
    const frames = await collect(stream);
    expect(frames.map((f) => f.event)).toEqual(["start", "token", "done"]);
    expect(JSON.parse(frames[0].data)).toEqual({ message_id: "m1" });
  });

  it("joins multiple data: lines with newlines", async () => {
    const stream = streamOf([
      "event: token\ndata: line one\ndata: line two\ndata: line three\n\n",
    ]);
    const [frame] = await collect(stream);
    expect(frame.event).toBe("token");
    expect(frame.data).toBe("line one\nline two\nline three");
  });

  it("ignores keep-alive comments", async () => {
    const stream = streamOf([
      ":ping\n\n",
      'event: token\ndata: {"delta":"x"}\n\n',
      ":another comment\n\n",
      'event: done\ndata: {"message_id":"m1"}\n\n',
    ]);
    const frames = await collect(stream);
    expect(frames.map((f) => f.event)).toEqual(["token", "done"]);
  });

  it("handles `event: done` as the terminal event", async () => {
    const stream = streamOf([
      'event: done\ndata: {"message_id":"m1","finish_reason":"stop"}\n\n',
    ]);
    const frames = await collect(stream);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("done");
    const parsed = JSON.parse(frames[0].data);
    expect(parsed.finish_reason).toBe("stop");
  });

  it("handles frames split across chunk boundaries", async () => {
    const stream = streamOf([
      "event: tok",
      "en\ndata: {",
      '"delta":"hel',
      'lo"}\n',
      "\nevent: done\n",
      'data: {"message_id":"m1"}\n\n',
    ]);
    const frames = await collect(stream);
    expect(frames.map((f) => f.event)).toEqual(["token", "done"]);
    expect(JSON.parse(frames[0].data)).toEqual({ delta: "hello" });
  });

  it("strips exactly one leading space after the colon", async () => {
    const stream = streamOf(["event:msg\ndata:  two-spaces\n\n"]);
    const [frame] = await collect(stream);
    // Only the first space is stripped — the second remains.
    expect(frame.data).toBe(" two-spaces");
    expect(frame.event).toBe("msg");
  });

  it("handles \\r\\n line endings", async () => {
    const stream = streamOf([
      'event: token\r\ndata: {"delta":"rn"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n',
    ]);
    const frames = await collect(stream);
    expect(frames.map((f) => f.event)).toEqual(["token", "done"]);
  });
});
