// useSessions.ts — multi-session store for live + persisted Eidolon sessions.
//
// Story S2 replaces the v0.3.0 SINGLE-session `useSession` hook (which held
// exactly one session and whose `start()` wiped prior state) with a store
// that holds N sessions keyed by `sessionId`. It is lifted to the App shell
// (mirroring `useDoctor` / `useMcpStore`) and prop-drilled into the router.
//
// WHY the lift fixes a TODAY-bug:
//   `useSession` was mounted INSIDE `SessionsRoute`. Navigating away unmounts
//   the route, which unmounts the hook, which DESTROYS the transcript — even
//   without an app restart (FINDING-016). With the store living ABOVE the
//   router, a route change unmounts only the route's view; the store and every
//   session's transcript persist in the App shell. This is a structural fix:
//   the bug cannot recur because the state no longer lives in the route.
//
// State machine per session (the v0.3.0 "alive" machine, now keyed by id):
//   idle           — slot reserved, nothing started (transient)
//   launching      — start_session invoked, turn 1 spawning
//   turn-running   — a turn is in flight, session-events arriving
//   awaiting-input — turn finished / rehydrated, ready for the next turn
//   ended          — session closed cleanly (reserved)
//   failed         — a turn finished in error
//
// IPC contract (mirrors session.rs / session_store.rs):
//   Events  : session-event / session-stderr / session-turn-complete, plus
//             session-delta / session-tool-start / session-usage (story
//             S6/S7) — six listeners, all attached ONCE for the store's
//             lifetime; each handler routes the payload to
//             map[payload.sessionId]. Rust events already carry sessionId
//             (FINDING-013), so no single-session filter.
//
// EPHEMERAL live state (story S6/S7):
//   session-delta / session-tool-start / session-usage feed a per-session
//   `live` slice (streaming text + live tool calls + mid-turn usage). It is
//   NOT part of the durable SessionRecord and is CLEARED wholesale on
//   session-turn-complete — the persisted assistant/user/result entries are
//   then the single source of truth (no double-rendered text).
//   Commands: start_session   (params)            → SessionInfo
//             send_turn       (sessionId, prompt)  → void
//             reopen_session  (sessionId)          → SessionInfo
//             cancel_session  (sessionId)          → void
//             claude_auth_status ()                → AuthStatus
//             list_sessions   ()                   → SessionSummary[]
//             load_session    (sessionId)          → SessionRecord
//             delete_session  (sessionId)          → void
//
// Conventions kept from `useSession`: listeners-before-invoke race fix, sonner
// toasts, cleanup on unmount.

import type {
  AuthStatus,
  PersistedEntry,
  SessionDeltaPayload,
  SessionEventPayload,
  SessionInfo,
  SessionRecord,
  SessionStderrPayload,
  SessionSummary,
  SessionToolStartPayload,
  SessionTurnCompletePayload,
  SessionUsagePayload,
  StartSessionParams,
} from "@/lib/session.types";
import type { SessionState as SessionMachineState, TranscriptEntry } from "@/lib/useSession";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One live tool call observed mid-turn from `session-tool-start` /
 * `session-delta(toolInput)` (story S6).
 *
 * EPHEMERAL: held only for the in-flight turn and cleared on
 * `session-turn-complete`. `running` flips to `false` once the paired
 * `tool_result` lands in the persisted transcript (`toolUseId` ↔
 * `tool_result.toolUseId`) — the UI resolves the chip from there.
 */
export interface LiveToolCall {
  /** The `tool_use` id — pairs with the eventual `tool_result.toolUseId`. */
  toolUseId: string;
  /** The tool name. */
  toolName: string;
  /** The content-block index — `toolInput` deltas are matched on this. */
  blockIndex: number;
  /** Non-null when this is self-routed-subagent work (renders nested). */
  parentToolUseId: string | null;
  /** Epoch-ms the tool call started — drives the elapsed-time readout. */
  startedAt: number;
  /** Accumulated `partial_json` input fragments (best-effort, may be partial). */
  partialInput: string;
}

