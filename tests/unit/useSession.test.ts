// useSession.test.ts — unit tests for the useSession hook.
//
// Mocks:
//   @tauri-apps/api/core  → vi.fn() for invoke
//   @tauri-apps/api/event → vi.fn() for listen; captures registered handlers
//                           so tests can simulate emitting session events.
//
// FORGE R6 coverage — the dual-finalize paths are both exercised:
//   * a turn that completes via a terminal `result` event (hadResult: true)
//   * a turn that completes via a clean process exit WITHOUT a `result`
//     event (hadResult: false — the known claude-code dropped-result bug)
//   both must land the hook in `awaiting-input`.
// Also covered: multi-turn (sendTurn after awaiting-input) and a failed turn.

import type { StartSessionParams } from "@/lib/session.types";
import { useSession } from "@/lib/useSession";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tauri API mocks
// ---------------------------------------------------------------------------

const SESSION_ID = "11111111-1111-1111-1111-111111111111";

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

const PARAMS: StartSessionParams = {
  projectPath: "/Users/alice/project",
  eidolonName: "Sage",
  permissionMode: "default",
  appendSystemPrompt: "You are Sage.",
  allowedTools: ["Read", "Edit"],
  firstPrompt: "hello eidolon",
};

/** A SessionInfo shaped like start_session's return value. */
function sessionInfo(sessionId = SESSION_ID) {
  return {
    sessionId,
    eidolonName: "Sage",
    projectPath: "/Users/alice/project",
    permissionMode: "default",
    status: "running",
  };
}

