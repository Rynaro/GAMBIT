// ResultCard.tsx — the terminal `result` summary for a turn.
//
// Surfaces the accounting carried on a `result` event: success/error, cost,
// turn count, and wall-clock duration — the cozy "turn closed" footer.
//
// S0 — it ALSO surfaces `permission_denials`: when a turn requested a tool
// claude-code did not have pre-approved, headless mode silently denies the
// call. Without this notice the turn looks "complete" while the requested
// work never happened.

import type { PermissionDenial } from "@/lib/session.types";

interface ResultCardProps {
  /** Result subtype, e.g. "success" / "error_max_turns" ("" when absent). */
  subtype: string;
  /** Whether the turn ended in an error state. */
  isError: boolean;
  /** Total billed cost in USD; null when not reported. */
  totalCostUsd: number | null;
  /** Number of model turns consumed; null when not reported. */
  numTurns: number | null;
  /** Wall-clock duration in milliseconds; null when not reported. */
  durationMs: number | null;
  /**
   * S0 — tool calls claude-code silently denied during the turn. Empty (the
   * default) renders no notice — the normal card is unchanged.
   */
  permissionDenials?: PermissionDenial[];
}

/** Render a millisecond duration as a compact human string. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

export function ResultCard({
  subtype,
  isError,
  totalCostUsd,
  numTurns,
  durationMs,
  permissionDenials = [],
}: ResultCardProps) {
  const outcome = isError ? "error" : "ok";

  // S0 — the distinct tool names that were denied, in first-seen order.
  const deniedTools = [
    ...new Set(permissionDenials.map((d) => d.toolName).filter((n) => n.length > 0)),
  ];

  return (
    <div className="session-result" data-outcome={outcome} role="status">
      <div className="session-result-head">
        <span className="session-result-glyph" aria-hidden="true">
          {isError ? "✕" : "✓"}
        </span>
        <span className="session-result-title">
          {isError ? "Turn ended with an error" : "Turn complete"}
        </span>
        {subtype && <span className="session-result-subtype">{subtype}</span>}
      </div>
      <div className="session-result-stats">
        {totalCostUsd !== null && (
          <span className="session-result-stat">
            <span className="session-result-stat-key">cost</span>
            <span className="session-result-stat-val">${totalCostUsd.toFixed(4)}</span>
          </span>
        )}
        {numTurns !== null && (
          <span className="session-result-stat">
            <span className="session-result-stat-key">turns</span>
            <span className="session-result-stat-val">{numTurns}</span>
          </span>
        )}
        {durationMs !== null && (
          <span className="session-result-stat">
            <span className="session-result-stat-key">duration</span>
            <span className="session-result-stat-val">{fmtDuration(durationMs)}</span>
          </span>
        )}
      </div>
      {permissionDenials.length > 0 && (
        <div className="session-result-denials" role="alert">
          <span className="session-result-denials-glyph" aria-hidden="true">
            ⚠
          </span>
          <div className="session-result-denials-text">
            <strong>
              {permissionDenials.length === 1
                ? "1 tool call was denied"
                : `${permissionDenials.length} tool calls were denied`}
              {deniedTools.length > 0 && <> — {deniedTools.join(", ")}</>}
            </strong>
            <span>
              claude-code blocked these tools because they are not pre-approved for this session.
              Relaunch with a looser permission mode (the composer's Options → permission mode) to
              allow them — in-app approval is coming.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
