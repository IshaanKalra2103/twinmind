import { describe, expect, it } from "vitest";
import { INITIAL_STATE, sessionReducer } from "@/lib/sessionStore";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { SessionState, SuggestionBatch } from "@/types/session";

function mkBatch(id: string, sugId: string, fresh = true): SuggestionBatch {
  return {
    id,
    createdAt: "2026-04-22T00:00:00Z",
    suggestions: [
      {
        id: sugId,
        type: "question",
        preview: "p",
        rationale: "r",
        fresh,
      },
    ],
  };
}

describe("sessionReducer", () => {
  it("hydrate loads apiKey + settings and flips hydrated flag", () => {
    const s = sessionReducer(INITIAL_STATE, {
      type: "hydrate",
      apiKey: "gsk_123",
      settings: DEFAULT_SETTINGS,
    });
    expect(s.apiKey).toBe("gsk_123");
    expect(s.settings).toBe(DEFAULT_SETTINGS);
    expect(s.hydrated).toBe(true);
  });

  it("setApiKey / setSettings / setRecording update cleanly", () => {
    let s: SessionState = INITIAL_STATE;
    s = sessionReducer(s, { type: "setApiKey", apiKey: "abc" });
    expect(s.apiKey).toBe("abc");
    s = sessionReducer(s, {
      type: "setSettings",
      settings: { ...DEFAULT_SETTINGS, suggestionContextSegments: 5 },
    });
    expect(s.settings.suggestionContextSegments).toBe(5);
    s = sessionReducer(s, { type: "setRecording", recording: true });
    expect(s.isRecording).toBe(true);
  });

  it("appendTranscript appends in order", () => {
    const s = sessionReducer(INITIAL_STATE, {
      type: "appendTranscript",
      line: {
        id: "seg_1",
        text: "hello",
        startedAt: "t",
        receivedAt: "t",
      },
    });
    expect(s.transcript.map((x) => x.id)).toEqual(["seg_1"]);
  });

  it("addBatch puts newest at index 0 and demotes prior batches to stale", () => {
    let s: SessionState = INITIAL_STATE;
    s = sessionReducer(s, { type: "addBatch", batch: mkBatch("b1", "s1") });
    expect(s.batches[0].suggestions[0].fresh).toBe(true);
    s = sessionReducer(s, { type: "addBatch", batch: mkBatch("b2", "s2") });
    expect(s.batches.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(s.batches[0].suggestions[0].fresh).toBe(true);
    expect(s.batches[1].suggestions[0].fresh).toBe(false);
  });

  it("markSuggestionClicked flips the clicked flag for the matching suggestion only", () => {
    let s: SessionState = INITIAL_STATE;
    s = sessionReducer(s, { type: "addBatch", batch: mkBatch("b1", "s1") });
    s = sessionReducer(s, { type: "addBatch", batch: mkBatch("b2", "s2") });
    s = sessionReducer(s, {
      type: "markSuggestionClicked",
      suggestionId: "s1",
    });
    const flat = s.batches.flatMap((b) => b.suggestions);
    expect(flat.find((x) => x.id === "s1")?.clicked).toBe(true);
    expect(flat.find((x) => x.id === "s2")?.clicked).toBeUndefined();
  });

  it("tickCountdown wraps from 1 to 30", () => {
    let s: SessionState = { ...INITIAL_STATE, countdown: 1 };
    s = sessionReducer(s, { type: "tickCountdown" });
    expect(s.countdown).toBe(30);
    s = sessionReducer(s, { type: "tickCountdown" });
    expect(s.countdown).toBe(29);
  });

  it("resetCountdown uses supplied value or defaults to 30", () => {
    let s: SessionState = { ...INITIAL_STATE, countdown: 12 };
    s = sessionReducer(s, { type: "resetCountdown" });
    expect(s.countdown).toBe(30);
    s = sessionReducer(s, { type: "resetCountdown", seconds: 5 });
    expect(s.countdown).toBe(5);
  });

  it("addChatMessage / appendToAssistant / finishAssistant play nicely together", () => {
    let s: SessionState = INITIAL_STATE;
    s = sessionReducer(s, {
      type: "addChatMessage",
      message: {
        id: "m1",
        role: "assistant",
        content: "",
        createdAt: "t",
        streaming: true,
      },
    });
    s = sessionReducer(s, {
      type: "appendToAssistant",
      messageId: "m1",
      delta: "Hello, ",
    });
    s = sessionReducer(s, {
      type: "appendToAssistant",
      messageId: "m1",
      delta: "world",
    });
    expect(s.chat[0].content).toBe("Hello, world");
    expect(s.chat[0].streaming).toBe(true);
    s = sessionReducer(s, { type: "finishAssistant", messageId: "m1" });
    expect(s.chat[0].streaming).toBe(false);
    expect(s.chat[0].error).toBeNull();
  });

  it("finishAssistant can carry an error", () => {
    let s: SessionState = INITIAL_STATE;
    s = sessionReducer(s, {
      type: "addChatMessage",
      message: {
        id: "m1",
        role: "assistant",
        content: "",
        createdAt: "t",
        streaming: true,
      },
    });
    s = sessionReducer(s, {
      type: "finishAssistant",
      messageId: "m1",
      error: "boom",
    });
    expect(s.chat[0].streaming).toBe(false);
    expect(s.chat[0].error).toBe("boom");
  });

  it("setError stores the banner string and can clear with null", () => {
    let s: SessionState = sessionReducer(INITIAL_STATE, {
      type: "setError",
      error: "network is out",
    });
    expect(s.lastError).toBe("network is out");
    s = sessionReducer(s, { type: "setError", error: null });
    expect(s.lastError).toBeNull();
  });
});
