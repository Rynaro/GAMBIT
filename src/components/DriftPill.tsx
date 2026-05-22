// DriftPill.tsx — Sticky title-bar strip showing file-watcher state.
//
// States:
//   idle      — no project selected; pill is invisible (opacity 0, no pointer events)
//   watching  — project selected, watcher running; green dot + project basename
//   drift     — lock changed recently; amber pulse + "lock changed" tagline
//               clicking in drift state clears immediately back to watching
//
// All state transitions carry a 220ms cubic-bezier(0.32, 0.72, 0, 1) fade
// per the GAMBIT design tokens.

import "./DriftPill.css";
import type { DriftWatcherResult } from "@/lib/useDriftWatcher";

type Props = Pick<DriftWatcherResult, "state" | "projectBasename" | "clearDrift">;

export function DriftPill({ state, projectBasename, clearDrift }: Props) {
  function handleClick() {
    if (state === "drift") {
      clearDrift();
    }
  }

  return (
    <header
      className="drift-pill-header"
      data-state={state}
      onClick={handleClick}
      role={state === "drift" ? "button" : undefined}
      tabIndex={state === "drift" ? 0 : undefined}
      onKeyDown={
        state === "drift"
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                clearDrift();
              }
            }
          : undefined
      }
      aria-label={
        state === "drift"
          ? `${projectBasename ?? "Project"} — lock changed, click to clear`
          : state === "watching"
            ? `Watching ${projectBasename ?? "project"}`
            : undefined
      }
    >
      <div className="drift-pill-left">
        <span className="drift-pill-dot" aria-hidden="true" />
        <span className="drift-pill-basename">{projectBasename ?? ""}</span>
      </div>

      <span className="drift-pill-right">
        {state === "drift" ? "lock changed — click to clear" : "watching"}
      </span>
    </header>
  );
}
