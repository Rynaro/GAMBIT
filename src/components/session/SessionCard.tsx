// SessionCard.tsx — the session header card.
//
// Identifies the Eidolon driving the session (name + role), and surfaces the
// model + tool inventory from the `init` event once it arrives, plus the live
// session-state pill. This is the "centered on the Eidolon" header chrome.

import type { SessionState } from "@/lib/useSession";

interface SessionCardProps {
  /** The Eidolon identity driving the session. */
  eidolonName: string;
  /** The Eidolon's role line ("" when unknown). */
  role: string;
  /** Active `--permission-mode`. */
  permissionMode: string;
  /** Model serving the session — from the `init` event; null until seen. */
  model: string | null;
  /** Tool names available — from the `init` event; [] until seen. */
  tools: string[];
  /** Current session-machine state. */
  status: SessionState;
  /**
   * P1 — interrupt the in-flight turn. When provided AND a turn is running
   * (`turn-running` / `launching`) a prominent Stop control is surfaced in the
   * header beside the status pill. Omitted in create mode (no live turn).
   */
  onStop?: () => void;
}

/** Map a SessionState to a short human label + status-pill data attr. */
function statusLabel(status: SessionState): { label: string; tone: string } {
  switch (status) {
    case "launching":
      return { label: "launching", tone: "running" };
    case "turn-running":
      return { label: "thinking", tone: "running" };
    case "awaiting-input":
      return { label: "ready", tone: "ok" };
    case "failed":
      return { label: "failed", tone: "error" };
    case "ended":
      return { label: "ended", tone: "muted" };
    default:
      return { label: "idle", tone: "muted" };
  }
}

export function SessionCard({
  eidolonName,
  role,
  permissionMode,
  model,
  tools,
  status,
  onStop,
}: SessionCardProps) {
  const { label, tone } = statusLabel(status);
  // P1 — a turn is interruptible while it streams; the header Stop control is
  // shown only then, so it is obvious exactly when it is useful.
  const turnRunning = status === "turn-running" || status === "launching";

  return (
    <div className="session-card" role="region" aria-label={`Session with ${eidolonName}`}>
      <div className="session-card-head">
        <span className="session-card-glyph" aria-hidden="true">
          ⬡
        </span>
        <div className="session-card-identity">
          <span className="session-card-name">{eidolonName}</span>
          {role && <span className="session-card-role">{role}</span>}
        </div>
        {/* P1 — interrupt the running turn from the header. */}
        {onStop && turnRunning && (
          <button
            type="button"
            className="session-stop-btn session-card-stop"
            onClick={onStop}
            aria-label="Stop the running turn"
          >
            <span className="session-stop-glyph" aria-hidden="true">
              ■
            </span>
            Stop
          </button>
        )}
        <span className="session-status-pill" data-tone={tone}>
          {label}
        </span>
      </div>

      <div className="session-card-meta">
        <span className="session-card-meta-item">
          <span className="session-card-meta-key">mode</span>
          <span className="session-card-meta-val">{permissionMode}</span>
        </span>
        {model && (
          <span className="session-card-meta-item">
            <span className="session-card-meta-key">model</span>
            <span className="session-card-meta-val">{model}</span>
          </span>
        )}
        <span className="session-card-meta-item">
          <span className="session-card-meta-key">tools</span>
          <span className="session-card-meta-val">
            {tools.length > 0 ? `${tools.length} available` : "—"}
          </span>
        </span>
      </div>

      {tools.length > 0 && (
        <div className="session-card-tools">
          {tools.map((tool) => (
            <span key={tool} className="session-tool-tag">
              {tool}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
