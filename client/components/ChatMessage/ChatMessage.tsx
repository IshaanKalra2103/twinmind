import type { ChatMessage as ChatMessageT } from "@/types/session";
import styles from "./ChatMessage.module.css";

export function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";
  const who = isUser
    ? message.suggestionLabel
      ? `You · ${message.suggestionLabel}`
      : "You"
    : "Assistant";

  return (
    <div className={`${styles.msg} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.who}>{who}</div>
      <div className={styles.bubble}>
        {message.content}
        {message.streaming && <span className={styles.cursor} aria-hidden />}
      </div>
      {message.error && (
        <div className={styles.errorNote}>Error: {message.error}</div>
      )}
    </div>
  );
}
