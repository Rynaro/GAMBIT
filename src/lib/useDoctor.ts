// useDoctor.ts — React hook that manages live `eidolons doctor` streaming state.
//
// State machine:
//   idle      — no doctor run in flight
//   running   — spawned process is live, lines arriving
//   done      — process exited (any exit code)
//   failed    — process error (invoke() itself threw — e.g. CLI not found)
//   cancelled — user called cancel(); process killed
//
// IPC contract (3 events, 2 commands):
//   Events  : doctor-stdout   { line: string; ts: string }
//             doctor-stderr   { line: string; ts: string }
//             doctor-complete { exit_code: number }
//   Commands: start_doctor    (projectPath: string) → void
//             cancel_doctor   ()                    → void
//
// The hook parses stderr lines incrementally with parseDoctorStderr so the
// dashboard can render checks as they stream rather than waiting for complete.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseDoctorStderr, type DoctorCheck } from "./parseDoctorStderr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorRunState = "idle" | "running" | "done" | "failed" | "cancelled";

export interface DoctorResult {
  state: DoctorRunState;
  checks: DoctorCheck[];
  rawStderr: string;
  exitCode: number | null;
  start: (projectPath: string) => void;
  cancel: () => void;
  clear: () => void;
}

// ---------------------------------------------------------------------------
// Tauri event payloads (must match doctor.rs struct definitions)
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

export function useDoctor(): DoctorResult {
  const [state, setState] = useState<DoctorRunState>("idle");
  const [checks, setChecks] = useState<DoctorCheck[]>([]);
  const [rawStderr, setRawStderr] = useState<string>("");
  const [exitCode, setExitCode] = useState<number | null>(null);

  // Accumulate raw stderr so we can re-parse incrementally.
  const rawStderrRef = useRef<string>("");

  // Unlisten refs — cleaned up when a new run starts or on unmount.
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

  const start = useCallback((path: string) => {
    // Tear down any previous listeners before attaching new ones.
    detachListeners();

    // Reset state.
    rawStderrRef.current = "";
    setRawStderr("");
    setChecks([]);
    setExitCode(null);
    setState("running");

    // Attach event listeners before invoking start_doctor to avoid a race
    // where events arrive before we register.
    async function attach() {
      // Both stdout and stderr are fed into the same buffer so the parser sees
      // the full combined output. Check rows are on stdout; banner + summary
      // are on stderr.
      const appendLine = (text: string) => {
        rawStderrRef.current = rawStderrRef.current
          ? `${rawStderrRef.current}\n${text}`
          : text;
        setRawStderr(rawStderrRef.current);
        // Re-parse on every line for incremental dashboard updates.
        setChecks(parseDoctorStderr(rawStderrRef.current));
      };

      const unlistenStdout = await listen<LinePayload>("doctor-stdout", (ev) => {
        appendLine(ev.payload.line);
      });

      const unlistenStderr = await listen<LinePayload>("doctor-stderr", (ev) => {
        appendLine(ev.payload.line);
      });

      const unlistenComplete = await listen<CompletePayload>(
        "doctor-complete",
        (ev) => {
          const code = ev.payload.exitCode;
          setExitCode(code);
          // Final parse to ensure we didn't miss anything.
          setChecks(parseDoctorStderr(rawStderrRef.current));
          // doctor exits 1 when there are errors, 0 when all pass.
          // Both are valid "done" states from the UI perspective — the checks
          // themselves carry the pass/fail semantics.
          setState(code === -2 ? "cancelled" : "done");
          detachListeners();
        },
      );

      unlistenRefs.current = [unlistenStdout, unlistenStderr, unlistenComplete];

      // Invoke the Rust command. If it errors immediately (e.g. CLI not found),
      // surface the string as a synthetic error line.
      try {
        await invoke("start_doctor", { projectPath: path });
      } catch (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        rawStderrRef.current = `[gambit] error: ${msg}`;
        setRawStderr(rawStderrRef.current);
        setChecks([]);
        setExitCode(1);
        setState("failed");
        detachListeners();
      }
    }

    void attach();
  }, []);

  const cancel = useCallback(() => {
    invoke("cancel_doctor").catch((err) => {
      console.warn("[useDoctor] cancel_doctor failed:", err);
    });
    // Optimistically move to cancelled; doctor-complete may still arrive
    // and overwrite — that is fine.
    setState("cancelled");
    setExitCode(null);
    detachListeners();
  }, []);

  const clear = useCallback(() => {
    detachListeners();
    rawStderrRef.current = "";
    setState("idle");
    setChecks([]);
    setRawStderr("");
    setExitCode(null);
  }, []);

  return { state, checks, rawStderr, exitCode, start, cancel, clear };
}
