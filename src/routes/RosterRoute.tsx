// RosterRoute.tsx — Browse the PROJECT's installed Eidolons and launch one.
//
// Per the v0.3 SPECTRA decision the Roster is project-only: it reads the
// opened project's Eidolons via `readProjectEidolons` (S3) — `eidolons.yaml`
// + each `.eidolons/<name>/agent.md` — and renders them as a table. The
// global `~/.eidolons/nexus/roster/index.yaml` read is dropped.
//
// Each row carries a "Launch" action: clicking it hands the Eidolon off to
// the Sessions route (S7), pre-selected in its pre-launch picker, making the
// Roster the natural launch point for a live session.

import { RouteHeader } from "@/components/RouteHeader";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import { readProjectEidolons } from "@/lib/eidolonRoster";
import { getRoute } from "@/routes/index";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RosterRouteProps {
  projectPath: string | null;
  /** S8 — hand the chosen Eidolon to the Sessions route, pre-selected. */
  onLaunchSession: (eidolonName: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("roster");

export function RosterRoute({ projectPath, onLaunchSession }: RosterRouteProps) {
  const [eidolons, setEidolons] = useState<ProjectEidolon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setEidolons(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEidolons(null);

    readProjectEidolons(projectPath)
      .then((roster) => {
        if (cancelled) return;
        setEidolons(roster);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEidolons(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  // ------------------------------------------------------------------
  // Render: no project
  // ------------------------------------------------------------------
  if (!projectPath) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project selected.</p>
          <p className="route-empty-body">
            Pick a project folder from the sidebar to see its installed Eidolons.
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: loading
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Reading project roster…</div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: error
  // ------------------------------------------------------------------
  if (error || !eidolons) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Roster unreadable.</p>
            <p className="route-empty-body">
              Couldn't read this project's Eidolons. Maybe the kettle is louder than the wifi.
            </p>
            <p className="route-empty-body">
              Checked{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                eidolons.yaml
              </code>{" "}
              and each member's <code style={{ fontFamily: "var(--font-mono)" }}>agent.md</code>.
            </p>
            {error && (
              <span
                className="route-empty-note"
                style={{ marginTop: "4px", color: "var(--status-error)" }}
              >
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: empty roster
  // ------------------------------------------------------------------
  if (eidolons.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No Eidolons in this project.</p>
          <p className="route-empty-body">
            Add members to <code style={{ fontFamily: "var(--font-mono)" }}>eidolons.yaml</code> and
            run <code style={{ fontFamily: "var(--font-mono)" }}>eidolons sync</code> to install
            them.
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: project Eidolons
  // ------------------------------------------------------------------
  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
      <div className="route-card">
        <p className="route-card-title">Project Eidolons</p>
        <table className="route-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Description</th>
              <th>Methodology</th>
              <th>Tools</th>
              <th>Launch</th>
            </tr>
          </thead>
          <tbody>
            {eidolons.map((e) => (
              <tr key={e.name}>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {e.name.toUpperCase()}
                </td>
                <td>{e.role || "—"}</td>
                <td>{e.description || "—"}</td>
                <td className="mono">
                  {e.methodology
                    ? `${e.methodology}${e.methodologyVersion ? ` ${e.methodologyVersion}` : ""}`
                    : "—"}
                </td>
                <td className="mono">
                  {e.allowedTools.length} tool{e.allowedTools.length === 1 ? "" : "s"}
                </td>
                <td>
                  <button
                    type="button"
                    className="route-verb-btn primary"
                    onClick={() => onLaunchSession(e.name)}
                    aria-label={`Launch ${e.name} as a session`}
                  >
                    Launch
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
