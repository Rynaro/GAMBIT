// HarnessRoute.tsx — Junction install status and harness-bound features.
//
// Discovery order (primary → fallback):
//  1. PRIMARY:  ${projectPath}/eidolons.mcp.lock  (parsed YAML, find mcps[name==="junction"])
//  2. FALLBACK: ${projectPath}/.eidolons/harness/manifest.json  (legacy sidecar, JSON)
//
// If neither is found → empty state with install instructions.
// If mcp.lock entry found: show status pill, version, target (binary path),
//   source repo, installed_at. If sidecar manifest also found, show its extra
//   fields (features, health) under a "Sidecar details" sub-section.

import { RouteHeader } from "@/components/RouteHeader";
import { type McpEntry, findJunctionEntry, parseMcpLock } from "@/lib/parseMcpLock";
import { getRoute } from "@/routes/index";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extra fields that may live in the optional legacy sidecar manifest.json */
interface HarnessSidecar {
  features?: string[];
  health?: string;
  binary_path?: string;
}

interface HarnessRouteProps {
  projectPath: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("harness");

export function HarnessRoute({ projectPath }: HarnessRouteProps) {
  const [junctionEntry, setJunctionEntry] = useState<McpEntry | null>(null);
  const [sidecar, setSidecar] = useState<HarnessSidecar | null>(null);
  const [loading, setLoading] = useState(false);
  /** true = neither source found */
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!projectPath) {
      setJunctionEntry(null);
      setSidecar(null);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setJunctionEntry(null);
    setSidecar(null);
    setNotFound(false);

    async function discover() {
      // --- PRIMARY: eidolons.mcp.lock ---
      let entry: McpEntry | undefined;
      try {
        const raw = await readTextFile(`${projectPath}/eidolons.mcp.lock`);
        const lock = parseMcpLock(raw);
        entry = findJunctionEntry(lock);
      } catch {
        // file absent — fall through to sidecar check
      }

      // --- FALLBACK: .eidolons/harness/manifest.json ---
      let sidecarData: HarnessSidecar | null = null;
      try {
        const raw = await readTextFile(`${projectPath}/.eidolons/harness/manifest.json`);
        sidecarData = JSON.parse(raw) as HarnessSidecar;
      } catch {
        // sidecar absent — that's fine
      }

      if (cancelled) return;

      if (!entry && !sidecarData) {
        setNotFound(true);
      } else {
        // Promote sidecar binary_path into entry if primary has no target
        if (entry) {
          setJunctionEntry(entry);
        } else if (sidecarData) {
          // Sidecar-only: synthesise a minimal entry from sidecar fields
          setJunctionEntry({
            name: "junction",
            target: sidecarData.binary_path,
          } as McpEntry);
        }
        setSidecar(sidecarData);
      }
    }

    discover().finally(() => {
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
          <p className="route-empty-body">Pick a project to see its Junction harness status.</p>
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
        <div className="route-loading">Checking harness…</div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: not found
  // ------------------------------------------------------------------
  if (notFound || !junctionEntry) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Junction not installed.</p>
            <p className="route-empty-body">
              The harness adds reasoning-step tracing to your sessions. Install it with:
            </p>
            <span className="route-empty-note">eidolons harness install</span>
            <p
              className="route-empty-body"
              style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}
            >
              Checked <code style={{ fontFamily: "var(--font-mono)" }}>eidolons.mcp.lock</code> and{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>
                .eidolons/harness/manifest.json
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Junction registered
  // ------------------------------------------------------------------
  const health = sidecar?.health ?? null;
  const features = sidecar?.features ?? [];

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      {/* Status card — data sourced from eidolons.mcp.lock */}
      <div className="route-card">
        <p className="route-card-title">
          Junction status
          <span className="badge badge-ok" style={{ marginLeft: "8px", verticalAlign: "middle" }}>
            registered
          </span>
        </p>
        <table className="route-table">
          <tbody>
            {junctionEntry.version && (
              <tr>
                <td style={{ color: "var(--text-muted)", width: "140px" }}>Version</td>
                <td className="mono">{junctionEntry.version}</td>
              </tr>
            )}
            {junctionEntry.target && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Binary</td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {junctionEntry.target}
                </td>
              </tr>
            )}
            {junctionEntry.source?.repo && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Source</td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {junctionEntry.source.repo}
                </td>
              </tr>
            )}
            {junctionEntry.installed_at && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Installed</td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {junctionEntry.installed_at}
                </td>
              </tr>
            )}
            {junctionEntry.hosts_wired && junctionEntry.hosts_wired.length > 0 && (
              <tr>
                <td style={{ color: "var(--text-muted)" }}>Wired into</td>
                <td style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  {junctionEntry.hosts_wired.join(", ")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Sidecar details — only if .eidolons/harness/manifest.json present */}
      {sidecar && (
        <div className="route-card">
          <p className="route-card-title">Sidecar details</p>
          <table className="route-table">
            <tbody>
              {health && (
                <tr>
                  <td style={{ color: "var(--text-muted)", width: "140px" }}>Health</td>
                  <td>
                    <span
                      className={`badge ${
                        health === "healthy"
                          ? "badge-ok"
                          : health === "degraded"
                            ? "badge-warn"
                            : health === "error"
                              ? "badge-error"
                              : "badge-muted"
                      }`}
                    >
                      {health}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {features.length > 0 && (
            <>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "8px 0 4px" }}>
                Features
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {features.map((f) => (
                  <span key={f} className="badge badge-ok">
                    {f}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
