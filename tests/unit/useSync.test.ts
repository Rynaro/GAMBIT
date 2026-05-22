// useSync.test.ts — Unit tests for the useSync hook.
//
// Mocks:
//   @tauri-apps/api/core  → vi.fn() for invoke
//   @tauri-apps/api/event → vi.fn() for listen; exposes test helpers to
//                           simulate emitting sync events.

import { useSync } from "@/lib/useSync";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tauri API mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn().mockResolvedValue(undefined);
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

function emitStdout(line: string, ts = "2026-05-21T00:00:00Z") {
  act(() => {
    eventHandlers["sync-stdout"]?.({ payload: { line, ts } });
  });
}

function emitStderr(line: string, ts = "2026-05-21T00:00:00Z") {
  act(() => {
    eventHandlers["sync-stderr"]?.({ payload: { line, ts } });
  });
}

function emitComplete(exitCode: number) {
  act(() => {
    // Wire field is camelCase `exitCode` (serde rename_all on CompletePayload).
    eventHandlers["sync-complete"]?.({ payload: { exitCode } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured handlers
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

  it("starts in idle state", () => {
    const { result } = renderHook(() => useSync());
    expect(result.current.state).toBe("idle");
    expect(result.current.lines).toHaveLength(0);
    expect(result.current.exitCode).toBeNull();
    expect(result.current.projectPath).toBeNull();
  });

  it("transitions idle → running on start()", async () => {
    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/Users/alice/project");
    });

    expect(result.current.state).toBe("running");
    expect(result.current.projectPath).toBe("/Users/alice/project");
  });

  it("running → done path: accumulates lines and sets exitCode 0", async () => {
    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/proj");
    });

    // Flush the async attach() in useSync
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    emitStdout("Syncing atlas...");
    emitStdout("Done.");
    emitComplete(0);

    expect(result.current.state).toBe("done");
    expect(result.current.lines).toHaveLength(2);
    expect(result.current.lines[0].text).toBe("Syncing atlas...");
    expect(result.current.lines[0].stream).toBe("stdout");
    expect(result.current.exitCode).toBe(0);
  });

  it("running → failed path: sets state failed for non-zero exit", async () => {
    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/proj");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    emitStderr("Error: network timeout");
    emitComplete(1);

    expect(result.current.state).toBe("failed");
    expect(result.current.exitCode).toBe(1);
    expect(result.current.lines[0].stream).toBe("stderr");
  });

  it("running → cancelled path: cancel() transitions to cancelled", async () => {
    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/proj");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe("cancelled");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_sync");
  });

  it("clear() resets to idle from any terminal state", async () => {
    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/proj");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    emitComplete(0);

    expect(result.current.state).toBe("done");

    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.lines).toHaveLength(0);
    expect(result.current.exitCode).toBeNull();
    expect(result.current.projectPath).toBeNull();
  });

  it("invoke error surfaces as a synthetic stderr line and failed state", async () => {
    mockInvoke.mockRejectedValueOnce("eidolons CLI not on PATH; run the curl-pipe installer");

    const { result } = renderHook(() => useSync());

    act(() => {
      result.current.start("/proj");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("failed");
    const errorLine = result.current.lines.find((l) => l.text.includes("eidolons CLI not on PATH"));
    expect(errorLine).toBeDefined();
    expect(errorLine?.stream).toBe("stderr");
  });
});
