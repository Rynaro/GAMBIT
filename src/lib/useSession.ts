// useSession.ts — React hook that drives a live, multi-turn Eidolon session.
//
// Unlike `useSync` (a one-shot process whose completion is terminal), an
// Eidolon session is ALIVE across many turns: a turn completing does NOT end
// the session — it returns to `awaiting-input`, ready for the next `sendTurn`.
//
// State machine (non-terminal "alive" design):
//   idle           — no session
//   launching      — start_session invoked, turn 1 spawning
//   turn-running   — a turn is in flight, session-events arriving
//   awaiting-input — turn finished, session still alive, ready for next turn
//   ended          — session closed cleanly (reserved; clear() returns to idle)
//   failed         — a turn finished in error (terminal)
//
//   launching ─┐
//   awaiting-input ─┴─ sendTurn ─▶ turn-running ─▶ awaiting-input (success)
//                                              └─▶ failed         (isError)
//
// IPC contract (4 commands, 3 events) — see session.rs / session.types.ts:
//   Events  : session-event         SessionEventPayload
//             session-stderr        SessionStderrPayload
//             session-turn-complete SessionTurnCompletePayload
//   Commands: start_session   (params: StartSessionParams) → SessionInfo
//             send_turn       (sessionId, prompt)          → void
//             cancel_session  (sessionId)                  → void
//             claude_auth_status ()                        → AuthStatus
//
// Mirrors `useSync`'s structure: append-only accumulation, `unlistenRefs` +
// `detachListeners`, listeners attached BEFORE `invoke` (the event-race fix),
// cleanup on unmount, `sonner` toasts.

import type {
  AuthStatus,
  ParsedEvent,
  SessionEventPayload,
  SessionInfo,
  SessionStderrPayload,
  SessionTurnCompletePayload,
  StartSessionParams,
} from "@/lib/session.types";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionState =
  | "idle"
  | "launching"
  | "turn-running"
  | "awaiting-input"
  | "ended"
  | "failed";

/**
 * One entry in the append-only session transcript.
 *
 * Two source kinds:
 *   - `event`  — a parsed `session-event` line; `parsed` + `kind` are set,
 *                `line` is the raw NDJSON.
 *   - `stderr` — a `session-stderr` diagnostics line; `line` is the text,
 *                `parsed` / `kind` are absent.
 *
 * `turn` is a per-turn grouping marker (1-based): every entry produced while a
 * given turn is in flight carries that turn's number, so S7 can render the
 * conversation grouped by turn.
 */
export interface TranscriptEntry {
  /** Source channel of this entry. */
  source: "event" | "stderr";
  /** 1-based turn number this entry belongs to. */
  turn: number;
  /** Stable lowercase discriminator for `event` entries (`init` / `result` / …). */
  kind?: string;
  /** The typed parsed event — present on `event` entries. */
  parsed?: ParsedEvent;
  /** Raw text: the NDJSON line (`event`) or the stderr line (`stderr`). */
  line: string;
  /** RFC-3339 timestamp from the Rust side. */
  ts: string;
}

