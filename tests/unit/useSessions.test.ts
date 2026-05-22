// useSessions.test.ts — unit tests for the multi-session store (story S2).
//
// Mocks:
//   @tauri-apps/api/core  → vi.fn() for invoke
//   @tauri-apps/api/event → vi.fn() for listen; captures registered handlers
//                           so tests can simulate emitting session events.
//
// MANDATORY S2 coverage:
//   * the 3 Tauri listeners are attached EXACTLY ONCE for the store's lifetime
//   * an event for session A does NOT mutate session B (sessionId routing)
//   * the route-change regression — a consuming view unmounting/remounting
//     while the store stays mounted must NOT lose the transcript
//   * a `resultSeen: false` rehydrated session lands in `awaiting-input`
//     (the R-PARTIAL-TURN fresh-continuation rule)
//
// Hermetic: no process, no disk — every invoke is stubbed.

import type { SessionRecord, SessionSummary } from "@/lib/session.types";
import { lastTurnUnfinalised, useSessions } from "@/lib/useSessions";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tauri API mocks
// ---------------------------------------------------------------------------

const SESSION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mockInvoke = vi.fn();
const mockUnlisten = vi.fn();

// Captures registered event handlers so tests can simulate emissions.
const eventHandlers: Record<string, (event: { payload: unknown }) => void> = {};

const mockListen = vi
  .fn()
  .mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventHandlers[eventName] = handler;
    return Promise.resolve(mockUnlisten);
  });

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = "2026-05-22T00:00:00Z";

/** A SessionInfo shaped like start_session / reopen_session return values. */
function sessionInfo(sessionId: string) {
  return {
    sessionId,
    eidolonName: "Sage",
    projectPath: "/Users/alice/project",
    permissionMode: "default",
    status: "running",
    createdAt: TS,
    isCortex: false,
  };
}

/** A minimal SessionSummary for list_sessions rehydration. */
function summary(uuid: string): SessionSummary {
  return {
    uuid,
    eidolonName: "Sage",
    isCortex: false,
    title: "A session",
    status: "idle",
    model: null,
    createdAt: TS,
    lastActiveAt: TS,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeCostUsd: 0,
  };
}

/** A SessionRecord with a configurable last-turn `resultSeen`. */
function record(uuid: string, lastResultSeen: boolean): SessionRecord {
  return {
    uuid,
    eidolonName: "Sage",
    isCortex: false,
    title: "A session",
    projectPath: "/Users/alice/project",
    permissionMode: "default",
    appendSystemPrompt: "You are Sage.",
    allowedTools: ["Read"],
    status: "idle",
    model: "claude-opus-4-7",
    createdAt: TS,
    lastActiveAt: TS,
    transcript: [
      {
        source: "event",
        turn: 1,
        kind: "assistant",
        parsed: undefined,
        line: '{"type":"assistant"}',
        ts: TS,
      },
    ],
    cumulativeUsage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    cumulativeCostUsd: 0.01,
    perTurn: [{ turn: 1, resultSeen: lastResultSeen }],
  };
}

/** Flush the store's mount/rehydration + attach microtask chains. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function emitEvent(sessionId: string, kind: string, parsed: unknown) {
  act(() => {
    eventHandlers["session-event"]?.({
      payload: { sessionId, kind, raw: JSON.stringify(parsed), parsed, ts: TS },
    });
  });
}

function emitStderr(sessionId: string, line: string) {
  act(() => {
    eventHandlers["session-stderr"]?.({ payload: { sessionId, line, ts: TS } });
  });
}

function emitTurnComplete(
  sessionId: string,
  opts: { exitCode: number; hadResult: boolean; isError: boolean },
) {
  act(() => {
    eventHandlers["session-turn-complete"]?.({ payload: { sessionId, ...opts } });
  });
}

/** Emit a `session-delta` (story S6) — text or toolInput fragment. */
function emitDelta(
  sessionId: string,
  payload: {
    turn: number;
    deltaKind: string;
    text?: string;
    blockIndex?: number;
    partialJson?: string;
    parentToolUseId?: string;
  },
) {
  act(() => {
    eventHandlers["session-delta"]?.({ payload: { sessionId, ts: TS, ...payload } });
  });
}

