import type { Suggestion } from "@/types/session";
import type { SuggestionType } from "@/types/api";
import styles from "./SuggestionCard.module.css";

const TAG_CLASS: Record<SuggestionType, string> = {
  question: styles.question,
  talking_point: styles.talking,
  answer: styles.answer,
  fact_check: styles.fact,
  clarifying_info: styles.clarifying,
};

export const TAG_LABEL: Record<SuggestionType, string> = {
  question: "Question to ask",
  talking_point: "Talking point",
  answer: "Answer",
  fact_check: "Fact-check",
  clarifying_info: "Clarifying info",
};

export function SuggestionCard({
  suggestion,
  onClick,
}: {
  suggestion: Suggestion;
  onClick?: (s: Suggestion) => void;
}) {
  const freshnessClass = suggestion.fresh ? styles.fresh : styles.stale;
  return (
    <button
      type="button"
      className={`${styles.card} ${freshnessClass}`}
      onClick={() => onClick?.(suggestion)}
    >
      <span className={`${styles.tag} ${TAG_CLASS[suggestion.type] ?? ""}`}>
        {TAG_LABEL[suggestion.type] ?? suggestion.type}
      </span>
      <div className={styles.title}>{suggestion.preview}</div>
    </button>
  );
}
