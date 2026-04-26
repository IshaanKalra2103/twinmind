"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_EXPANDED_ANSWER_PROMPT,
  DEFAULT_EXPANDED_SEGMENTS,
  DEFAULT_LIVE_SUGGESTION_PROMPT,
  DEFAULT_SUGGESTION_SEGMENTS,
} from "@/lib/defaults";
import type { Settings } from "@/types/session";
import styles from "./SettingsModal.module.css";

interface Props {
  open: boolean;
  initialApiKey: string;
  initialSettings: Settings;
  onClose: () => void;
  onSave: (next: { apiKey: string; settings: Settings }) => void;
}

export function SettingsModal({
  open,
  initialApiKey,
  initialSettings,
  onClose,
  onSave,
}: Props) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [showKey, setShowKey] = useState(false);
  const [s, setS] = useState<Settings>(initialSettings);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Re-seed local state when the modal opens so cancelling discards edits.
  useEffect(() => {
    if (open) {
      setApiKey(initialApiKey);
      setS(initialSettings);
      setShowKey(false);
      // Focus the key field after mount.
      queueMicrotask(() => firstFieldRef.current?.focus());
    }
  }, [open, initialApiKey, initialSettings]);

  // Esc-to-close + lightweight focus trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'input, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => onSave({ apiKey: apiKey.trim(), settings: s });

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={styles.modal}
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className={styles.header}>
          <h2 id="settings-title" className={styles.title}>
            Settings
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close settings"
          >
            Close
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="apiKey">
                Groq API key
              </label>
            </div>
            <div className={styles.keyRow}>
              <input
                id="apiKey"
                ref={firstFieldRef}
                className={styles.input}
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="gsk_..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <div className={styles.hint}>
              Stored in your browser&apos;s localStorage only. Sent as{" "}
              <code>X-Groq-Api-Key</code> on each request.
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="meetingContext">
                Meeting context (optional)
              </label>
              <button
                type="button"
                className={styles.reset}
                onClick={() => setS((p) => ({ ...p, meetingContext: "" }))}
              >
                Clear
              </button>
            </div>
            <textarea
              id="meetingContext"
              className={styles.textarea}
              value={s.meetingContext}
              placeholder='e.g. "sales discovery call with a fintech prospect" or "PM interviewing a candidate for a senior role"'
              onChange={(e) =>
                setS((p) => ({ ...p, meetingContext: e.target.value }))
              }
            />
            <div className={styles.hint}>
              Injected verbatim into the suggestion prompt. A one-line
              description of who&apos;s in the meeting and what it&apos;s
              about noticeably sharpens the cards.
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="liveSuggestionPrompt">
                Live-suggestion prompt
              </label>
              <button
                type="button"
                className={styles.reset}
                onClick={() =>
                  setS((p) => ({
                    ...p,
                    liveSuggestionPrompt: DEFAULT_LIVE_SUGGESTION_PROMPT,
                  }))
                }
              >
                Reset
              </button>
            </div>
            <textarea
              id="liveSuggestionPrompt"
              className={styles.textarea}
              value={s.liveSuggestionPrompt}
              onChange={(e) =>
                setS((p) => ({ ...p, liveSuggestionPrompt: e.target.value }))
              }
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="expandedAnswerPrompt">
                Detailed-answer-on-click prompt
              </label>
              <button
                type="button"
                className={styles.reset}
                onClick={() =>
                  setS((p) => ({
                    ...p,
                    expandedAnswerPrompt: DEFAULT_EXPANDED_ANSWER_PROMPT,
                  }))
                }
              >
                Reset
              </button>
            </div>
            <textarea
              id="expandedAnswerPrompt"
              className={styles.textarea}
              value={s.expandedAnswerPrompt}
              onChange={(e) =>
                setS((p) => ({ ...p, expandedAnswerPrompt: e.target.value }))
              }
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="chatPrompt">
                Chat prompt
              </label>
              <button
                type="button"
                className={styles.reset}
                onClick={() =>
                  setS((p) => ({ ...p, chatPrompt: DEFAULT_CHAT_PROMPT }))
                }
              >
                Reset
              </button>
            </div>
            <textarea
              id="chatPrompt"
              className={styles.textarea}
              value={s.chatPrompt}
              onChange={(e) =>
                setS((p) => ({ ...p, chatPrompt: e.target.value }))
              }
            />
          </div>

          <div className={styles.rowTwo}>
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label
                  className={styles.label}
                  htmlFor="suggestionContextSegments"
                >
                  Suggestion context (segments)
                </label>
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() =>
                    setS((p) => ({
                      ...p,
                      suggestionContextSegments: DEFAULT_SUGGESTION_SEGMENTS,
                    }))
                  }
                >
                  Reset
                </button>
              </div>
              <input
                id="suggestionContextSegments"
                className={styles.input}
                type="number"
                min={1}
                max={200}
                value={s.suggestionContextSegments}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    suggestionContextSegments: clampInt(e.target.value, 1, 200),
                  }))
                }
              />
              <div className={styles.hint}>
                Each segment ≈ 30s of transcript.
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label
                  className={styles.label}
                  htmlFor="expandedContextSegments"
                >
                  Expanded context (segments)
                </label>
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() =>
                    setS((p) => ({
                      ...p,
                      expandedContextSegments: DEFAULT_EXPANDED_SEGMENTS,
                    }))
                  }
                >
                  Reset
                </button>
              </div>
              <input
                id="expandedContextSegments"
                className={styles.input}
                type="number"
                min={1}
                max={500}
                value={s.expandedContextSegments}
                onChange={(e) =>
                  setS((p) => ({
                    ...p,
                    expandedContextSegments: clampInt(e.target.value, 1, 500),
                  }))
                }
              />
              <div className={styles.hint}>Used for on-click answers and chat.</div>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primary} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function clampInt(v: string, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