export interface UseSessionResult {
  /** Current session state-machine state. */
  status: SessionState;
  /** Append-only transcript of every event + stderr line seen. */
  transcript: TranscriptEntry[];
  /** Descriptor returned by `start_session`; null until a session opens. */
  sessionInfo: SessionInfo | null;
  /** Result of the last `checkAuth()`; null until first checked. */
  authStatus: AuthStatus | null;
  /** Open a new session and spawn turn 1. */
  start: (params: StartSessionParams) => void;
  /** Send a follow-up turn (only meaningful from `awaiting-input`). */
  sendTurn: (prompt: string) => void;
  /** Cancel the in-flight turn (SIGKILL). */
  cancel: () => void;
  /** Run the `claude` login pre-flight; updates `authStatus`. */
  checkAuth: () => void;
  /** Tear everything down and reset to `idle`. */
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSession(): UseSessionResult {
  const [status, setStatus] = useState<SessionState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // The session id currently being driven — used to filter incoming events so
  // a stale session's events cannot leak into a freshly-started one.
  const sessionIdRef = useRef<string | null>(null);
  // 1-based turn counter — the per-turn grouping marker on each TranscriptEntry.
  const turnRef = useRef<number>(0);

  // Unlisten refs — cleaned up when a new session starts, on clear, on unmount.
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  /** Remove all active Tauri event listeners. */
  function detachListeners() {
    for (const fn of unlistenRefs.current) {
      fn();
    }
    unlistenRefs.current = [];
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      detachListeners();
    };
  }, []);

  /**
   * Attach the three session-event listeners. Called BEFORE `start_session` is
   * invoked so events emitted before the listener registers are not dropped
   * (the `useSync` race fix). Events are filtered by `sessionId` against
   * `sessionIdRef` so a stale session's stream cannot leak in.
   */
  async function attachListeners() {
    const unlistenEvent = await listen<SessionEventPayload>("session-event", (ev) => {
      if (ev.payload.sessionId !== sessionIdRef.current) return;
      setTranscript((prev) => [
        ...prev,
        {
          source: "event",
          turn: turnRef.current,
          kind: ev.payload.kind,
          parsed: ev.payload.parsed,
          line: ev.payload.raw,
          ts: ev.payload.ts,
        },
      ]);
    });

    const unlistenStderr = await listen<SessionStderrPayload>("session-stderr", (ev) => {
      if (ev.payload.sessionId !== sessionIdRef.current) return;
      setTranscript((prev) => [
        ...prev,
        {
          source: "stderr",
          turn: turnRef.current,
          line: ev.payload.line,
          ts: ev.payload.ts,
        },
      ]);
    });

    const unlistenComplete = await listen<SessionTurnCompletePayload>(
      "session-turn-complete",
      (ev) => {
        if (ev.payload.sessionId !== sessionIdRef.current) return;

        // R6 dual-finalize: a turn finalises on EITHER a terminal `result`
        // event OR a clean process exit. `isError` already folds both signals
        // (non-zero exit OR a `result` with isError) on the Rust side — we
        // trust it for the success/failure split. `hadResult` is surfaced for
        // diagnostics: a clean turn that exited WITHOUT a `result` event
        // (hadResult === false — the known claude-code dropped-result bug)
        // still transitions to `awaiting-input` exactly like one that did.
        const { exitCode, hadResult, isError } = ev.payload;

        if (isError) {
          setStatus("failed");
          toast.error("Turn failed", {
            description: `exit ${exitCode}`,
            duration: Number.POSITIVE_INFINITY,
          });
          return;
        }

        // Success — the session stays alive, ready for the next turn.
        setStatus("awaiting-input");
        toast.success("Turn complete", {
          description: hadResult ? "result received" : "process exited cleanly",
        });
      },
    );

    unlistenRefs.current = [unlistenEvent, unlistenStderr, unlistenComplete];
  }

  const start = useCallback((params: StartSessionParams) => {
    // Tear down any previous session's listeners before attaching new ones.
    detachListeners();

    sessionIdRef.current = null;
    turnRef.current = 1;
    setStatus("launching");
    setTranscript([]);
    setSessionInfo(null);

    async function run() {
      // Attach listeners BEFORE invoking start_session to avoid the race where
      // session-events arrive before we register (the useSync fix).
      await attachListeners();

      try {
        const info = await invoke<SessionInfo>("start_session", { params });
        // Now that we have the host-generated id, events for this session can
        // be matched; earlier events (if any) were emitted with this same id.
        sessionIdRef.current = info.sessionId;
        setSessionInfo(info);
        setStatus("turn-running");
      } catch (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        setTranscript((prev) => [
          ...prev,
          {
            source: "stderr",
            turn: turnRef.current,
            line: `[gambit] error: ${msg}`,
            ts: new Date().toISOString(),
          },
        ]);
        setStatus("failed");
        detachListeners();
        toast.error("Session failed to start", {
          description: msg,
          duration: Number.POSITIVE_INFINITY,
        });
      }
    }

    void run();
  }, []);

  const sendTurn = useCallback((prompt: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      console.warn("[useSession] sendTurn called with no active session");
      return;
    }

    // A new turn — bump the grouping marker and re-enter turn-running.
    turnRef.current += 1;
    setStatus("turn-running");

    invoke("send_turn", { sessionId, prompt }).catch((err) => {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      setTranscript((prev) => [
        ...prev,
        {
          source: "stderr",
          turn: turnRef.current,
          line: `[gambit] error: ${msg}`,
          ts: new Date().toISOString(),
        },
      ]);
      setStatus("failed");
      toast.error("Turn failed to start", {
        description: msg,
        duration: Number.POSITIVE_INFINITY,
      });
    });
  }, []);

  const cancel = useCallback(() => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    invoke("cancel_session", { sessionId }).catch((err) => {
      console.warn("[useSession] cancel_session failed:", err);
    });
    // The kill makes the in-flight turn finalise with the cancel sentinel
    // (exit -2 → isError), so session-turn-complete will move us to `failed`.
    toast.info("Turn cancelled");
  }, []);

  const checkAuth = useCallback(() => {
    invoke<AuthStatus>("claude_auth_status")
      .then((result) => {
        setAuthStatus(result);
      })
      .catch((err) => {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.warn("[useSession] claude_auth_status failed:", err);
        setAuthStatus({ loggedIn: false, detail: msg });
      });
  }, []);

  const clear = useCallback(() => {
    detachListeners();
    sessionIdRef.current = null;
    turnRef.current = 0;
    setStatus("idle");
    setTranscript([]);
    setSessionInfo(null);
  }, []);

  return {
    status,
    transcript,
    sessionInfo,
    authStatus,
    start,
    sendTurn,
    cancel,
    checkAuth,
    clear,
  };
}
