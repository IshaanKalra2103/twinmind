"use client";

import { HelpBanner } from "@/components/HelpBanner/HelpBanner";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { SuggestionCard } from "@/components/SuggestionCard/SuggestionCard";
import { BatchDivider } from "@/components/BatchDivider/BatchDivider";
import type { Suggestion, SuggestionBatch } from "@/types/session";
import styles from "./SuggestionsPanel.module.css";

interface Props {
  batches: SuggestionBatch[]; // newest first
  countdown: number;
  loading?: boolean;
  canRefresh: boolean;
  onReload: () => void;
  onSuggestionClick: (s: Suggestion) => void;
}

export function SuggestionsPanel({
  batches,
  countdown,
  loading,
  canRefresh,
  onReload,
  onSuggestionClick,
}: Props) {
  const batchCount = batches.length;

  return (
    <div className={styles.col}>
      <div className={styles.header}>
        <span>2. Live Suggestions</span>
        <span>
          {batchCount} batch{batchCount === 1 ? "" : "es"}
        </span>
      </div>
      <div className={styles.reloadRow}>
        <button
          type="button"
          className={styles.reloadBtn}
          onClick={onReload}
          disabled={!canRefresh || loading}
        >
          {loading ? "Generating…" : "↻ Reload suggestions"}
        </button>
        <span className={styles.countdown}>
          auto-refresh in {countdown}s
        </span>
      </div>
      <div className={styles.body}>
        <HelpBanner>
          On reload (or auto every ~30s), 3 fresh suggestions generate from
          recent transcript context. New batch appears at the top; older
          batches push down (faded). Each card is tappable.
        </HelpBanner>
        {batchCount === 0 ? (
          <EmptyState>
            Suggestions appear here once recording starts.
          </EmptyState>
        ) : (
          batches.map((batch, i) => {
            // Newest first in render order; batch number counts from earliest.
            const number = batchCount - i;
            return (
              <div key={batch.id}>
                {batch.suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    onClick={onSuggestionClick}
                  />
                ))}
                <BatchDivider
                  batchNumber={number}
                  createdAt={batch.createdAt}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