/**
 * The EPHEMERAL per-session live state for the in-flight turn (story S6/S7).
 *
 * NOT part of the durable `SessionRecord` and NOT persisted: it is populated
 * from the `session-delta` / `session-tool-start` / `session-usage` events
 * and CLEARED wholesale on `session-turn-complete`. After a turn finishes the
 * persisted `assistant` / `user` / `result` `session-event` entries are the
 * single source of truth — so the streamed text does not double-render.
 */
export interface SessionLiveState {
  /** The turn these live fragments belong to (`0` when idle / cleared). */
  turn: number;
  /** Accumulated streaming assistant text for the in-flight turn. */
  streamingText: string;
  /** Live tool calls keyed by `toolUseId`. */
  toolCalls: Record<string, LiveToolCall>;
  /** The latest mid-turn `usage` preview (story S7); `null` until one lands. */
  usage: SessionUsagePayload | null;
}

/** The empty live state — a freshly-idle or just-completed turn. */
export const EMPTY_LIVE_STATE: SessionLiveState = {
  turn: 0,
  streamingText: "",
  toolCalls: {},
  usage: null,
};

/**
 * The per-session slice held in the store's map.
 *
 * These are the old `useSession` singletons (`status` / `transcript` /
 * `sessionInfo`) now keyed by `sessionId`, plus the bookkeeping the store
 * needs: the next turn number and whether the full transcript has been
 * lazily loaded from disk yet.
 */
export interface SessionSlice {
  /** The session's stable UUID address. */
  sessionId: string;
  /** State-machine state for this session. */
  status: SessionMachineState;
  /** Append-only transcript of every event + stderr line seen. */
  transcript: TranscriptEntry[];
  /**
   * The session descriptor. Populated by `start_session` / `reopen_session`;
   * for a summary-only (not-yet-opened) session it is synthesised from the
   * `SessionSummary` so the rail can render it before the full record loads.
   */
  sessionInfo: SessionInfo | null;
  /** The list-view summary — present for every persisted session. */
  summary: SessionSummary | null;
  /** 1-based turn counter — the per-turn grouping marker on TranscriptEntry. */
  turn: number;
  /**
   * `true` once `load_session` has rehydrated this session's full transcript
   * from disk. Summary-only sessions are `false` until first opened.
   */
  hydrated: boolean;
  /**
   * EPHEMERAL live state for the in-flight turn (story S6/S7) — streaming
   * text, live tool calls, the latest mid-turn usage. NOT persisted; CLEARED
   * on `session-turn-complete`. See {@link SessionLiveState}.
   */
  live: SessionLiveState;
}

/** A record of session slices keyed by `sessionId`. */
export type SessionMap = Record<string, SessionSlice>;

