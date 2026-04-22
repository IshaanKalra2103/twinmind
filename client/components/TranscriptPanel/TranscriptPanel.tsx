"use client";

import { useRef } from "react";
import { HelpBanner } from "@/components/HelpBanner/HelpBanner";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MicButton } from "@/components/MicButton/MicButton";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import type { TranscriptLine } from "@/types/session";
import styles from "./TranscriptPanel.module.css";

interface Props {
  transcript: TranscriptLine[];
  recording: boolean;
  micDisabled?: boolean;
  onToggleMic: () => void;
  showApiKeyBanner?: boolean;
}

export function TranscriptPanel({
  transcript,
  recording,
  micDisabled,
  onToggleMic,
  showApiKeyBanner,
}: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useAutoScroll(bodyRef, [transcript.length]);

  const status = recording
    ? "Listening… transcript updates every ~30s."
    : transcript.length > 0
      ? "Stopped. Click to resume."
      : "Click mic to start. Transcript appends every ~30s.";

  return (
    <div className={styles.col}>
      <div className={styles.header}>
        <span>1. Mic &amp; Transcript</span>
        <span className={recording ? styles.recActive : undefined}>
          {recording ? "● recording" : "idle"}
        </span>
      </div>
      <div className={styles.micWrap}>
        <MicButton
          recording={recording}
          onToggle={onToggleMic}
          disabled={micDisabled}
        />
        <div className={styles.micStatus}>{status}</div>
      </div>
      <div className={styles.body} ref={bodyRef}>
        {showApiKeyBanner && (
          <HelpBanner variant="warn">
            Paste your Groq API key in Settings before starting recording — it
            is required for transcription.
          </HelpBanner>
        )}
        <HelpBanner>
          Transcript scrolls and appends new chunks every ~30 seconds while
          recording. Use the mic button to start / stop.
        </HelpBanner>
        {transcript.length === 0 ? (
          <EmptyState>No transcript yet — start the mic.</EmptyState>
        ) : (
          transcript.map((line) => (
            <div key={line.id} className={styles.line}>
              <span className={styles.ts}>
                {new Date(line.startedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
