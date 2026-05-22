// useSync.ts — React hook that manages live `eidolons sync` streaming state.
//
// State machine:
//   idle      — no sync in flight
//   running   — spawned process is live, lines arriving
//   done      — process exited with exit_code 0
//   failed    — process exited with exit_code != 0
//   cancelled — user called cancel(); process killed
//
// IPC contract (3 events, 2 commands):
//   Events  : sync-stdout   { line: string; ts: string }
//             sync-stderr   { line: string; ts: string }
//             sync-complete { exit_code: number }
//   Commands: start_sync    (projectPath: string) → void
//             cancel_sync   ()                    → void

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncState = "idle" | "running" | "done" | "failed" | "cancelled";

export interface SyncLine {
  /** Raw line text (may contain ANSI escapes). */
  text: string;
  /** Stream: stdout or stderr. */
  stream: "stdout" | "stderr";
  /** ISO 8601 timestamp emitted by the Rust side. */
  ts: string;
}

export interface SyncResult {
  state: SyncState;
  lines: SyncLine[];
  exitCode: number | null;
  projectPath: string | null;
  start: (projectPath: string) => void;
  cancel: () => void;
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Tauri event payloads (must match sync.rs struct definitions)
// ---------------------------------------------------------------------------

interface LinePayload {
  line: string;
  ts: string;
}

interface CompletePayload {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSync(): SyncResult {
  const [state, setState] = useState<SyncState>("idle");
  const [lines, setLines] = useState<SyncLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);

  // Unlisten refs — cleaned up when a new run starts or on unmount.
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  /** Remove all active Tauri event listeners. */
  function detachListeners() {
    for (const fn of unlistenRefs.current) {
      fn();
    }
    unlistenRefs.current = [];
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      detachListeners();
    };
  }, []);

  const start = useCallback((path: string) => {
    // Tear down any previous listeners before attaching new ones.
    detachListeners();

    setProjectPath(path);
    setState("running");
    setLines([]);
    setExitCode(null);

    // Attach event listeners before invoking start_sync to avoid a race where
    // events arrive before we register.
    async function attach() {
      const unlistenStdout = await listen<LinePayload>("sync-stdout", (ev) => {
        setLines((prev) => [
          ...prev,
          { text: ev.payload.line, stream: "stdout", ts: ev.payload.ts },
        ]);
      });

      const unlistenStderr = await listen<LinePayload>("sync-stderr", (ev) => {
        setLines((prev) => [
          ...prev,
          { text: ev.payload.line, stream: "stderr", ts: ev.payload.ts },
        ]);
      });

      const unlistenComplete = await listen<CompletePayload>("sync-complete", (ev) => {
        const code = ev.payload.exitCode;
        setExitCode(code);
        setState(code === 0 ? "done" : "failed");
        detachListeners();

        const basename = path.split("/").filter(Boolean).pop() ?? path;
        if (code === 0) {
          toast.success("Sync complete", {
            description: `${basename} · exit 0`,
          });
        } else {
          toast.error("Sync failed", {
            description: `exit ${code}`,
            duration: Number.POSITIVE_INFINITY,
          });
        }
      });

      unlistenRefs.current = [unlistenStdout, unlistenStderr, unlistenComplete];

      // Invoke the Rust command. If it errors immediately (e.g. CLI not found),
      // the Rust side emits sync-error via stderr line or returns an Err — we
      // surface the string as a synthetic error line.
      try {
        await invoke("start_sync", { projectPath: path });
      } catch (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        setLines((prev) => [
          ...prev,
          {
            text: `[gambit] error: ${msg}`,
            stream: "stderr",
            ts: new Date().toISOString(),
          },
        ]);
        setExitCode(1);
        setState("failed");
        detachListeners();
      }
    }

    void attach();
  }, []);

  const cancel = useCallback(() => {
    invoke("cancel_sync").catch((err) => {
      console.warn("[useSync] cancel_sync failed:", err);
    });
    // Optimistically move to cancelled; sync-complete may still arrive
    // and overwrite — that is fine.
    setState("cancelled");
    setExitCode(null);
    detachListeners();
    toast.info("Sync cancelled");
  }, []);

  const clear = useCallback(() => {
    detachListeners();
    setState("idle");
    setLines([]);
    setExitCode(null);
    setProjectPath(null);
  }, []);

  return { state, lines, exitCode, projectPath, start, cancel, clear };
}
