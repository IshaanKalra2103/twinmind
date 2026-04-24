"use client";

import {
  createContext,
  Dispatch,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { DEFAULT_SETTINGS } from "./defaults";
import type {
  SessionAction,
  SessionState,
  Settings,
} from "@/types/session";

const KEY_APIKEY = "twinmind.apiKey";
const KEY_SETTINGS = "twinmind.settings";

export const INITIAL_STATE: SessionState = {
  apiKey: "",
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  isRecording: false,
  transcript: [],
  batches: [],
  chat: [],
  countdown: 30,
  lastError: null,
};

export function sessionReducer(
  state: SessionState,
  action: SessionAction
): SessionState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        apiKey: action.apiKey,
        settings: action.settings,
        hydrated: true,
      };
    case "setApiKey":
      return { ...state, apiKey: action.apiKey };
    case "setSettings":
      return { ...state, settings: action.settings };
    case "setRecording":
      return { ...state, isRecording: action.recording };
    case "appendTranscript":
      return { ...state, transcript: [...state.transcript, action.line] };
    case "addBatch":
      return {
        ...state,
        // Mark prior batches' suggestions as stale; newest at index 0.
        batches: [
          action.batch,
          ...state.batches.map((b) => ({
            ...b,
            suggestions: b.suggestions.map((s) => ({ ...s, fresh: false })),
          })),
        ],
      };
    case "markSuggestionClicked":
      return {
        ...state,
        batches: state.batches.map((b) => ({
          ...b,
          suggestions: b.suggestions.map((s) =>
            s.id === action.suggestionId ? { ...s, clicked: true } : s
          ),
        })),
      };
    case "tickCountdown":
      return {
        ...state,
        countdown: state.countdown <= 1 ? 30 : state.countdown - 1,
      };
    case "resetCountdown":
      return { ...state, countdown: action.seconds ?? 30 };
    case "addChatMessage":
      return { ...state, chat: [...state.chat, action.message] };
    case "appendToAssistant":
      return {
        ...state,
        chat: state.chat.map((m) =>
          m.id === action.messageId
            ? { ...m, content: m.content + action.delta }
            : m
        ),
      };
    case "finishAssistant":
      return {
        ...state,
        chat: state.chat.map((m) =>
          m.id === action.messageId
            ? { ...m, streaming: false, error: action.error ?? null }
            : m
        ),
      };
    case "setError":
      return { ...state, lastError: action.error };
    default:
      return state;
  }
}

interface ContextValue {
  state: SessionState;
  dispatch: Dispatch<SessionAction>;
}
const SessionContext = createContext<ContextValue | null>(null);

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge so newly-added defaults (e.g. a new prompt) show up for old users.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, INITIAL_STATE);

  // Hydrate persisted slices AFTER mount — SSR-safe.
  useEffect(() => {
    const apiKey = localStorage.getItem(KEY_APIKEY) ?? "";
    const settings = readSettings();
    dispatch({ type: "hydrate", apiKey, settings });
  }, []);

  // Persist writes — but only once hydrated, so we don't clobber with initial.
  useEffect(() => {
    if (!state.hydrated) return;
    try {
      localStorage.setItem(KEY_APIKEY, state.apiKey);
    } catch {
      /* quota / private mode — ignore */
    }
  }, [state.apiKey, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    try {
      localStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings));
    } catch {
      /* ignore */
    }
  }, [state.settings, state.hydrated]);

  const value = useMemo<ContextValue>(() => ({ state, dispatch }), [state]);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): ContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx)
    throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
