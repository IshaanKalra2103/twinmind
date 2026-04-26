"use client";

import { useCallback, useRef, useState } from "react";
import { TopBar } from "@/components/TopBar/TopBar";
import { TranscriptPanel } from "@/components/TranscriptPanel/TranscriptPanel";
import { SuggestionsPanel } from "@/components/SuggestionsPanel/SuggestionsPanel";
import { ChatPanel } from "@/components/ChatPanel/ChatPanel";
import { SettingsModal } from "@/components/SettingsModal/SettingsModal";
import { ExportButton } from "@/components/ExportButton/ExportButton";
import { useSession } from "@/lib/sessionStore";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { useSuggestionsPolling } from "@/hooks/useSuggestionsPolling";
import { useChatStream } from "@/hooks/useChatStream";
import { transcribeAudio } from "@/lib/groq";
import { isHallucination } from "@/lib/transcribeFilter";
import { makeId } from "@/lib/ids";
import type { Suggestion } from "@/types/session";
import styles from "./page.module.css";

export default function Home() {
  const { state, dispatch } = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasKey = !!state.apiKey.trim();

  const polling = useSuggestionsPolling();
  const chat = useChatStream();

  // Tracks whether we've already kicked off the first-chunk suggestion
  // refresh for this recording session. Reset each time the mic starts.
  const firstChunkFiredRef = useRef(false);
  // `polling.refresh` is stable — captured via ref so onChunk's deps stay tight.
  const refreshRef = useRef(polling.refresh);
  refreshRef.current = polling.refresh;

  const onChunk = useCallback(
    async ({
      blob,
      startedAt,
      mimeType,
    }: {
      blob: Blob;
      startedAt: string;
      mimeType: string;
    }) => {
      if (!hasKey) return; // hard-gate: don't upload without a key
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      try {
        const text = await transcribeAudio({
          apiKey: state.apiKey,
          audio: blob,
          filename: `chunk.${ext}`,
        });
        if (!text || isHallucination(text)) return;
        dispatch({
          type: "appendTranscript",
          line: {
            id: makeId("seg"),
            text,
            startedAt,
            receivedAt: new Date().toISOString(),
          },
        });
        dispatch({ type: "setError", error: null });
        // First usable transcript line landed — fire suggestions immediately
        // instead of waiting up to another 30s for the polling interval.
        if (!firstChunkFiredRef.current) {
          firstChunkFiredRef.current = true;
          void refreshRef.current();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: "setError", error: `Transcription failed: ${msg}` });
      }
    },
    [hasKey, state.apiKey, dispatch]
  );

  const { isRecording, start, stop, flushNow } = useMediaRecorder({
    onChunk,
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: "setError", error: `Mic error: ${msg}` });
      dispatch({ type: "setRecording", recording: false });
    },
  });

  const toggleMic = useCallback(async () => {
    if (isRecording) {
      stop();
      dispatch({ type: "setRecording", recording: false });
      return;
    }
    if (!hasKey) {
      setSettingsOpen(true);
      return;
    }
    firstChunkFiredRef.current = false;
    await start();
    dispatch({ type: "setRecording", recording: true });
  }, [isRecording, hasKey, start, stop, dispatch]);

  const onReload = useCallback(async () => {
    // Per Ask.md: manual refresh updates transcript THEN suggestions. If mic is
    // live, flush the in-flight audio chunk (stop/restart the recorder now so
    // the last 0–30s reach Groq) before asking for fresh suggestions.
    if (isRecording) {
      try {
        await flushNow();
      } catch {
        /* fall through to refresh — stale transcript is better than no refresh */
      }
    }
    await polling.refresh();
  }, [isRecording, flushNow, polling]);

  const onSuggestionClick = useCallback(
    (s: Suggestion) => {
      void chat.send({ question: s.preview, suggestion: s });
    },
    [chat]
  );

  const onChatSend = useCallback(
    (text: string) => {
      void chat.send({ question: text });
    },
    [chat]
  );

  return (
    <>
      <TopBar
        title="TwinMind — Live Suggestions"
        meta={
          state.lastError
            ? state.lastError
            : "Transcript · Live Suggestions · Chat"
        }
        onOpenSettings={() => setSettingsOpen(true)}
        exportSlot={<ExportButton />}
      />
      <div className={styles.layout}>
        <TranscriptPanel
          transcript={state.transcript}
          recording={isRecording}
          onToggleMic={toggleMic}
          showApiKeyBanner={state.hydrated && !hasKey}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SuggestionsPanel
          batches={state.batches}
          countdown={state.countdown}
          loading={polling.loading}
          canRefresh={polling.canRefresh}
          onReload={onReload}
          onSuggestionClick={onSuggestionClick}
        />
        <ChatPanel
          messages={state.chat}
          disabled={!hasKey || chat.busy}
          onSend={onChatSend}
          showApiKeyBanner={state.hydrated && !hasKey}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
      <SettingsModal
        open={settingsOpen}
        initialApiKey={state.apiKey}
        initialSettings={state.settings}
        onClose={() => setSettingsOpen(false)}
        onSave={({ apiKey, settings }) => {
          dispatch({ type: "setApiKey", apiKey });
          dispatch({ type: "setSettings", settings });
          setSettingsOpen(false);
        }}
      />
    </>
  );
}
