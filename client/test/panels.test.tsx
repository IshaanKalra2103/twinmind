import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TranscriptPanel } from "@/components/TranscriptPanel/TranscriptPanel";
import { SuggestionsPanel } from "@/components/SuggestionsPanel/SuggestionsPanel";
import { ChatPanel } from "@/components/ChatPanel/ChatPanel";
import type {
  ChatMessage,
  SuggestionBatch,
  TranscriptLine,
} from "@/types/session";

describe("TranscriptPanel", () => {
  it("renders empty state when no lines", () => {
    render(
      <TranscriptPanel
        transcript={[]}
        recording={false}
        onToggleMic={() => {}}
      />
    );
    expect(screen.getByText(/No transcript yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Mic & Transcript/i)).toBeInTheDocument();
  });

  it("renders transcript lines when populated", () => {
    const lines: TranscriptLine[] = [
      {
        id: "seg_1",
        text: "This is the first line.",
        startedAt: "2026-04-22T12:00:00Z",
        receivedAt: "2026-04-22T12:00:00Z",
      },
      {
        id: "seg_2",
        text: "Second line here.",
        startedAt: "2026-04-22T12:00:30Z",
        receivedAt: "2026-04-22T12:00:30Z",
      },
    ];
    render(
      <TranscriptPanel
        transcript={lines}
        recording
        onToggleMic={() => {}}
      />
    );
    expect(screen.getByText(/first line/i)).toBeInTheDocument();
    expect(screen.getByText(/Second line here/i)).toBeInTheDocument();
    expect(screen.queryByText(/No transcript yet/i)).not.toBeInTheDocument();
  });
});

describe("SuggestionsPanel", () => {
  it("renders empty state when no batches", () => {
    render(
      <SuggestionsPanel
        batches={[]}
        countdown={30}
        canRefresh={false}
        onReload={() => {}}
        onSuggestionClick={() => {}}
      />
    );
    expect(screen.getByText(/Suggestions appear here/i)).toBeInTheDocument();
    expect(screen.getByText(/0 batches/)).toBeInTheDocument();
  });

  it("renders suggestion cards for each batch", () => {
    const batches: SuggestionBatch[] = [
      {
        id: "b1",
        createdAt: "2026-04-22T12:00:00Z",
        suggestions: [
          {
            id: "s1",
            type: "question",
            preview: "What's your p99?",
            fresh: true,
          },
          {
            id: "s2",
            type: "fact_check",
            preview: "Slack outage was a config push.",
            fresh: true,
          },
        ],
      },
    ];
    const onClick = vi.fn();
    render(
      <SuggestionsPanel
        batches={batches}
        countdown={12}
        canRefresh
        onReload={() => {}}
        onSuggestionClick={onClick}
      />
    );
    expect(screen.getByText(/What's your p99\?/)).toBeInTheDocument();
    expect(
      screen.getByText(/Slack outage was a config push/)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 batch$/)).toBeInTheDocument();
    expect(screen.getByText(/auto-refresh in 12s/)).toBeInTheDocument();
  });
});

describe("ChatPanel", () => {
  it("renders empty state when no messages", () => {
    render(
      <ChatPanel messages={[]} onSend={() => {}} />
    );
    expect(
      screen.getByText(/Click a suggestion or type a question/i)
    ).toBeInTheDocument();
  });

  it("renders user and assistant messages", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: "What is X?",
        createdAt: "2026-04-22T12:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "X is…",
        createdAt: "2026-04-22T12:00:01Z",
      },
    ];
    render(<ChatPanel messages={messages} onSend={() => {}} />);
    expect(screen.getByText("What is X?")).toBeInTheDocument();
    expect(screen.getByText("X is…")).toBeInTheDocument();
    expect(screen.getByText(/^You$/)).toBeInTheDocument();
    expect(screen.getByText(/^Assistant$/)).toBeInTheDocument();
  });
});
