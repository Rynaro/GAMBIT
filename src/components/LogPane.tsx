// LogPane.tsx — Bottom-anchored sync log panel.
//
// Layout:
//   [top bar]   project basename · status pill · spinner · Cancel/Close button
//   [body]      virtualized log body (anser ANSI → LogLine)
//   [footer]    line count · final exit code
//
// The panel is mounted by App.tsx whenever sync state !== "idle".
// Auto-scroll to bottom unless the user has scrolled up (pause auto-scroll).

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LogLine } from "./LogLine";
import { basename } from "@/lib/pathUtils";
import type { SyncResult } from "@/lib/useSync";
import "./LogPane.css";

interface LogPaneProps extends Pick<SyncResult, "state" | "lines" | "exitCode" | "projectPath" | "cancel" | "clear"> {}

const STATE_LABELS: Record<string, string> = {
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export function LogPane({ state, lines, exitCode, projectPath, cancel, clear }: LogPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track whether auto-scroll is enabled (disabled when user scrolls up).
  const autoScrollRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20, // ~12px font × 1.5 line-height = 18px; 20px headroom
    overscan: 20,
  });

  // Auto-scroll to bottom when new lines arrive and user is not scrolled up.
  useEffect(() => {
    if (autoScrollRef.current && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [lines.length, virtualizer]);

  // Pause / resume auto-scroll based on user scroll position.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }

  const projectName = projectPath ? basename(projectPath) : "project";
  const isRunning = state === "running";
  const isTerminal = state === "done" || state === "failed" || state === "cancelled";

  return (
    <div className="log-pane" role="region" aria-label="Sync output log">
      {/* Top bar */}
      <div className="log-pane-topbar">
        <span className="log-pane-title" title={projectPath ?? ""}>
          {projectName}
        </span>
        <span className="log-pane-status" data-state={state}>
          {STATE_LABELS[state] ?? state}
        </span>
        {isRunning && <span className="log-pane-spinner" aria-hidden="true" />}
        <span className="log-pane-spacer" />
        {isRunning && (
          <button
            type="button"
            className="log-pane-btn log-pane-btn--cancel"
            onClick={cancel}
            aria-label="Cancel sync"
          >
            Cancel
          </button>
        )}
        {isTerminal && (
          <button
            type="button"
            className="log-pane-btn log-pane-btn--close"
            onClick={clear}
            aria-label="Close log pane"
          >
            Close
          </button>
        )}
      </div>

      {/* Virtualized body */}
      <div
        ref={scrollRef}
        className="log-pane-body"
        onScroll={handleScroll}
        aria-live={isRunning ? "polite" : undefined}
        aria-relevant="additions"
      >
        <div
          className="log-pane-virtual-inner"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const line = lines[vItem.index];
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                className="log-pane-virtual-row"
                style={{ transform: `translateY(${vItem.start}px)` }}
              >
                <LogLine line={line} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="log-pane-footer">
        <span>{lines.length} line{lines.length !== 1 ? "s" : ""}</span>
        {exitCode !== null && (
          <span
            className="log-pane-footer-exit"
            data-ok={String(exitCode === 0)}
          >
            exit {exitCode}
          </span>
        )}
      </div>
    </div>
  );
}
