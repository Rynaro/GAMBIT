// useDriftWatcher.test.ts — unit tests for the drift watcher hook.
//
// Mocks:
//   @tauri-apps/api/core  → vi.fn() for invoke
//   @tauri-apps/api/event → vi.fn() for listen; exposes a test helper to
//                           simulate emitting a drift-detected event.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDriftWatcher, DRIFT_TTL_MS } from "@/lib/useDriftWatcher";

// ---------- Tauri API mocks ----------

const mockInvoke = vi.fn().mockResolvedValue(undefined);
const mockUnlisten = vi.fn();

// Holds the registered drift-detected callback so tests can trigger it.
let capturedDriftCallback: ((event: { payload: { path: string; timestamp: string } }) => void) | null = null;

const mockListen = vi.fn().mockImplementation(
  (
    eventName: string,
    handler: (event: { payload: { path: string; timestamp: string } }) => void
  ) => {
    if (eventName === "drift-detected") {
      capturedDriftCallback = handler;
    }
    return Promise.resolve(mockUnlisten);
  }
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ---------- Helpers ----------

function emitDriftEvent(path = "/proj/eidolons.lock", timestamp = "2026-05-21T02:00:00Z") {
  act(() => {
    capturedDriftCallback?.({ payload: { path, timestamp } });
  });
}

// ---------- Tests ----------

describe("useDriftWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedDriftCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns idle state when projectPath is null", () => {
    const { result } = renderHook(() => useDriftWatcher(null));
    expect(result.current.state).toBe("idle");
    expect(result.current.projectBasename).toBeNull();
    expect(result.current.lastEventAt).toBeNull();
  });

  it("transitions to watching when a path is provided and invoke resolves", async () => {
    const { result } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    // Flush async microtasks (invoke + listen promises)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockInvoke).toHaveBeenCalledWith("start_watching", {
      path: "/Users/alice/my-project",
    });
    expect(result.current.state).toBe("watching");
    expect(result.current.projectBasename).toBe("my-project");
  });

  it("transitions to drift on drift-detected event emission", async () => {
    const { result } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("watching");

    emitDriftEvent("/Users/alice/my-project/eidolons.lock", "2026-05-21T02:00:00Z");

    expect(result.current.state).toBe("drift");
    expect(result.current.lastEventAt).toBe("2026-05-21T02:00:00Z");
  });

  it("auto-clears drift back to watching after DRIFT_TTL_MS", async () => {
    const { result } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    emitDriftEvent();
    expect(result.current.state).toBe("drift");

    // Advance time past the TTL
    act(() => {
      vi.advanceTimersByTime(DRIFT_TTL_MS + 50);
    });

    expect(result.current.state).toBe("watching");
  });

  it("click-to-clear: clearDrift() transitions drift → watching immediately", async () => {
    const { result } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    emitDriftEvent();
    expect(result.current.state).toBe("drift");

    act(() => {
      result.current.clearDrift();
    });

    expect(result.current.state).toBe("watching");
  });

  it("clearDrift() is a no-op in watching state", async () => {
    const { result } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("watching");

    act(() => {
      result.current.clearDrift();
    });

    expect(result.current.state).toBe("watching");
  });

  it("calls stop_watching and unlisten on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useDriftWatcher("/Users/alice/my-project")
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state).toBe("watching");

    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUnlisten).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("stop_watching");
  });
});
