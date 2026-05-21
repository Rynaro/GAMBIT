// DoctorRoute.tsx — Doctor dashboard route.
//
// Renders the DoctorDashboard consuming useDoctor().
// Header: "Doctor" title · Run/Cancel button · "Last run" timestamp + exit code.
// Empty state (no project): friendly message with a prompt to pick a project.
//
// NOTE: This file overrides the stub produced by the parallel feat/v0.1-routes
// branch. On merge, this content takes precedence.

import { useEffect, useState } from "react";
import { useDoctor } from "@/lib/useDoctor";
import { DoctorDashboard } from "@/components/DoctorDashboard";
import { getProjectPath } from "@/lib/projectStore";

export function DoctorRoute() {
  const [projectPath, setProjectPath] = useState<string | null>(getProjectPath);

  // Re-read localStorage whenever the route mounts, in case it changed.
  useEffect(() => {
    setProjectPath(getProjectPath());
  }, []);
  const doctor = useDoctor();
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  function handleRun() {
    if (!projectPath) return;
    setLastRunAt(new Date());
    doctor.start(projectPath);
  }

  function handleCancel() {
    doctor.cancel();
  }

  const isRunning = doctor.state === "running";
  const hasProject = Boolean(projectPath);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-canvas)",
      }}
    >
      {/* Route header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-5)",
          padding: "var(--space-6) var(--space-9)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          background: "var(--bg-surface)",
        }}
      >
        <h1
          style={{
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            flex: 1,
          }}
        >
          Doctor
        </h1>

        {/* Last run metadata */}
        {lastRunAt && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-muted)",
            }}
          >
            Last run: {lastRunAt.toLocaleTimeString()}
            {doctor.exitCode !== null && (
              <span
                style={{
                  marginLeft: "var(--space-3)",
                  color:
                    doctor.exitCode === 0
                      ? "var(--status-ok)"
                      : "var(--status-error)",
                }}
              >
                exit {doctor.exitCode}
              </span>
            )}
          </span>
        )}

        {/* Run / Cancel button */}
        {hasProject && (
          isRunning ? (
            <button
              type="button"
              className="doctor-cancel-btn"
              onClick={handleCancel}
              aria-label="Cancel doctor run"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="doctor-run-btn"
              onClick={handleRun}
              aria-label="Run eidolons doctor"
            >
              Run checks
            </button>
          )
        )}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {!hasProject ? (
          /* No project selected — empty state */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-5)",
              padding: "var(--space-11) var(--space-9)",
              textAlign: "center",
              maxWidth: "520px",
              margin: "0 auto",
            }}
          >
            <span
              style={{ fontSize: "34px", lineHeight: 1 }}
              aria-hidden="true"
            >
              ⬡
            </span>
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              No project selected
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              Pick a project folder from the sidebar to run doctor checks. The
              dashboard will surface all 9 Eidolon health checks once a project
              is loaded.
            </p>
          </div>
        ) : doctor.state === "idle" && doctor.checks.length === 0 ? (
          /* Project selected, no run yet */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-5)",
              padding: "var(--space-11) var(--space-9)",
              textAlign: "center",
              maxWidth: "520px",
              margin: "0 auto",
            }}
          >
            <span
              style={{ fontSize: "34px", lineHeight: 1 }}
              aria-hidden="true"
            >
              ✦
            </span>
            <h2
              style={{
                fontSize: "22px",
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
            >
              Doctor hasn't run yet
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              Press <strong>Run checks</strong> to analyse your project's
              Eidolon installation across 9 health checks — from lock files and
              host wiring to cache hygiene and pending upgrades.
            </p>
            <button
              type="button"
              className="doctor-run-btn"
              onClick={handleRun}
              style={{ marginTop: "var(--space-4)" }}
            >
              Run checks
            </button>
          </div>
        ) : (
          /* Dashboard with live / completed checks */
          <DoctorDashboard
            state={doctor.state}
            checks={doctor.checks}
            rawStderr={doctor.rawStderr}
            exitCode={doctor.exitCode}
          />
        )}
      </div>
    </div>
  );
}
