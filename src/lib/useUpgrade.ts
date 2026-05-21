// useUpgrade.ts — React hook managing the `eidolons upgrade` two-phase flow.
//
// State machine:
//   idle       — no upgrade operation in flight
//   checking   — running `eidolons upgrade --check --json` (one-shot invoke)
//   reviewing  — plan received; user is reviewing the table
//   applying   — streaming `eidolons upgrade --yes` or `eidolons upgrade --system --yes` output
//   done       — apply exited with code 0
//   failed     — apply exited with code != 0, or check/invoke threw
//   cancelled  — user called cancel() during applying
//
// IPC contract:
//   Commands: check_upgrades        (projectPath: string) → UpgradePlan
//             start_upgrade_apply   (projectPath: string) → void
//             start_nexus_upgrade   (projectPath: string) → void
//             cancel_upgrade        ()                    → void
//   Events  : upgrade-stdout  { line: string; ts: string }
//             upgrade-stderr  { line: string; ts: string }
//             upgrade-complete { exitCode: number }

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import type { UpgradePlan } from "./upgrade.types";
import type { SyncLine } from "./useSync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpgradePhase =
  | "idle"
  | "checking"
  | "reviewing"
  | "applying"
  | "done"
  | "failed"
  | "cancelled";

export interface UseUpgradeResult {
  state: UpgradePhase;
  plan: UpgradePlan | null;
  lines: SyncLine[];
  exitCode: number | null;
  error: string | null;
  lastAction: "members" | "nexus" | null;
  check: (projectPath: string) => Promise<void>;
  apply: (projectPath: string) => Promise<void>;
  nexusUpgrade: (projectPath: string) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

// ---------------------------------------------------------------------------
// Tauri event payloads (must match upgrade.rs struct definitions)
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

export function useUpgrade(): UseUpgradeResult {
  const [state, setState] = useState<UpgradePhase>("idle");
  const [plan, setPlan] = useState<UpgradePlan | null>(null);
  const [lines, setLines] = useState<SyncLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"members" | "nexus" | null>(null);

  // Unlisten refs — cleaned up when a new apply starts or on unmount.
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
   * check — invoke `eidolons upgrade --check --json` (one-shot).
   * Transitions: idle → checking → reviewing (success) | failed (error).
   */
  const check = useCallback(async (projectPath: string) => {
    setState("checking");
    setPlan(null);
    setLines([]);
    setExitCode(null);
    setError(null);

    try {
      const result = await invoke<UpgradePlan>("check_upgrades", {
        projectPath,
      });
      setPlan(result);
      setState("reviewing");
    } catch (err) {
      const msg = typeof err === "string" ? err : JSON.stringify(err);
      setError(msg);
      setState("failed");
    }
  }, []);

  /**
   * apply — stream `eidolons upgrade --yes`.
   * Transitions: reviewing → applying → done | failed | cancelled.
   */
  const apply = useCallback(async (projectPath: string) => {
    // Tear down any previous listeners before attaching new ones.
    detachListeners();

    setState("applying");
    setLastAction("members");
    setLines([]);
    setExitCode(null);
    setError(null);

    // Attach event listeners before invoking start_upgrade_apply to avoid a
    // race where events arrive before we register.
    const unlistenStdout = await listen<LinePayload>("upgrade-stdout", (ev) => {
      setLines((prev) => [
        ...prev,
        { text: ev.payload.line, stream: "stdout", ts: ev.payload.ts },
      ]);
    });

    const unlistenStderr = await listen<LinePayload>("upgrade-stderr", (ev) => {
      setLines((prev) => [
        ...prev,
        { text: ev.payload.line, stream: "stderr", ts: ev.payload.ts },
      ]);
    });

    const unlistenComplete = await listen<CompletePayload>(
      "upgrade-complete",
      (ev) => {
        const code = ev.payload.exitCode;
        setExitCode(code);
        const verb = "Member upgrade";
        if (code === -2) {
          setState("cancelled");
          toast.info(`${verb} cancelled`);
        } else if (code === 0) {
          setState("done");
          toast.success(`${verb} complete`);
        } else {
          setState("failed");
          toast.error(`${verb} failed`, {
            description: `exit ${code}`,
            duration: Infinity,
          });
        }
        detachListeners();
      }
    );

    unlistenRefs.current = [unlistenStdout, unlistenStderr, unlistenComplete];

    // Invoke the Rust command.
    try {
      await invoke("start_upgrade_apply", { projectPath });
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
  }, []);

  /**
   * nexusUpgrade — stream `eidolons upgrade --system --yes`.
   * Upgrades only the nexus; member Eidolons are untouched.
   * Transitions: reviewing → applying → done | failed | cancelled.
   * Uses the same event names (upgrade-stdout/stderr/complete) so the
   * existing listener pair registered above is reused without changes.
   */
  const nexusUpgrade = useCallback(async (projectPath: string) => {
    // Tear down any previous listeners before attaching new ones.
    detachListeners();

    setState("applying");
    setLastAction("nexus");
    setLines([]);
    setExitCode(null);
    setError(null);

    // Attach event listeners before invoking start_nexus_upgrade to avoid a
    // race where events arrive before we register.
    const unlistenStdout = await listen<LinePayload>("upgrade-stdout", (ev) => {
      setLines((prev) => [
        ...prev,
        { text: ev.payload.line, stream: "stdout", ts: ev.payload.ts },
      ]);
    });

    const unlistenStderr = await listen<LinePayload>("upgrade-stderr", (ev) => {
      setLines((prev) => [
        ...prev,
        { text: ev.payload.line, stream: "stderr", ts: ev.payload.ts },
      ]);
    });

    const unlistenComplete = await listen<CompletePayload>(
      "upgrade-complete",
      (ev) => {
        const code = ev.payload.exitCode;
        setExitCode(code);
        const verb = "Nexus upgrade";
        if (code === -2) {
          setState("cancelled");
          toast.info(`${verb} cancelled`);
        } else if (code === 0) {
          setState("done");
          toast.success(`${verb} complete`);
        } else {
          setState("failed");
          toast.error(`${verb} failed`, {
            description: `exit ${code}`,
            duration: Infinity,
          });
        }
        detachListeners();
      }
    );

    unlistenRefs.current = [unlistenStdout, unlistenStderr, unlistenComplete];

    // Invoke the Rust command.
    try {
      await invoke("start_nexus_upgrade", { projectPath });
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
  }, []);

  /** cancel — kill the apply child process. */
  const cancel = useCallback(() => {
    invoke("cancel_upgrade").catch((err) => {
      console.warn("[useUpgrade] cancel_upgrade failed:", err);
    });
    // Optimistically move to cancelled; upgrade-complete may still arrive.
    setState("cancelled");
    setExitCode(null);
    detachListeners();
  }, []);

  /** dismiss — reset to idle so the UpgradePane closes. */
  const dismiss = useCallback(() => {
    detachListeners();
    setState("idle");
    setPlan(null);
    setLines([]);
    setExitCode(null);
    setError(null);
    setLastAction(null);
  }, []);

  return { state, plan, lines, exitCode, error, lastAction, check, apply, nexusUpgrade, cancel, dismiss };
}
