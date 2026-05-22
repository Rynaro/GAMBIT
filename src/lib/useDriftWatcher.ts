// useDriftWatcher.ts — React hook that bridges Rust notify-debouncer-mini to
// the drift-pill state machine.
//
// States:
//   idle      — no project path set
//   watching  — watcher running, no recent drift
//   drift     — drift detected within the last 5 seconds

import { basename } from "@/lib/pathUtils";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type DriftState = "idle" | "watching" | "drift";

export interface DriftWatcherResult {
  state: DriftState;
  lastEventAt: string | null; // ISO 8601
  projectBasename: string | null;
  clearDrift: () => void;
}

/** Drift auto-clears 5 seconds after the last event. */
export const DRIFT_TTL_MS = 5_000;

export function useDriftWatcher(projectPath: string | null): DriftWatcherResult {
  const [state, setState] = useState<DriftState>("idle");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Derived
  const projectBasename = projectPath ? basename(projectPath) : null;

  function clearDriftTimer() {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  }

  // Manual click-to-clear: drift → watching
  const clearDrift = useCallback(() => {
    setState((s) => (s === "drift" ? "watching" : s));
    clearDriftTimer();
  }, []);

  useEffect(() => {
    if (!projectPath) {
      setState("idle");
      setLastEventAt(null);
      clearDriftTimer();
      return;
    }

    let active = true;

    async function startWatcher() {
      // Start the Rust-side file watcher
      try {
        await invoke("start_watching", { path: projectPath });
      } catch (err) {
        console.warn("[DriftWatcher] start_watching failed:", err);
        // Still subscribe to events in case a previous watcher is alive
      }

      if (!active) return;
      setState("watching");

      // Subscribe to drift-detected events emitted by the Rust watcher
      const unlisten = await listen<{ path: string; timestamp: string }>(
        "drift-detected",
        (event) => {
          if (!active) return;
          setLastEventAt(event.payload.timestamp);
          // Only toast on the first transition (watching → drift),
          // not on repeated events within the TTL window.
          setState((prev) => {
            if (prev !== "drift") {
              const projBasename = projectPath
                ? (projectPath.split("/").filter(Boolean).pop() ?? projectPath)
                : null;
              toast.info("Drift detected", {
                description: projBasename
                  ? `${projBasename} · eidolons.lock changed`
                  : "eidolons.lock changed",
              });
            }
            return "drift";
          });

          // Auto-clear back to watching after TTL
          clearDriftTimer();
          clearTimerRef.current = setTimeout(() => {
            if (active) setState("watching");
          }, DRIFT_TTL_MS);
        },
      );

      if (!active) {
        unlisten();
        return;
      }

      unlistenRef.current = unlisten;
    }

    void startWatcher();

    return () => {
      active = false;
      clearDriftTimer();

      // Unsubscribe from the Tauri event listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      // Stop the Rust-side watcher
      invoke("stop_watching").catch((err) =>
        console.warn("[DriftWatcher] stop_watching failed:", err),
      );

      setState("idle");
      setLastEventAt(null);
    };
  }, [projectPath]);

  return { state, lastEventAt, projectBasename, clearDrift };
}
