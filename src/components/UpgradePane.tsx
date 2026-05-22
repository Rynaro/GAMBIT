// UpgradePane.tsx — Bottom-anchored upgrade panel with two visual modes.
//
// Modes:
//   checking  → spinner + "Checking for upgrades…" headline
//   reviewing → plan-review table (nexus row + member rows) + Apply/Dismiss footer
//   applying  → streaming log output + Cancel button
//   done | failed | cancelled → exit-code badge + plan summary + Close button
//
// Mounted by App.tsx whenever upgrade state !== "idle".

import { basename } from "@/lib/pathUtils";
import type { UpgradeMember } from "@/lib/upgrade.types";
import type { UseUpgradeResult } from "@/lib/useUpgrade";
import "./UpgradePane.css";

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  if (status === "upgrade available") {
    return <span className="upgrade-badge upgrade-badge--available">upgrade available</span>;
  }
  if (status === "up-to-date") {
    return <span className="upgrade-badge upgrade-badge--uptodate">up-to-date</span>;
  }
  if (status === "pinned-out") {
    return <span className="upgrade-badge upgrade-badge--pinned">pinned-out</span>;
  }
  // Unknown future enum — render permissively.
  return <span className="upgrade-badge upgrade-badge--unknown">{status}</span>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UpgradePaneProps {
  projectPath: string | null;
  upgrade: UseUpgradeResult;
}

