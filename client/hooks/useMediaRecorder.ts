"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 30s stop/restart cycle per decision-004. Each emitted blob is a standalone
 * valid webm/opus (or mp4 on Safari). Permission is held by the `MediaStream`,
 * so we keep that alive across restarts to avoid a re-prompt per cycle.
 */

export interface MediaRecorderChunk {
  blob: Blob;
  startedAt: string;
  mimeType: string;
}

export interface UseMediaRecorderOptions {
  chunkMs?: number; // default 30000
  onChunk: (chunk: MediaRecorderChunk) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4", // Safari
  "audio/ogg;codecs=opus",
];

function pickMime(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

export function useMediaRecorder({
  chunkMs = 30_000,
  onChunk,
  onError,
}: UseMediaRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleStartedAtRef = useRef<string | null>(null);
  const activeRef = useRef(false); // sync flag for async callbacks

  const clearTimer = () => {
    if (cycleTimerRef.current) {
      clearTimeout(cycleTimerRef.current);
      cycleTimerRef.current = null;
    }
  };

  const teardownRecorder = () => {
    clearTimer();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  };

  const teardownStream = () => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) s.getTracks().forEach((t) => t.stop());
  };

  const startCycle = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !activeRef.current) return;

    const mimeType = pickMime();
    let rec: MediaRecorder;
    try {
      rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      onError?.(err);
      activeRef.current = false;
      setIsRecording(false);
      teardownStream();
      return;
    }

    const chunks: BlobPart[] = [];
    const startedAt = new Date().toISOString();
    cycleStartedAtRef.current = startedAt;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    rec.onstop = () => {
      const blob = new Blob(chunks, {
        type: rec.mimeType || mimeType || "audio/webm",
      });
      if (blob.size > 0) {
        void Promise.resolve(
          onChunk({
            blob,
            startedAt,
            mimeType: blob.type,
          })
        ).catch((err) => onError?.(err));
      }
      // If still active, start the next cycle immediately.
      if (activeRef.current) startCycle();
    };

    rec.onerror = (e) => onError?.(e);

    recorderRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      onError?.(err);
      return;
    }

    // Schedule the stop that flushes this cycle's chunk.
    cycleTimerRef.current = setTimeout(() => {
      if (rec.state !== "inactive") {
        try {
          rec.stop();
        } catch (err) {
          onError?.(err);
        }
      }
    }, chunkMs);
  }, [chunkMs, onChunk, onError]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      activeRef.current = true;
      setIsRecording(true);
      startCycle();
    } catch (err) {
      onError?.(err);
      activeRef.current = false;
      setIsRecording(false);
    }
  }, [startCycle, onError]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setIsRecording(false);
    teardownRecorder();
    teardownStream();
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      teardownRecorder();
      teardownStream();
    };
  }, []);

  return { isRecording, start, stop };
}