/** Emit a `session-tool-start` (story S6). */
function emitToolStart(
  sessionId: string,
  payload: {
    turn: number;
    blockIndex: number;
    toolUseId: string;
    toolName: string;
    parentToolUseId?: string;
  },
) {
  act(() => {
    eventHandlers["session-tool-start"]?.({ payload: { sessionId, ts: TS, ...payload } });
  });
}

/** Emit a `session-usage` (story S7). */
function emitUsage(
  sessionId: string,
  payload: { turn: number; inputTokens?: number; outputTokens?: number },
) {
  act(() => {
    eventHandlers["session-usage"]?.({ payload: { sessionId, ts: TS, ...payload } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: list_sessions returns an empty index (fresh install).
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
  });

  afterEach(() => {
    // clearAllMocks, NOT restoreAllMocks: restore wipes the module-level
    // mockListen implementation, so subsequent tests' listen() returns
    // undefined and detachListeners crashes on a non-function unlisten.
    vi.clearAllMocks();
  });

  it("starts empty and finishes rehydration", async () => {
    const { result } = renderHook(() => useSessions());
    expect(result.current.sessions).toEqual({});
    await flush();
    expect(result.current.rehydrating).toBe(false);
  });

  // --- listeners attached EXACTLY ONCE --------------------------------------
  it("attaches the 6 session listeners exactly once for the store's lifetime", async () => {
    const { rerender } = renderHook(() => useSessions());
    await flush();

    // Each of the six listeners registered exactly once (3 from S2 + the 3
    // S6/S7 ephemeral-stream listeners).
    for (const name of [
      "session-event",
      "session-stderr",
      "session-turn-complete",
      "session-delta",
      "session-tool-start",
      "session-usage",
    ]) {
      expect(mockListen.mock.calls.filter((c) => c[0] === name)).toHaveLength(1);
    }

    // A re-render must NOT re-attach — the listeners are store-lifetime.
    rerender();
    await flush();
    expect(mockListen.mock.calls.filter((c) => c[0] === "session-delta")).toHaveLength(1);
  });

  // --- start ADDS a session --------------------------------------------------
  it("start() ADDS a session without wiping existing ones", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") {
        // Distinguish the two starts by call order.
        const id = mockInvoke.mock.calls.filter((c) => c[0] === "start_session").length;
        return Promise.resolve(sessionInfo(id === 1 ? SESSION_A : SESSION_B));
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    await act(async () => {
      await result.current.start({
        projectPath: "/p",
        eidolonName: "Sage",
        permissionMode: "default",
        appendSystemPrompt: "",
        allowedTools: [],
        firstPrompt: "first",
      });
    });
    expect(Object.keys(result.current.sessions)).toEqual([SESSION_A]);

    await act(async () => {
      await result.current.start({
        projectPath: "/p",
        eidolonName: "Sage",
        permissionMode: "default",
        appendSystemPrompt: "",
        allowedTools: [],
        firstPrompt: "second",
      });
    });
    // Both sessions coexist — the first was NOT wiped.
    expect(Object.keys(result.current.sessions).sort()).toEqual([SESSION_A, SESSION_B].sort());
    expect(result.current.sessions[SESSION_A].status).toBe("turn-running");
  });

  // --- sessionId routing: event for A must not touch B ----------------------
  it("routes an event for session A without mutating session B", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A), summary(SESSION_B)]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    // Both sessions are in the map (summary-level) after rehydration.
    expect(Object.keys(result.current.sessions).sort()).toEqual([SESSION_A, SESSION_B].sort());

    // An event for A appends to A's transcript only.
    emitEvent(SESSION_A, "assistant", { Assistant: { content: [] } });
    emitStderr(SESSION_A, "[claude] note");

    expect(result.current.sessions[SESSION_A].transcript).toHaveLength(2);
    expect(result.current.sessions[SESSION_B].transcript).toHaveLength(0);

    // A turn-complete for A must not move B's state machine.
    emitTurnComplete(SESSION_A, { exitCode: 1, hadResult: false, isError: true });
    expect(result.current.sessions[SESSION_A].status).toBe("failed");
    expect(result.current.sessions[SESSION_B].status).toBe("awaiting-input");
  });

  // --- an event for an UNKNOWN session is dropped, not crashing -------------
  it("drops an event whose sessionId is not in the map", async () => {
    const { result } = renderHook(() => useSessions());
    await flush();

    emitEvent("99999999-9999-9999-9999-999999999999", "assistant", {
      Assistant: { content: [] },
    });
    expect(result.current.sessions).toEqual({});
  });

  // --- THE route-change regression test -------------------------------------
  it("regression: a route-level consumer unmount/remount keeps the transcript", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A)]);
      return Promise.resolve(undefined);
    });

    // The store is the hook lifted to the App shell — it stays mounted across
    // route changes. `renderHook` models that single, persistent mount.
    const store = renderHook(() => useSessions());
    await flush();

    // A turn streams events into session A while the route is shown.
    emitEvent(SESSION_A, "assistant", { Assistant: { content: [{ blockType: "text" }] } });
    emitStderr(SESSION_A, "[claude] working");
    expect(store.result.current.sessions[SESSION_A].transcript).toHaveLength(2);

    // --- "Navigate away": a route-level CONSUMER unmounts. In v0.3.0 this is
    // where `useSession` died and the transcript was destroyed (FINDING-016).
    // Here the consumer only READS the store, which lives above the router.
    const consumer = renderHook(
      ({ s }: { s: typeof store.result.current }) => s.sessions[SESSION_A]?.transcript.length ?? 0,
      { initialProps: { s: store.result.current } },
    );
    expect(consumer.result.current).toBe(2);
    consumer.unmount(); // route change away from Sessions

    // The store hook was NOT unmounted — its state must be intact.
    expect(store.result.current.sessions[SESSION_A].transcript).toHaveLength(2);

    // Events can still stream in while the route is unmounted.
    emitEvent(SESSION_A, "result", { Result: { isError: false, usage: {} } });
    expect(store.result.current.sessions[SESSION_A].transcript).toHaveLength(3);

    // --- "Navigate back": a fresh consumer remounts and STILL sees the full
    // transcript — the structural fix. The store never lost it.
    const consumer2 = renderHook(
      ({ s }: { s: typeof store.result.current }) => s.sessions[SESSION_A]?.transcript.length ?? 0,
      { initialProps: { s: store.result.current } },
    );
    expect(consumer2.result.current).toBe(3);
  });

  // --- reopen + rehydration: resultSeen TRUE --------------------------------
  it("reopen rebuilds the transcript and lands a finalised session awaiting-input", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A)]);
      if (cmd === "reopen_session") return Promise.resolve(sessionInfo(SESSION_A));
      if (cmd === "load_session") return Promise.resolve(record(SESSION_A, true));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    await act(async () => {
      await result.current.reopen(SESSION_A);
    });

    expect(mockInvoke).toHaveBeenCalledWith("reopen_session", { sessionId: SESSION_A });
    expect(mockInvoke).toHaveBeenCalledWith("load_session", { sessionId: SESSION_A });
    // The transcript is rebuilt from record.transcript.
    expect(result.current.sessions[SESSION_A].transcript).toHaveLength(1);
    expect(result.current.sessions[SESSION_A].hydrated).toBe(true);
    expect(result.current.sessions[SESSION_A].status).toBe("awaiting-input");
  });

  // --- THE R-PARTIAL-TURN rule: resultSeen FALSE → fresh continuation -------
  it("a resultSeen:false rehydrated session lands in awaiting-input (fresh continuation)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A)]);
      if (cmd === "reopen_session") return Promise.resolve(sessionInfo(SESSION_A));
      // The last turn never produced a `result` — crash / SIGKILL / dropped.
      if (cmd === "load_session") return Promise.resolve(record(SESSION_A, false));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    await act(async () => {
      await result.current.reopen(SESSION_A);
    });

    // NOT "turn-running" / mid-turn restored — it is offered a fresh turn.
    expect(result.current.sessions[SESSION_A].status).toBe("awaiting-input");
    // The partial transcript stays visible as read-only history.
    expect(result.current.sessions[SESSION_A].transcript).toHaveLength(1);
  });

  // --- sendTurn after reopen stamps a fresh turn number ---------------------
  it("sendTurn after a reopen stamps the next turn number", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A)]);
      if (cmd === "reopen_session") return Promise.resolve(sessionInfo(SESSION_A));
      if (cmd === "load_session") return Promise.resolve(record(SESSION_A, false));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await act(async () => {
      await result.current.reopen(SESSION_A);
    });

    act(() => {
      result.current.sendTurn(SESSION_A, "continue please");
    });
    expect(result.current.sessions[SESSION_A].status).toBe("turn-running");
    expect(mockInvoke).toHaveBeenCalledWith("send_turn", {
      sessionId: SESSION_A,
      prompt: "continue please",
    });

    // The last recorded turn was 1, so the next turn is 2.
    emitEvent(SESSION_A, "assistant", { Assistant: { content: [] } });
    const turn2 = result.current.sessions[SESSION_A].transcript.filter((e) => e.turn === 2);
    expect(turn2.length).toBeGreaterThan(0);
  });

  // --- remove drops the session + deletes the record ------------------------
  it("remove() deletes the record and drops the session from the map", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A)]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    expect(result.current.sessions[SESSION_A]).toBeDefined();

    await act(async () => {
      await result.current.remove(SESSION_A);
    });
    expect(mockInvoke).toHaveBeenCalledWith("delete_session", { sessionId: SESSION_A });
    expect(result.current.sessions[SESSION_A]).toBeUndefined();
  });

  // --- checkAuth -------------------------------------------------------------
  it("checkAuth populates authStatus", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "claude_auth_status") {
        return Promise.resolve({ loggedIn: true, detail: "Login method: Claude Max" });
      }
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    act(() => {
      result.current.checkAuth();
    });
    await flush();
    expect(result.current.authStatus?.loggedIn).toBe(true);
  });

  // --- pendingEidolon handoff -----------------------------------------------
  it("setPendingEidolon stores the Roster handoff name", async () => {
    const { result } = renderHook(() => useSessions());
    await flush();
    act(() => {
      result.current.setPendingEidolon("atlas");
    });
    expect(result.current.pendingEidolon).toBe("atlas");
  });

  // --- detaches listeners on unmount ----------------------------------------
  it("detaches listeners on unmount", async () => {
    const { unmount } = renderHook(() => useSessions());
    await flush();
    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  // --- S6/S7: EPHEMERAL live state ------------------------------------------

  /** Start a single session A on turn 1 so live state can be exercised. */
  async function startSessionA(result: ReturnType<typeof renderHook<unknown, unknown>>["result"]) {
    await act(async () => {
      await (result.current as { start: (p: unknown) => Promise<unknown> }).start({
        projectPath: "/p",
        eidolonName: "Sage",
        permissionMode: "default",
        appendSystemPrompt: "",
        allowedTools: [],
        firstPrompt: "go",
      });
    });
  }

  it("accumulates session-delta text fragments into the live buffer for turn N", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") return Promise.resolve(sessionInfo(SESSION_A));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await startSessionA(result);

    emitDelta(SESSION_A, { turn: 1, deltaKind: "text", text: "Hel" });
    emitDelta(SESSION_A, { turn: 1, deltaKind: "text", text: "lo!" });

    // Text accumulated into the EPHEMERAL live buffer — not the transcript.
    expect(result.current.sessions[SESSION_A].live.streamingText).toBe("Hello!");
    expect(result.current.sessions[SESSION_A].transcript).toHaveLength(0);
  });

  it("registers a live tool call from session-tool-start and accumulates its input", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") return Promise.resolve(sessionInfo(SESSION_A));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await startSessionA(result);

    emitToolStart(SESSION_A, { turn: 1, blockIndex: 0, toolUseId: "tu_1", toolName: "Read" });
    emitDelta(SESSION_A, { turn: 1, deltaKind: "toolInput", blockIndex: 0, partialJson: '{"f' });
    emitDelta(SESSION_A, { turn: 1, deltaKind: "toolInput", blockIndex: 0, partialJson: 'oo"}' });

    const call = result.current.sessions[SESSION_A].live.toolCalls.tu_1;
    expect(call.toolName).toBe("Read");
    expect(call.partialInput).toBe('{"foo"}');
    expect(call.parentToolUseId).toBe(null);
  });

  it("tags a parentToolUseId tool call as self-routed-subagent work", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") return Promise.resolve(sessionInfo(SESSION_A));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await startSessionA(result);

    emitToolStart(SESSION_A, {
      turn: 1,
      blockIndex: 1,
      toolUseId: "tu_sub",
      toolName: "Grep",
      parentToolUseId: "tu_parent",
    });
    expect(result.current.sessions[SESSION_A].live.toolCalls.tu_sub.parentToolUseId).toBe(
      "tu_parent",
    );
  });

  it("session-usage feeds the live mid-turn usage (story S7)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") return Promise.resolve(sessionInfo(SESSION_A));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await startSessionA(result);

    emitUsage(SESSION_A, { turn: 1, inputTokens: 12_000, outputTokens: 30 });
    expect(result.current.sessions[SESSION_A].live.usage?.inputTokens).toBe(12_000);
  });

  it("session-turn-complete CLEARS the live state (ephemerality gate)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([]);
      if (cmd === "start_session") return Promise.resolve(sessionInfo(SESSION_A));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();
    await startSessionA(result);

    emitDelta(SESSION_A, { turn: 1, deltaKind: "text", text: "streaming" });
    emitToolStart(SESSION_A, { turn: 1, blockIndex: 0, toolUseId: "tu_1", toolName: "Read" });
    emitUsage(SESSION_A, { turn: 1, inputTokens: 9_000 });
    expect(result.current.sessions[SESSION_A].live.streamingText).toBe("streaming");

    // The turn finishes — live state must be wiped wholesale.
    emitTurnComplete(SESSION_A, { exitCode: 0, hadResult: true, isError: false });
    const live = result.current.sessions[SESSION_A].live;
    expect(live.streamingText).toBe("");
    expect(live.toolCalls).toEqual({});
    expect(live.usage).toBe(null);
    expect(live.turn).toBe(0);
  });

  it("a session-delta for session A does NOT touch session B", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_sessions") return Promise.resolve([summary(SESSION_A), summary(SESSION_B)]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSessions());
    await flush();

    emitDelta(SESSION_A, { turn: 1, deltaKind: "text", text: "for A only" });
    emitToolStart(SESSION_A, { turn: 1, blockIndex: 0, toolUseId: "tu_a", toolName: "Read" });

    expect(result.current.sessions[SESSION_A].live.streamingText).toBe("for A only");
    expect(result.current.sessions[SESSION_B].live.streamingText).toBe("");
    expect(result.current.sessions[SESSION_B].live.toolCalls).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// lastTurnUnfinalised — the R-PARTIAL-TURN predicate
// ---------------------------------------------------------------------------

describe("lastTurnUnfinalised", () => {
  it("is true when the last per-turn entry has resultSeen:false", () => {
    expect(lastTurnUnfinalised(record(SESSION_A, false))).toBe(true);
  });

  it("is false when the last per-turn entry finalised cleanly", () => {
    expect(lastTurnUnfinalised(record(SESSION_A, true))).toBe(false);
  });

  it("is false for a session with no recorded turns", () => {
    const r = record(SESSION_A, true);
    r.perTurn = [];
    expect(lastTurnUnfinalised(r)).toBe(false);
  });
});