// ---------------------------------------------------------------------------
// State-label map
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<string, string> = {
  checking: "checking",
  reviewing: "review",
  applying: "applying",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UpgradePane({ projectPath, upgrade }: UpgradePaneProps) {
  const { state, plan, lines, exitCode, apply, nexusUpgrade, cancel, dismiss } = upgrade;

  const projectName = projectPath ? basename(projectPath) : "project";
  const isActive = state === "checking" || state === "applying";
  const isTerminal = state === "done" || state === "failed" || state === "cancelled";

  // Footer button row is rendered inside the pane body for reviewing mode.

  return (
    <div className="upgrade-pane" role="region" aria-label="Upgrade panel">
      {/* Top bar */}
      <div className="upgrade-pane-topbar">
        <span className="upgrade-pane-title" title={projectPath ?? ""}>
          {projectName}
        </span>
        <span className="upgrade-pane-status" data-state={state}>
          {STATE_LABELS[state] ?? state}
        </span>
        {isActive && <span className="upgrade-pane-spinner" aria-hidden="true" />}
        <span className="upgrade-pane-spacer" />
        {state === "applying" && (
          <button
            type="button"
            className="upgrade-pane-btn upgrade-pane-btn--cancel"
            onClick={cancel}
            aria-label="Cancel upgrade"
          >
            Cancel
          </button>
        )}
        {isTerminal && (
          <button
            type="button"
            className="upgrade-pane-btn upgrade-pane-btn--close"
            onClick={dismiss}
            aria-label="Close upgrade pane"
          >
            Close
          </button>
        )}
      </div>

      {/* Body */}
      <div className="upgrade-pane-body">
        {/* ---- checking ---- */}
        {state === "checking" && (
          <div className="upgrade-pane-checking">
            <span>Checking for upgrades…</span>
          </div>
        )}

        {/* ---- reviewing ---- */}
        {state === "reviewing" && plan && (
          <>
            {/* Summary row */}
            <div className="upgrade-pane-summary">
              <div className="upgrade-pane-summary-item">
                <strong>{plan.summary.member_upgrades_available}</strong>
                &nbsp;member upgrade{plan.summary.member_upgrades_available !== 1 ? "s" : ""}{" "}
                available
              </div>
              {plan.summary.member_upgrades_pinned_out > 0 && (
                <div className="upgrade-pane-summary-item">
                  <strong>{plan.summary.member_upgrades_pinned_out}</strong>&nbsp;pinned-out
                </div>
              )}
              <div className="upgrade-pane-summary-item">
                Nexus: <StatusBadge status={plan.nexus.status} />
              </div>
            </div>

            {/* Plan table */}
            <table className="upgrade-pane-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Installed</th>
                  <th>Latest</th>
                  <th>Constraint</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {/* Nexus row first */}
                <tr>
                  <td style={{ fontWeight: 600 }}>nexus</td>
                  <td className="mono">{plan.nexus.current.tag}</td>
                  <td className="mono">{plan.nexus.latest.tag}</td>
                  <td className="mono">—</td>
                  <td>
                    <StatusBadge status={plan.nexus.status} />
                  </td>
                </tr>
                {/* Member rows */}
                {plan.members.map((member: UpgradeMember) => (
                  <tr key={member.name}>
                    <td style={{ fontWeight: 600 }}>{member.name}</td>
                    <td className="mono">{member.installed}</td>
                    <td className="mono">{member.latest}</td>
                    <td className="mono">{member.constraint}</td>
                    <td>
                      <StatusBadge status={member.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ---- applying ---- */}
        {state === "applying" && (
          <pre className="upgrade-pane-log" aria-live="polite" aria-relevant="additions">
            {lines.map((line, i) => (
              <div
                key={i}
                className={line.stream === "stderr" ? "upgrade-pane-log-line--stderr" : undefined}
              >
                {line.text}
              </div>
            ))}
          </pre>
        )}

        {/* ---- terminal states — show exit badge + plan summary ---- */}
        {isTerminal && (
          <>
            {exitCode !== null && (
              <div className="upgrade-pane-terminal-strip">
                <span
                  className="upgrade-pane-footer-exit"
                  data-ok={String(typeof exitCode === "number" && exitCode === 0)}
                >
                  exit {exitCode}
                </span>
                {typeof exitCode === "number" && exitCode === 0 && (
                  <span style={{ color: "var(--status-ok)" }}>Upgrade complete.</span>
                )}
                {typeof exitCode === "number" && exitCode !== 0 && exitCode !== -2 && (
                  <span style={{ color: "var(--status-error)" }}>Upgrade failed.</span>
                )}
                {exitCode === -2 && (
                  <span style={{ color: "var(--text-muted)" }}>Upgrade cancelled.</span>
                )}
              </div>
            )}
            {/* Show log lines from apply phase if present */}
            {lines.length > 0 && (
              <pre className="upgrade-pane-log">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.stream === "stderr" ? "upgrade-pane-log-line--stderr" : undefined
                    }
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="upgrade-pane-footer">
        {state === "reviewing" && plan && (
          <>
            <span>
              {plan.summary.member_upgrades_available} upgrade
              {plan.summary.member_upgrades_available !== 1 ? "s" : ""} pending
            </span>
            <span className="upgrade-pane-footer-spacer" />
            <button
              type="button"
              className="upgrade-pane-btn upgrade-pane-btn--close"
              onClick={dismiss}
              aria-label="Dismiss upgrade plan"
            >
              Dismiss
            </button>
            {plan.nexus.status === "upgrade available" && (
              <button
                type="button"
                className="upgrade-action-btn upgrade-nexus-btn"
                onClick={() => projectPath && void nexusUpgrade(projectPath)}
                disabled={state !== "reviewing" || !projectPath}
                aria-label={`Upgrade nexus from ${plan.nexus.current.tag} to ${plan.nexus.latest.tag}`}
              >
                Upgrade nexus ({plan.nexus.current.tag} → {plan.nexus.latest.tag})
              </button>
            )}
            {plan.nexus.status === "up-to-date" && (
              <span className="upgrade-nexus-uptodate-pill">Nexus up-to-date</span>
            )}
            <button
              type="button"
              className="upgrade-pane-btn upgrade-pane-btn--primary"
              onClick={() => projectPath && void apply(projectPath)}
              disabled={!projectPath}
              aria-label="Apply all upgrades"
            >
              Apply all
            </button>
          </>
        )}
        {state === "applying" && (
          <>
            <span>
              {lines.length} line{lines.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
        {isTerminal && exitCode !== null && (
          <>
            <span>
              {lines.length} line{lines.length !== 1 ? "s" : ""}
            </span>
            <span className="upgrade-pane-footer-spacer" />
            <span
              className="upgrade-pane-footer-exit"
              data-ok={String(typeof exitCode === "number" && exitCode === 0)}
            >
              exit {exitCode}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