/** Flush the async attach()/invoke microtask chain inside the hook. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function emitEvent(kind: string, parsed: unknown, sessionId = SESSION_ID) {
  act(() => {
    eventHandlers["session-event"]?.({
      payload: { sessionId, kind, raw: JSON.stringify(parsed), parsed, ts: TS },
    });
  });
}

function emitStderr(line: string, sessionId = SESSION_ID) {
  act(() => {
    eventHandlers["session-stderr"]?.({ payload: { sessionId, line, ts: TS } });
  });
}

function emitTurnComplete(
  opts: { exitCode: number; hadResult: boolean; isError: boolean },
  sessionId = SESSION_ID,
) {
  act(() => {
    eventHandlers["session-turn-complete"]?.({ payload: { sessionId, ...opts } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(sessionInfo());
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.status).toBe("idle");
    expect(result.current.transcript).toHaveLength(0);
    expect(result.current.sessionInfo).toBeNull();
    expect(result.current.authStatus).toBeNull();
  });

  it("transitions idle → launching → turn-running on start()", async () => {
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.start(PARAMS);
    });
    expect(result.current.status).toBe("launching");

    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("start_session", { params: PARAMS });
    expect(result.current.status).toBe("turn-running");
    expect(result.current.sessionInfo?.sessionId).toBe(SESSION_ID);
  });

  it("attaches listeners before invoking start_session (event-race fix)", async () => {
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    // All three session listeners must be registered.
    expect(mockListen).toHaveBeenCalledWith("session-event", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("session-stderr", expect.any(Function));
    expect(mockListen).toHaveBeenCalledWith("session-turn-complete", expect.any(Function));
  });

  it("accumulates session-events and stderr lines into the transcript", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    emitEvent("init", { Init: { sessionId: SESSION_ID, model: "claude", tools: [] } });
    emitEvent("assistant", { Assistant: { content: [{ blockType: "text", text: "hi" }] } });
    emitStderr("[claude] warming up");

    expect(result.current.transcript).toHaveLength(3);
    expect(result.current.transcript[0].source).toBe("event");
    expect(result.current.transcript[0].kind).toBe("init");
    expect(result.current.transcript[1].kind).toBe("assistant");
    expect(result.current.transcript[2].source).toBe("stderr");
    expect(result.current.transcript[2].line).toBe("[claude] warming up");
    // All belong to turn 1.
    expect(result.current.transcript.every((e) => e.turn === 1)).toBe(true);
  });

  // --- R6 dual-finalize, path A: terminal `result` event ---------------------
  it("R6: turn completing via a `result` event → awaiting-input", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    emitEvent("result", {
      Result: { subtype: "success", isError: false, usage: {} },
    });
    // Rust folds the result into the completion payload (hadResult: true).
    emitTurnComplete({ exitCode: 0, hadResult: true, isError: false });

    expect(result.current.status).toBe("awaiting-input");
  });

  // --- R6 dual-finalize, path B: clean exit, NO `result` event ---------------
  it("R6: turn completing via clean exit WITHOUT a `result` event → awaiting-input", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    // No `result` event was observed — claude-code's dropped-result bug. The
    // process still exited cleanly, so the wait task backstops with
    // hadResult: false, isError: false.
    emitTurnComplete({ exitCode: 0, hadResult: false, isError: false });

    // The hook must still reach awaiting-input — the session stays alive.
    expect(result.current.status).toBe("awaiting-input");
  });

  // --- multi-turn ------------------------------------------------------------
  it("multi-turn: sendTurn from awaiting-input re-enters turn-running", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    emitTurnComplete({ exitCode: 0, hadResult: true, isError: false });
    expect(result.current.status).toBe("awaiting-input");

    mockInvoke.mockResolvedValueOnce(undefined);
    act(() => {
      result.current.sendTurn("a follow-up question");
    });

    expect(result.current.status).toBe("turn-running");
    expect(mockInvoke).toHaveBeenCalledWith("send_turn", {
      sessionId: SESSION_ID,
      prompt: "a follow-up question",
    });

    // Turn-2 events carry the bumped grouping marker.
    emitEvent("assistant", { Assistant: { content: [] } });
    const turn2 = result.current.transcript.filter((e) => e.turn === 2);
    expect(turn2.length).toBeGreaterThan(0);

    // And turn 2 can complete back to awaiting-input.
    emitTurnComplete({ exitCode: 0, hadResult: true, isError: false });
    expect(result.current.status).toBe("awaiting-input");
  });

  // --- failed turn -----------------------------------------------------------
  it("failed turn: completion with isError → failed", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    emitTurnComplete({ exitCode: 1, hadResult: false, isError: true });

    expect(result.current.status).toBe("failed");
  });

  it("a `result` event reporting isError still finalises as failed", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    // Clean exit code, but the result itself errored — Rust folds that into
    // isError: true on the completion payload.
    emitTurnComplete({ exitCode: 0, hadResult: true, isError: true });

    expect(result.current.status).toBe("failed");
  });

  // --- stale-session filtering ----------------------------------------------
  it("ignores events whose sessionId does not match the active session", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    // An event from a stale/other session must not leak in.
    emitEvent("assistant", { Assistant: { content: [] } }, "99999999-9999-9999-9999-999999999999");
    expect(result.current.transcript).toHaveLength(0);

    // A turn-complete for a stale session must not move our state machine.
    emitTurnComplete(
      { exitCode: 0, hadResult: true, isError: false },
      "99999999-9999-9999-9999-999999999999",
    );
    expect(result.current.status).toBe("turn-running");
  });

  // --- start failure ---------------------------------------------------------
  it("start_session rejection surfaces a stderr entry and failed state", async () => {
    mockInvoke.mockRejectedValueOnce("claude CLI not found on PATH");
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    expect(result.current.status).toBe("failed");
    const errEntry = result.current.transcript.find((e) => e.line.includes("claude CLI not found"));
    expect(errEntry).toBeDefined();
    expect(errEntry?.source).toBe("stderr");
  });

  // --- checkAuth -------------------------------------------------------------
  it("checkAuth populates authStatus from claude_auth_status", async () => {
    mockInvoke.mockResolvedValueOnce({
      loggedIn: true,
      detail: "Login method: Claude Max account",
    });
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.checkAuth();
    });
    await flush();

    expect(mockInvoke).toHaveBeenCalledWith("claude_auth_status");
    expect(result.current.authStatus?.loggedIn).toBe(true);
    expect(result.current.authStatus?.detail).toBe("Login method: Claude Max account");
  });

  it("checkAuth maps a rejection to a not-logged-in authStatus", async () => {
    mockInvoke.mockRejectedValueOnce("process failed to run");
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.checkAuth();
    });
    await flush();

    expect(result.current.authStatus?.loggedIn).toBe(false);
    expect(result.current.authStatus?.detail).toContain("process failed to run");
  });

  // --- cancel ----------------------------------------------------------------
  it("cancel() invokes cancel_session for the active session", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    act(() => {
      result.current.cancel();
    });

    expect(mockInvoke).toHaveBeenCalledWith("cancel_session", { sessionId: SESSION_ID });
  });

  // --- clear -----------------------------------------------------------------
  it("clear() resets to idle and detaches listeners", async () => {
    const { result } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    emitEvent("assistant", { Assistant: { content: [] } });
    emitTurnComplete({ exitCode: 0, hadResult: true, isError: false });
    expect(result.current.status).toBe("awaiting-input");

    act(() => {
      result.current.clear();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.transcript).toHaveLength(0);
    expect(result.current.sessionInfo).toBeNull();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("detaches listeners on unmount", async () => {
    const { result, unmount } = renderHook(() => useSession());
    act(() => {
      result.current.start(PARAMS);
    });
    await flush();

    unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });
});
