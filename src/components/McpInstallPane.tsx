// McpInstallPane.tsx — Bottom-anchored panel for MCP install / uninstall streaming.
//
// Modes:
//   installing | uninstalling → streaming log output + Cancel button
//   done | failed | cancelled → exit-code badge + streamed lines + Close button
//
// Mounted by McpStoreRoute whenever mcp state is one of:
//   installing | uninstalling | done | failed | cancelled

import { basename } from "@/lib/pathUtils";
import type { UseMcpStoreResult } from "@/lib/useMcpStore";
import "./McpInstallPane.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface McpInstallPaneProps {
  projectPath: string | null;
  mcp: UseMcpStoreResult;
}

// ---------------------------------------------------------------------------
// State-label map
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<string, string> = {
  installing: "installing",
  uninstalling: "uninstalling",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpInstallPane({ projectPath, mcp }: McpInstallPaneProps) {
  const { state, activeMcp, lines, exitCode, cancel, dismiss } = mcp;

  const projectName = projectPath ? basename(projectPath) : "project";
  const isActive = state === "installing" || state === "uninstalling";
  const isTerminal = state === "done" || state === "failed" || state === "cancelled";
  const opLabel = activeMcp
    ? `${state === "installing" || state === "done" && mcp.lastAction === "install" ? "installing" : "uninstalling"}: ${activeMcp}`
    : state;

  return (
    <div className="mcp-install-pane" role="region" aria-label="MCP operation output">
      {/* Top bar */}
      <div className="mcp-install-pane-topbar">
        <span className="mcp-install-pane-title" title={projectPath ?? ""}>
          {projectName}
        </span>
        <span className="mcp-install-pane-op">
          {activeMcp && (
            <>
              <span className="mcp-install-pane-op-verb">
                {mcp.lastAction === "install" ? "installing" : "uninstalling"}
              </span>
              <span className="mcp-install-pane-op-name">{activeMcp}</span>
            </>
          )}
        </span>
        <span className="mcp-install-pane-status" data-state={state}>
          {STATE_LABELS[state] ?? state}
        </span>
        {isActive && (
          <span className="mcp-install-pane-spinner" aria-hidden="true" />
        )}
        <span className="mcp-install-pane-spacer" />
        {isActive && (
          <button
            type="button"
            className="mcp-install-pane-btn mcp-install-pane-btn--cancel"
            onClick={() => void cancel()}
            aria-label={`Cancel ${mcp.lastAction ?? "operation"}`}
          >
            Cancel
          </button>
        )}
        {isTerminal && (
          <button
            type="button"
            className="mcp-install-pane-btn mcp-install-pane-btn--close"
            onClick={dismiss}
            aria-label="Close MCP pane"
          >
            Close
          </button>
        )}
      </div>

      {/* Body — streamed output */}
      <div className="mcp-install-pane-body">
        {isTerminal && exitCode !== null && (
          <div className="mcp-install-pane-terminal-strip">
            <span
              className="mcp-install-pane-exit"
              data-ok={String(typeof exitCode === "number" && exitCode === 0)}
            >
              exit {exitCode}
            </span>
            {typeof exitCode === "number" && exitCode === 0 && (
              <span style={{ color: "var(--status-ok)" }}>
                {mcp.lastAction === "install" ? "Install" : "Uninstall"} complete.
              </span>
            )}
            {typeof exitCode === "number" && exitCode !== 0 && exitCode !== -2 && (
              <span style={{ color: "var(--status-error)" }}>
                {mcp.lastAction === "install" ? "Install" : "Uninstall"} failed.
              </span>
            )}
            {exitCode === -2 && (
              <span style={{ color: "var(--text-muted)" }}>Cancelled.</span>
            )}
          </div>
        )}

        <pre
          className="mcp-install-pane-log"
          aria-live={isActive ? "polite" : undefined}
          aria-relevant="additions"
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className={
                line.stream === "stderr"
                  ? "mcp-install-pane-log-line--stderr"
                  : undefined
              }
            >
              {line.text}
            </div>
          ))}
          {lines.length === 0 && isActive && (
            <div className="mcp-install-pane-log-placeholder">
              Waiting for output…
            </div>
          )}
        </pre>
      </div>

      {/* Footer */}
      <div className="mcp-install-pane-footer">
        <span>
          {lines.length} line{lines.length !== 1 ? "s" : ""}
        </span>
        {typeof exitCode === "number" && (
          <span
            className="mcp-install-pane-exit"
            data-ok={String(exitCode === 0)}
          >
            exit {exitCode}
          </span>
        )}
      </div>
    </div>
  );
}