export interface UseSessionsResult {
  /** Every known session — live, persisted, or summary-only — keyed by id. */
  sessions: SessionMap;
  /** `true` until the initial `list_sessions` rehydration completes. */
  rehydrating: boolean;
  /** Result of the last `checkAuth()`; shared across all sessions. */
  authStatus: AuthStatus | null;
  /**
   * The Eidolon name a Roster "Launch" click pre-selects in the route's
   * pre-launch picker — replaces the v0.2 `pendingSessionEidolon` prop.
   */
  pendingEidolon: string | null;
  /** Stash an Eidolon name for the Sessions route to pre-select. */
  setPendingEidolon: (name: string | null) => void;
  /** Open a NEW session and spawn turn 1 — ADDS to the map, wipes nothing. */
  start: (params: StartSessionParams) => Promise<string | null>;
  /** Send a follow-up turn on an existing session. */
  sendTurn: (sessionId: string, prompt: string) => void;
  /** Cancel the in-flight turn of a session (SIGKILL). */
  cancel: (sessionId: string) => void;
  /** Re-insert a persisted session as a live handle + rehydrate its transcript. */
  reopen: (sessionId: string) => Promise<void>;
  /** Remove a session — deletes its on-disk record and drops it from the map. */
  remove: (sessionId: string) => Promise<void>;
  /** Run the `claude` login pre-flight; updates `authStatus`. */
  checkAuth: () => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Rebuild an in-memory `TranscriptEntry[]` from a record's `PersistedEntry[]`.
 *
 * The persisted shape is camelCase-compatible by design (story S1), so this is
 * a near-identity projection — it just narrows `source` / `kind` to the
 * `TranscriptEntry` types and drops the `null`s `serde` may emit.
 */
function transcriptFromPersisted(entries: PersistedEntry[]): TranscriptEntry[] {
  return entries.map((e) => {
    // R4: a `prompt` PersistedEntry (the user's typed turn prompt) maps to a
    // `prompt` TranscriptEntry — the SAME shape `start` / `sendTurn` append
    // live, so a reopened session does not duplicate or mis-render it.
    const source: TranscriptEntry["source"] =
      e.source === "stderr" ? "stderr" : e.source === "prompt" ? "prompt" : "event";
    return {
      source,
      turn: e.turn,
      kind: e.kind ?? undefined,
      parsed: e.parsed ?? undefined,
      line: e.line,
      ts: e.ts,
    };
  });
}

/** Build a `prompt` transcript entry for a turn's typed user prompt (R4). */
function promptEntry(turn: number, prompt: string): TranscriptEntry {
  return { source: "prompt", turn, line: prompt, ts: new Date().toISOString() };
}

/**
 * Apply a `session-delta` to a session slice's EPHEMERAL live state (S6/S7).
 *
 * A `text` delta appends to the streaming-text buffer; a `toolInput` delta
 * appends its `partialJson` fragment onto the matching live tool call (matched
 * by `blockIndex` — the `tool_use` id is only on the paired tool-start). The
 * persisted `transcript` is never touched: a delta is purely live state.
 *
 * Defensive against turn skew: a delta whose `turn` is older than the live
 * state's turn is ignored (a late straggler from a finished turn).
 */
export function applyDelta(slice: SessionSlice, payload: SessionDeltaPayload): SessionSlice {
  // Drop a straggler from an already-cleared / older turn.
  if (slice.live.turn !== 0 && payload.turn < slice.live.turn) return slice;
  // A delta for a turn the live state has not opened yet adopts that turn.
  const turn = Math.max(slice.live.turn, payload.turn);

  if (payload.deltaKind === "text") {
    return {
      ...slice,
      live: {
        ...slice.live,
        turn,
        streamingText: slice.live.streamingText + (payload.text ?? ""),
      },
    };
  }

  if (payload.deltaKind === "toolInput") {
    // Match the tool call by block index — the toolUseId rides on tool-start.
    const idx = payload.blockIndex ?? -1;
    const entry = Object.entries(slice.live.toolCalls).find(([, call]) => call.blockIndex === idx);
    if (!entry) return { ...slice, live: { ...slice.live, turn } };
    const [id, call] = entry;
    return {
      ...slice,
      live: {
        ...slice.live,
        turn,
        toolCalls: {
          ...slice.live.toolCalls,
          [id]: { ...call, partialInput: call.partialInput + (payload.partialJson ?? "") },
        },
      },
    };
  }

  // An unmodelled deltaKind — keep the slice unchanged.
  return slice;
}

/**
 * Apply a `session-tool-start` to a session slice's live state (story S6).
 *
 * Registers a new {@link LiveToolCall} keyed by `toolUseId` so the UI can show
 * a running chip; `parentToolUseId` marks self-routed-subagent work.
 */
export function applyToolStart(
  slice: SessionSlice,
  payload: SessionToolStartPayload,
): SessionSlice {
  if (slice.live.turn !== 0 && payload.turn < slice.live.turn) return slice;
  const turn = Math.max(slice.live.turn, payload.turn);
  return {
    ...slice,
    live: {
      ...slice.live,
      turn,
      toolCalls: {
        ...slice.live.toolCalls,
        [payload.toolUseId]: {
          toolUseId: payload.toolUseId,
          toolName: payload.toolName,
          blockIndex: payload.blockIndex,
          parentToolUseId: payload.parentToolUseId ?? null,
          startedAt: Date.now(),
          partialInput: "",
        },
      },
    },
  };
}

/**
 * Whether a rehydrated session's last turn never finalised.
 *
 * Restart rule (R-PARTIAL-TURN): a session whose LAST per-turn entry has
 * `resultSeen: false` (a turn that never finalised — crash / SIGKILL / dropped
 * result) is a "mid-turn" session. It is offered a FRESH continuation, never
 * "restored mid-turn": the slice lands in `awaiting-input` with its partial
 * transcript shown read-only, and the next `send_turn` issues a clean
 * `--resume`. This predicate exists so callers / tests can assert the rule.
 */
export function lastTurnUnfinalised(record: SessionRecord): boolean {
  const last = record.perTurn[record.perTurn.length - 1];
  return last !== undefined && last.resultSeen === false;
}

/**
 * Decide a rehydrated session's state-machine state from its record.
 *
 * A rehydrated session is ALWAYS `awaiting-input` — ready for a fresh turn,
 * with any partial transcript shown as read-only history. A live `running`
 * turn cannot survive a process restart, and a `resultSeen: false` last turn
 * is explicitly offered a fresh continuation rather than "restored mid-turn"
 * (see `lastTurnUnfinalised`). `record` is taken so the rule is documented at
 * the call site even though the verdict is currently uniform.
 */
function rehydratedStatus(record: SessionRecord): SessionMachineState {
  // Touch the partial-turn signal so the restart rule is explicit here.
  void lastTurnUnfinalised(record);
  return "awaiting-input";
}

/** Synthesise a minimal `SessionInfo` from a list-view `SessionSummary`. */
function infoFromSummary(s: SessionSummary): SessionInfo {
  return {
    sessionId: s.uuid,
    eidolonName: s.eidolonName,
    // projectPath rides the summary (story S3) so the rail / cwd-resolution
    // can read it pre-open; permissionMode is still filled by `load_session`.
    projectPath: s.projectPath,
    permissionMode: "",
    status: s.status,
    createdAt: s.createdAt,
    isCortex: s.isCortex,
  };
}

/** Synthesise a full `SessionInfo` from a loaded `SessionRecord`. */
function infoFromRecord(r: SessionRecord): SessionInfo {
  return {
    sessionId: r.uuid,
    eidolonName: r.eidolonName,
    projectPath: r.projectPath,
    permissionMode: r.permissionMode,
    status: r.status,
    createdAt: r.createdAt,
    isCortex: r.isCortex,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionMap>({});
  const [rehydrating, setRehydrating] = useState<boolean>(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [pendingEidolon, setPendingEidolon] = useState<string | null>(null);

  // Per-session 1-based turn counters. A ref (not state) because the once-only
  // event listeners read it synchronously when stamping a TranscriptEntry — a
  // state read would close over a stale value.
  const turnRefs = useRef<Record<string, number>>({});

  // Unlisten refs — the 6 store-lifetime listeners, detached only on unmount.
  const unlistenRefs = useRef<UnlistenFn[]>([]);
  // Guards the once-only listener attach against React 18 StrictMode's
  // double-invoked mount effect.
  const listenersAttached = useRef<boolean>(false);

  /** Remove all active Tauri event listeners. */
  const detachListeners = useCallback(() => {
    for (const fn of unlistenRefs.current) {
      fn();
    }
    unlistenRefs.current = [];
  }, []);

  /**
   * Mutate one session's slice in the map. A no-op if the id is unknown —
   * an event for a session not in the map (e.g. deleted mid-turn) is dropped.
   */
  const patchSession = useCallback(
    (sessionId: string, patch: (slice: SessionSlice) => SessionSlice) => {
      setSessions((prev) => {
        const slice = prev[sessionId];
        if (!slice) return prev;
        return { ...prev, [sessionId]: patch(slice) };
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Store-lifetime listeners — attached EXACTLY ONCE; routed by sessionId.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (listenersAttached.current) return;
    listenersAttached.current = true;

    let cancelled = false;

    async function attach() {
      // session-event — append a parsed stdout line to the owning session.
      const unlistenEvent = await listen<SessionEventPayload>("session-event", (ev) => {
        const { sessionId } = ev.payload;
        const turn = turnRefs.current[sessionId] ?? 1;
        patchSession(sessionId, (slice) => ({
          ...slice,
          transcript: [
            ...slice.transcript,
            {
              source: "event",
              turn,
              kind: ev.payload.kind,
              parsed: ev.payload.parsed,
              line: ev.payload.raw,
              ts: ev.payload.ts,
            },
          ],
        }));
      });

      // session-stderr — append a diagnostics line to the owning session.
      const unlistenStderr = await listen<SessionStderrPayload>("session-stderr", (ev) => {
        const { sessionId } = ev.payload;
        const turn = turnRefs.current[sessionId] ?? 1;
        patchSession(sessionId, (slice) => ({
          ...slice,
          transcript: [
            ...slice.transcript,
            { source: "stderr", turn, line: ev.payload.line, ts: ev.payload.ts },
          ],
        }));
      });

      // session-delta — an EPHEMERAL streaming fragment (story S6/S7). Routed
      // to the owning session's `live` state; NEVER appended to `transcript`.
      const unlistenDelta = await listen<SessionDeltaPayload>("session-delta", (ev) => {
        const { sessionId } = ev.payload;
        patchSession(sessionId, (slice) => applyDelta(slice, ev.payload));
      });

      // session-tool-start — a tool call is beginning (story S6). Adds a live
      // `LiveToolCall` to the owning session's ephemeral state.
      const unlistenToolStart = await listen<SessionToolStartPayload>(
        "session-tool-start",
        (ev) => {
          const { sessionId } = ev.payload;
          patchSession(sessionId, (slice) => applyToolStart(slice, ev.payload));
        },
      );

      // session-usage — a live mid-turn token-usage preview (story S7). The
      // authoritative `result` usage supersedes it at turn end.
      const unlistenUsage = await listen<SessionUsagePayload>("session-usage", (ev) => {
        const { sessionId } = ev.payload;
        patchSession(sessionId, (slice) => ({
          ...slice,
          live: { ...slice.live, usage: ev.payload },
        }));
      });

      // session-turn-complete — finalise the owning session's current turn.
      const unlistenComplete = await listen<SessionTurnCompletePayload>(
        "session-turn-complete",
        (ev) => {
          // R6 dual-finalize: a turn finalises on a terminal `result` OR a
          // clean process exit. `isError` already folds both signals on the
          // Rust side; `hadResult` is surfaced for diagnostics only.
          const { sessionId, exitCode, hadResult, isError } = ev.payload;

          patchSession(sessionId, (slice) => ({
            ...slice,
            status: isError ? "failed" : "awaiting-input",
            // EPHEMERALITY GATE — clear the live state. The streamed text /
            // tool calls / mid-turn usage are now superseded by the persisted
            // `assistant` / `user` / `result` `session-event` entries, which
            // are the durable source of truth. Not clearing here would
            // double-render the final assistant message.
            live: EMPTY_LIVE_STATE,
          }));

          if (isError) {
            toast.error("Turn failed", {
              description: `exit ${exitCode}`,
              duration: Number.POSITIVE_INFINITY,
            });
          } else {
            toast.success("Turn complete", {
              description: hadResult ? "result received" : "process exited cleanly",
            });
          }
        },
      );

      if (cancelled) {
        // The component unmounted before attach resolved — detach immediately.
        unlistenEvent();
        unlistenStderr();
        unlistenDelta();
        unlistenToolStart();
        unlistenUsage();
        unlistenComplete();
        return;
      }
      unlistenRefs.current = [
        unlistenEvent,
        unlistenStderr,
        unlistenDelta,
        unlistenToolStart,
        unlistenUsage,
        unlistenComplete,
      ];
    }

    void attach();

    return () => {
      cancelled = true;
      detachListeners();
      listenersAttached.current = false;
    };
  }, [patchSession, detachListeners]);

  // -------------------------------------------------------------------------
  // Rehydration — populate the map with summary-level entries on mount.
  // The full transcript loads lazily via `reopen` / `load_session`.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function rehydrate() {
      try {
        const summaries = await invoke<SessionSummary[]>("list_sessions");
        if (cancelled) return;
        const map: SessionMap = {};
        for (const s of summaries) {
          map[s.uuid] = {
            sessionId: s.uuid,
            // Summary-only sessions are awaiting-input until opened — the
            // partial-turn rule is applied on `load_session` (full record).
            status: "awaiting-input",
            transcript: [],
            sessionInfo: infoFromSummary(s),
            summary: s,
            turn: 0,
            hydrated: false,
            live: EMPTY_LIVE_STATE,
          };
        }
        setSessions(map);
      } catch (err) {
        // A fresh install has no index — list_sessions returns [] not an
        // error, so a genuine rejection is logged but never blocks the UI.
        console.warn("[useSessions] list_sessions failed:", err);
      } finally {
        if (!cancelled) setRehydrating(false);
      }
    }

    void rehydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * Open a NEW session and spawn turn 1. Unlike v0.3.0's `useSession.start`,
   * this ADDS a session to the map — it never wipes the others. Returns the
   * new session's id, or `null` if `start_session` rejected.
   */
  const start = useCallback(async (params: StartSessionParams): Promise<string | null> => {
    try {
      // Listeners are already attached for the store's lifetime, so events
      // emitted by turn 1 cannot be missed — the v0.3.0 race is gone.
      const info = await invoke<SessionInfo>("start_session", { params });
      turnRefs.current[info.sessionId] = 1;
      setSessions((prev) => ({
        ...prev,
        [info.sessionId]: {
          sessionId: info.sessionId,
          status: "turn-running",
          // R4: seed the transcript with the turn-1 prompt entry so the user's
          // own ask heads the turn group. Rust appends the matching persisted
          // entry in `run_turn`, so a reopen rebuilds the identical entry.
          transcript: [promptEntry(1, params.firstPrompt)],
          sessionInfo: info,
          summary: null,
          turn: 1,
          hydrated: true,
          // Turn 1 starts with empty live state; deltas accumulate into it.
          live: { ...EMPTY_LIVE_STATE, turn: 1 },
        },
      }));
      return info.sessionId;
    } catch (err) {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      toast.error("Session failed to start", {
        description: msg,
        duration: Number.POSITIVE_INFINITY,
      });
      return null;
    }
  }, []);

  /** Send a follow-up turn on an existing session. */
  const sendTurn = useCallback(
    (sessionId: string, prompt: string) => {
      const slice = sessions[sessionId];
      if (!slice) {
        console.warn("[useSessions] sendTurn for unknown session", sessionId);
        return;
      }

      // A new turn — bump the per-session grouping marker and enter
      // turn-running. The ref is the source of truth for event stamping.
      const nextTurn = (turnRefs.current[sessionId] ?? slice.turn) + 1;
      turnRefs.current[sessionId] = nextTurn;
      patchSession(sessionId, (s) => ({
        ...s,
        status: "turn-running",
        turn: nextTurn,
        // R4: append the typed prompt as a transcript entry at the new turn —
        // it heads the turn group. Rust's `run_turn` appends the matching
        // persisted entry so a reopen rebuilds the identical entry.
        transcript: [...s.transcript, promptEntry(nextTurn, prompt)],
        // A fresh turn starts with empty live state — the prior turn's
        // streamed text / tool calls are now persisted entries.
        live: { ...EMPTY_LIVE_STATE, turn: nextTurn },
      }));

      invoke("send_turn", { sessionId, prompt }).catch((err) => {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        patchSession(sessionId, (s) => ({
          ...s,
          status: "failed",
          transcript: [
            ...s.transcript,
            {
              source: "stderr",
              turn: nextTurn,
              line: `[gambit] error: ${msg}`,
              ts: new Date().toISOString(),
            },
          ],
        }));
        toast.error("Turn failed to start", {
          description: msg,
          duration: Number.POSITIVE_INFINITY,
        });
      });
    },
    [sessions, patchSession],
  );

  /** Cancel the in-flight turn of a session (SIGKILL). */
  const cancel = useCallback((sessionId: string) => {
    invoke("cancel_session", { sessionId }).catch((err) => {
      console.warn("[useSessions] cancel_session failed:", err);
    });
    // The kill makes the in-flight turn finalise with the cancel sentinel
    // (exit -2 → isError), so session-turn-complete moves it to `failed`.
    toast.info("Turn cancelled");
  }, []);

  /**
   * Re-insert a persisted session as a live registry handle AND rehydrate its
   * transcript from disk.
   *
   * `reopen_session` reconstructs the live `SessionHandle` (so the next
   * `send_turn` can issue `--resume`); `load_session` returns the full record
   * the transcript is rebuilt from. The restart rule (R-PARTIAL-TURN) is
   * applied here: a session whose last turn never produced a `result` lands in
   * `awaiting-input` with its partial transcript shown read-only.
   *
   * Idempotent end-to-end: a session already hydrated re-loads cleanly.
   */
  const reopen = useCallback(async (sessionId: string) => {
    try {
      // 1. Re-insert the live handle (idempotent on the Rust side).
      await invoke<SessionInfo>("reopen_session", { sessionId });
      // 2. Load the full record and rebuild the transcript.
      const record = await invoke<SessionRecord>("load_session", { sessionId });

      const transcript = transcriptFromPersisted(record.transcript);
      // Seed the per-session turn counter past the last recorded turn so a
      // follow-up `send_turn` stamps a fresh number.
      const lastTurn = record.perTurn.reduce((max, t) => Math.max(max, t.turn), 0);
      turnRefs.current[sessionId] = lastTurn;

      setSessions((prev) => ({
        ...prev,
        [sessionId]: {
          sessionId,
          status: rehydratedStatus(record),
          transcript,
          sessionInfo: infoFromRecord(record),
          summary: prev[sessionId]?.summary ?? null,
          turn: lastTurn,
          hydrated: true,
          // A rehydrated session has no in-flight turn — live state is empty.
          live: EMPTY_LIVE_STATE,
        },
      }));
    } catch (err) {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      console.warn("[useSessions] reopen failed:", err);
      toast.error("Could not reopen session", {
        description: msg,
        duration: Number.POSITIVE_INFINITY,
      });
    }
  }, []);

  /** Remove a session — delete its on-disk record and drop it from the map. */
  const remove = useCallback(async (sessionId: string) => {
    try {
      await invoke("delete_session", { sessionId });
    } catch (err) {
      console.warn("[useSessions] delete_session failed:", err);
    }
    delete turnRefs.current[sessionId];
    setSessions((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  /** Run the `claude` login pre-flight; updates `authStatus`. */
  const checkAuth = useCallback(() => {
    invoke<AuthStatus>("claude_auth_status")
      .then((result) => {
        setAuthStatus(result);
      })
      .catch((err) => {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.warn("[useSessions] claude_auth_status failed:", err);
        setAuthStatus({ loggedIn: false, detail: msg });
      });
  }, []);

  return {
    sessions,
    rehydrating,
    authStatus,
    pendingEidolon,
    setPendingEidolon,
    start,
    sendTurn,
    cancel,
    reopen,
    remove,
    checkAuth,
  };
}
