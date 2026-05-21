// useMcpStore.ts — React hook managing the MCP Store list + install/uninstall flow.
//
// State machine:
//   idle         — no operation in flight
//   loading      — mcp_list is in flight (one-shot)
//   ready        — list loaded; entries rendered in table
//   installing   — streaming mcp_install output
//   uninstalling — streaming mcp_uninstall output
//   done         — last op exited; auto-refreshes the list
//   failed       — last op failed
//   cancelled    — user called cancel() during streaming
//
// IPC contract:
//   Commands: mcp_list        (projectPath: string) → McpListEntry[]
//             mcp_install     (projectPath: string, name: string) → void
//             mcp_uninstall   (projectPath: string, name: string) → void
//             mcp_cancel      ()                                   → void
//   Events  : mcp-stdout  { line: string; ts: string }
//             mcp-stderr  { line: string; ts: string }
//             mcp-complete { exitCode: number; action: string; name: string }

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { McpListEntry, McpAction, McpCompletePayload } from "./mcp.types";
import type { SyncLine } from "./useSync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpStorePhase =
  | "idle"
  | "loading"
  | "ready"
  | "installing"
  | "uninstalling"
  | "done"
  | "failed"
  | "cancelled";

export interface UseMcpStoreResult {
  state: McpStorePhase;
  entries: McpListEntry[];
  lines: SyncLine[];
  exitCode: number | null;
  activeMcp: string | null;
  lastAction: McpAction | null;
  error: string | null;
  refresh: () => Promise<void>;
  install: (name: string) => Promise<void>;
  uninstall: (name: string) => Promise<void>;
  cancel: () => Promise<void>;
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// Tauri event payloads (must match mcp.rs struct definitions)
// ---------------------------------------------------------------------------

interface LinePayload {
  line: string;
  ts: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMcpStore(projectPath: string | null): UseMcpStoreResult {
  const [state, setState] = useState<McpStorePhase>("idle");
  const [entries, setEntries] = useState<McpListEntry[]>([]);
  const [lines, setLines] = useState<SyncLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [activeMcp, setActiveMcp] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<McpAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Unlisten refs — cleaned up when a new op starts or on unmount.
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
   * refresh — invoke `eidolons mcp list --json` (one-shot).
   * Transitions: any → loading → ready (success) | failed (error).
   */
  const refresh = useCallback(async () => {
    if (!projectPath) return;

    setState("loading");
    setError(null);

    try {
      const result = await invoke<McpListEntry[]>("mcp_list", { projectPath });
      setEntries(result);
      setState("ready");
    } catch (err) {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      setError(msg);
      setState("failed");
    }
  }, [projectPath]);

  // On mount (or projectPath change), auto-refresh if a project is present.
  useEffect(() => {
    if (projectPath) {
      void refresh();
    } else {
      setState("idle");
      setEntries([]);
    }
  }, [projectPath]); // refresh is stable; we only re-run when projectPath changes

  /**
   * startStreamingOp — shared logic for install and uninstall.
   */
  const startStreamingOp = useCallback(
    async (name: string, action: McpAction) => {
      if (!projectPath) return;

      // Tear down any previous listeners before attaching new ones.
      detachListeners();

      setActiveMcp(name);
      setLastAction(action);
      setState(action === "install" ? "installing" : "uninstalling");
      setLines([]);
      setExitCode(null);
      setError(null);

      // Attach event listeners before invoking the command to avoid a race
      // where events arrive before we register.
      const unlistenStdout = await listen<LinePayload>("mcp-stdout", (ev) => {
        setLines((prev) => [
          ...prev,
          { text: ev.payload.line, stream: "stdout", ts: ev.payload.ts },
        ]);
      });

      const unlistenStderr = await listen<LinePayload>("mcp-stderr", (ev) => {
        setLines((prev) => [
          ...prev,
          { text: ev.payload.line, stream: "stderr", ts: ev.payload.ts },
        ]);
      });

      const unlistenComplete = await listen<McpCompletePayload>(
        "mcp-complete",
        (ev) => {
          const code = ev.payload.exitCode;
          setExitCode(code);
          if (code === -2) {
            setState("cancelled");
          } else {
            setState(code === 0 ? "done" : "failed");
          }
          detachListeners();
          // Auto-refresh the list so row states update after completion.
          if (code === 0 || code === -2) {
            setTimeout(() => {
              void refresh();
            }, 300);
          }
        }
      );

      unlistenRefs.current = [unlistenStdout, unlistenStderr, unlistenComplete];

      // Invoke the Rust command.
      const rustCmd = action === "install" ? "mcp_install" : "mcp_uninstall";
      try {
        await invoke(rustCmd, { projectPath, name });
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
        setError(msg);
        setExitCode(1);
        setState("failed");
        detachListeners();
      }
    },
    [projectPath, refresh]
  );

  /** install — stream `eidolons mcp install <name>`. */
  const install = useCallback(
    async (name: string) => {
      await startStreamingOp(name, "install");
    },
    [startStreamingOp]
  );

  /** uninstall — stream `eidolons mcp uninstall <name>`. */
  const uninstall = useCallback(
    async (name: string) => {
      await startStreamingOp(name, "uninstall");
    },
    [startStreamingOp]
  );

  /** cancel — kill the active mcp child process. */
  const cancel = useCallback(async () => {
    try {
      await invoke("mcp_cancel");
    } catch (err) {
      console.warn("[useMcpStore] mcp_cancel failed:", err);
    }
    // Optimistically move to cancelled; mcp-complete may still arrive.
    setState("cancelled");
    setExitCode(null);
    detachListeners();
  }, []);

  /** dismiss — reset back to ready so the McpInstallPane closes. */
  const dismiss = useCallback(() => {
    detachListeners();
    setState("ready");
    setLines([]);
    setExitCode(null);
    setActiveMcp(null);
    setLastAction(null);
    setError(null);
  }, []);

  return {
    state,
    entries,
    lines,
    exitCode,
    activeMcp,
    lastAction,
    error,
    refresh,
    install,
    uninstall,
    cancel,
    dismiss,
  };
}
