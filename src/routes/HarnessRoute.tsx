// HarnessRoute.tsx — Junction install status and harness-bound features.
// Reads .eidolons/harness/manifest.json from the selected project.

import { useState, useEffect } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HarnessManifest {
  version?: string;
  installed_at?: string;
  binary_path?: string;
  features?: string[];
  health?: string;
}

interface HarnessRouteProps {
  projectPath: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("harness");

export function HarnessRoute({ projectPath }: HarnessRouteProps) {
  const [manifest, setManifest] = useState<HarnessManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setManifest(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    readTextFile(`${projectPath}/.eidolons/harness/manifest.json`)
      .then((raw) => {
        if (cancelled) return;
        setManifest(JSON.parse(raw) as HarnessManifest);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setManifest(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectPath]);

  if (!projectPath) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project selected.</p>
          <p className="route-empty-body">
            Pick a project to see its Junction harness status.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Checking harness…</div>
      </div>
    );
  }

  // Not installed
  if (error || !manifest) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Junction not installed.</p>
            <p className="route-empty-body">
              The harness adds reasoning-step tracing to your sessions. Install it with:
            </p>
            <span className="route-empty-note">
              eidolons harness install
            </span>
            <p className="route-empty-body" style={{ marginTop: "8px" }}>
              No manifest found at{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                .eidolons/harness/manifest.json
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const features = manifest.features ?? [];
  const health = manifest.health ?? "unknown";

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      {/* Status card */}
      <div className="route-card">
        <p className="route-card-title">Junction status</p>
        <table className="route-table">
          <tbody>
            <tr>
              <td style={{ color: "var(--text-muted)", width: "140px" }}>Health</td>
              <td>
                <span
                  className={`badge ${
                    health === "healthy" ? "badge-ok" :
                    health === "degraded" ? "badge-warn" :
                    health === "error" ? "badge-error" :
                    "badge-muted"
                  }`}
                >
                  {health}
                </span>
              </td>
            </tr>
            <tr>
              <td style={{ color: "var(--text-muted)" }}>Version</td>
              <td className="mono">{manifest.version ?? "—"}</td>
            </tr>
            {manifest.binary_path && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Binary</td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {manifest.binary_path}
                </td>
              </tr>
            )}
            {manifest.installed_at && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Installed</td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {manifest.installed_at}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Features */}
      {features.length > 0 && (
        <div className="route-card">
          <p className="route-card-title">Harness features</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {features.map((f) => (
              <span key={f} className="badge badge-ok">{f}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
