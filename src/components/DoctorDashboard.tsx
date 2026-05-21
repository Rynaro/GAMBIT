// DoctorDashboard.tsx — 9-check doctor health grid.
//
// Renders each DoctorCheck as a row with:
//   [i/n] badge · check name · status pill · "Details" toggle
//
// The first failed check auto-expands when state transitions to "done".
// A "View raw" affordance surfaces the raw stderr for escape-hatch debugging.

import { useEffect, useRef, useState } from "react";
import type { DoctorCheck } from "@/lib/parseDoctorStderr";
import type { DoctorRunState } from "@/lib/useDoctor";
import "./DoctorDashboard.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DoctorDashboardProps {
  state: DoctorRunState;
  checks: DoctorCheck[];
  rawStderr: string;
  exitCode: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rollupOutcome(checks: DoctorCheck[]): "pass" | "warn" | "fail" | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

function rollupSummary(checks: DoctorCheck[]) {
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  return { pass, warn, fail };
}

// ---------------------------------------------------------------------------
// CheckRow sub-component
// ---------------------------------------------------------------------------

interface CheckRowProps {
  check: DoctorCheck;
  forceExpanded?: boolean;
}

function CheckRow({ check, forceExpanded = false }: CheckRowProps) {
  const [expanded, setExpanded] = useState(forceExpanded);

  // Respond to external forceExpanded changes (e.g. auto-expand on done).
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const hasDetails = Boolean(check.message && check.message.trim());
  const toggleable = hasDetails;

  function toggle() {
    if (!toggleable) return;
    setExpanded((prev) => !prev);
  }

  const pillLabel =
    check.status === "pass" ? "pass" : check.status === "fail" ? "fail" : "warn";

  return (
    <div
      className="doctor-check"
      data-status={check.status}
      role="listitem"
    >
      {/* Header row */}
      <div
        className="doctor-check-header"
        onClick={toggle}
        role={toggleable ? "button" : undefined}
        aria-expanded={toggleable ? expanded : undefined}
        aria-label={`Check ${check.index} of ${check.total}: ${check.name} — ${pillLabel}`}
      >
        <span className="doctor-check-badge">
          [{check.index}/{check.total}]
        </span>
        <span className="doctor-check-name">{check.name}</span>
        <span className="doctor-status-pill" data-status={check.status}>
          {pillLabel}
        </span>
        {toggleable && (
          <span
            className="doctor-check-chevron"
            data-expanded={String(expanded)}
            aria-hidden="true"
          >
            ›
          </span>
        )}
      </div>

      {/* Detail body — only rendered when expanded and there is content */}
      {expanded && hasDetails && (
        <div className="doctor-check-details">
          <pre
            className="doctor-check-message"
            data-status={check.status}
          >
            {check.message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DoctorDashboard
// ---------------------------------------------------------------------------

export function DoctorDashboard({
  state,
  checks,
  rawStderr,
  exitCode,
}: DoctorDashboardProps) {
  const [showRaw, setShowRaw] = useState(false);

  // Index of the first failed check — auto-expand when run completes.
  const firstFailIdx = checks.findIndex((c) => c.status === "fail");
  const justDone = useRef(false);
  const [autoExpandIdx, setAutoExpandIdx] = useState<number | null>(null);

  useEffect(() => {
    if (state === "done" && !justDone.current) {
      justDone.current = true;
      if (firstFailIdx !== -1) {
        setAutoExpandIdx(firstFailIdx);
      }
    }
    if (state === "running") {
      justDone.current = false;
      setAutoExpandIdx(null);
    }
  }, [state, firstFailIdx]);

  const outcome = rollupOutcome(checks);
  const { pass, warn, fail } = rollupSummary(checks);
  const hasChecks = checks.length > 0;

  // Spinner indicator while running with no checks yet.
  const isRunningNoChecks = state === "running" && !hasChecks;

  return (
    <div className="doctor-dashboard" role="region" aria-label="Doctor health dashboard">
      {/* Check grid */}
      {hasChecks && (
        <>
          {/* Rollup bar */}
          {(state === "done" || state === "running") && outcome && (
            <div className="doctor-rollup" data-outcome={outcome} aria-live="polite">
              <span className="doctor-rollup-label">Results:</span>
              <span className="doctor-rollup-count doctor-rollup-count--pass">
                {pass} pass
              </span>
              {warn > 0 && (
                <span className="doctor-rollup-count doctor-rollup-count--warn">
                  {warn} warn
                </span>
              )}
              {fail > 0 && (
                <span className="doctor-rollup-count doctor-rollup-count--fail">
                  {fail} fail
                </span>
              )}
              {exitCode !== null && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color:
                      exitCode === 0
                        ? "var(--status-ok)"
                        : "var(--status-error)",
                  }}
                >
                  exit {exitCode}
                </span>
              )}
            </div>
          )}

          {/* Check rows */}
          <div className="doctor-checks" role="list" aria-label="Doctor checks">
            {checks.map((check, idx) => (
              <CheckRow
                key={`${check.index}-${check.total}`}
                check={check}
                forceExpanded={autoExpandIdx === idx}
              />
            ))}
          </div>

          {/* Raw stderr affordance */}
          {rawStderr && (
            <div className="doctor-raw-section">
              <button
                type="button"
                className="doctor-raw-toggle"
                onClick={() => setShowRaw((prev) => !prev)}
                aria-expanded={showRaw}
              >
                {showRaw ? "Hide raw output" : "View raw output"}
              </button>
              {showRaw && (
                <pre className="doctor-raw-body" aria-label="Raw doctor output">
                  {rawStderr}
                </pre>
              )}
            </div>
          )}
        </>
      )}

      {/* Running with no checks yet — show spinner placeholder rows */}
      {isRunningNoChecks && (
        <div className="doctor-empty-state" aria-live="polite" aria-busy="true">
          <span className="doctor-empty-icon" aria-hidden="true">⬡</span>
          <span className="doctor-empty-heading">Running checks…</span>
          <span className="doctor-empty-body">
            Analysing your project's Eidolon installation.
          </span>
        </div>
      )}
    </div>
  );
}
