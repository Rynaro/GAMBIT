// useSession.ts — per-session SELECTOR over the multi-session `useSessions`
// store (story S2).
//
// v0.3.0's `useSession` was a SINGLE-session hook: it owned all session state
// and `start()` wiped any prior session. Worse, it was mounted INSIDE
// `SessionsRoute`, so a route change unmounted it and destroyed the transcript
// (the route-change transcript-loss TODAY-bug, FINDING-016).
//
// Story S2 moves the actual state into `useSessions` — a store lifted to the
// App shell. `useSession` is now a thin SELECTOR: given the store and a
// session id, it projects that session's slice + bound actions into the
// stable `UseSessionResult` shape the v0.3.0 component code already consumes,
// so `SessionsRoute` migrates with minimal churn.
//
// `SessionState` and `TranscriptEntry` are still defined here — they are the
// shared session vocabulary imported across the route + the store + the
// session components.

import type { AuthStatus, ParsedEvent, SessionInfo, StartSessionParams } from "@/lib/session.types";
import type { SessionLiveState, UseSessionsResult } from "@/lib/useSessions";
import { EMPTY_LIVE_STATE } from "@/lib/useSessions";

// ---------------------------------------------------------------------------
// Shared session vocabulary
// ---------------------------------------------------------------------------

/**
 * The per-session state machine (non-terminal "alive" design):
 *   idle           — no session
 *   launching      — start_session invoked, turn 1 spawning
 *   turn-running   — a turn is in flight, session-events arriving
 *   awaiting-input — turn finished, session still alive, ready for next turn
 *   ended          — session closed cleanly (reserved)
 *   failed         — a turn finished in error
 */
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
 * Three source kinds:
 *   - `event`  — a parsed `session-event` line; `parsed` + `kind` are set,
 *                `line` is the raw NDJSON.
 *   - `stderr` — a `session-stderr` diagnostics line; `line` is the text,
 *                `parsed` / `kind` are absent.
 *   - `prompt` — the human's own typed prompt for the turn (R4); `line` is the
 *                raw prompt text, `parsed` / `kind` are absent. Appended on
 *                turn dispatch (live) and persisted as a `PersistedEntry` so a
 *                reopened session still shows what the user asked.
 *
 * `turn` is a per-turn grouping marker (1-based) so the conversation can be
 * rendered grouped by turn — a `prompt` entry heads its turn group.
 */
export interface TranscriptEntry {
  /** Source channel of this entry. */
  source: "event" | "stderr" | "prompt";
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

// ---------------------------------------------------------------------------
// Selector result — the stable single-session view
// ---------------------------------------------------------------------------

/**
 * The per-session view `SessionsRoute` consumes — the v0.3.0 `useSession`
 * surface, now projected out of the `useSessions` store slice.
 */
export interface UseSessionResult {
  /** Current session state-machine state (`idle` when no session selected). */
  status: SessionState;
  /** Append-only transcript of every event + stderr line seen. */
  transcript: TranscriptEntry[];
  /** Descriptor for the selected session; null when none is selected. */
  sessionInfo: SessionInfo | null;
  /**
   * EPHEMERAL live state for the in-flight turn (story S6/S7) — streaming
   * assistant text, live tool calls, mid-turn usage. Empty when idle.
   */
  live: SessionLiveState;
  /** Result of the last `checkAuth()`; null until first checked. */
  authStatus: AuthStatus | null;
  /** Open a new session and spawn turn 1 (adds to the store). */
  start: (params: StartSessionParams) => void;
  /** Send a follow-up turn on the selected session. */
  sendTurn: (prompt: string) => void;
  /** Cancel the in-flight turn of the selected session (SIGKILL). */
  cancel: () => void;
  /** Run the `claude` login pre-flight; updates `authStatus`. */
  checkAuth: () => void;
}

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

/**
 * Project the `useSessions` store down to a single session's `UseSessionResult`
 * view.
 *
 * `sessionId` is the session to select; pass `null` for the "no session yet"
 * case (the route's pre-launch panel) — `status` is then `idle`, `transcript`
 * empty, `sessionInfo` null, but the actions are still bound (`start` opens a
 * fresh session, `checkAuth` runs the pre-flight).
 *
 * This is a pure projection — it holds no state of its own. The store lives in
 * the App shell, so the transcript survives a route change (the structural fix
 * for the v0.3.0 transcript-loss bug).
 */
export function useSession(store: UseSessionsResult, sessionId: string | null): UseSessionResult {
  const slice = sessionId ? store.sessions[sessionId] : undefined;

  return {
    status: slice?.status ?? "idle",
    transcript: slice?.transcript ?? [],
    sessionInfo: slice?.sessionInfo ?? null,
    live: slice?.live ?? EMPTY_LIVE_STATE,
    authStatus: store.authStatus,
    start: (params: StartSessionParams) => {
      void store.start(params);
    },
    sendTurn: (prompt: string) => {
      if (!sessionId) {
        console.warn("[useSession] sendTurn with no selected session");
        return;
      }
      store.sendTurn(sessionId, prompt);
    },
    cancel: () => {
      if (!sessionId) return;
      store.cancel(sessionId);
    },
    checkAuth: store.checkAuth,
  };
}
