"use client";

import { useRef, useState } from "react";
import { HelpBanner } from "@/components/HelpBanner/HelpBanner";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { ChatMessage } from "@/components/ChatMessage/ChatMessage";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { ChatMessage as ChatMessageT } from "@/types/session";
import styles from "./ChatPanel.module.css";

interface Props {
  messages: ChatMessageT[];
  disabled?: boolean;
  onSend: (text: string) => void;
  showApiKeyBanner?: boolean;
}

export function ChatPanel({
  messages,
  disabled,
  onSend,
  showApiKeyBanner,
}: Props) {
  const [value, setValue] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Scroll on new messages AND while the last message is streaming tokens.
  const lastContent = messages[messages.length - 1]?.content ?? "";
  useAutoScroll(bodyRef, [messages.length, lastContent.length]);

  const send = () => {
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue("");
  };

  return (
    <div className={styles.col}>
      <div className={styles.header}>
        <span>3. Chat (detailed answers)</span>
        <span>session-only</span>
      </div>
      <div className={styles.body} ref={bodyRef}>
        {showApiKeyBanner && (
          <HelpBanner variant="warn">
            Paste your Groq API key in Settings to send messages.
          </HelpBanner>
        )}
        <HelpBanner>
          Clicking a suggestion adds it to this chat and streams a detailed
          answer. You can also type questions directly. One continuous chat per
          session.
        </HelpBanner>
        {messages.length === 0 ? (
          <EmptyState>Click a suggestion or type a question below.</EmptyState>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder="Ask anything…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          disabled={disabled}
        />
        <button
          type="button"
          className={styles.send}
          onClick={send}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
