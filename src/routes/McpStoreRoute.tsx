// McpStoreRoute.tsx — Reads eidolons.mcp.lock from the selected project;
// renders installed MCP servers. Placeholder if absent.
//
// Real lock shape captured from live fixture:
//   tests/parsers/eidolons-mcp-lock.fixture.yaml
//
// Top-level key is `mcps` (array of {name, kind, version, source, target,
// hosts_wired, installed_at, integrity}). NOT `servers: Record<string,_>`.

import { useState, useEffect } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";
import { parseMcpLock, type McpLock } from "@/lib/parseMcpLock";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface McpStoreRouteProps {
  projectPath: string | null;
}

const ROUTE = getRoute("mcp-store");

export function McpStoreRoute({ projectPath }: McpStoreRouteProps) {
  const [lock, setLock] = useState<McpLock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setLock(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    readTextFile(`${projectPath}/eidolons.mcp.lock`)
      .then((raw) => {
        if (cancelled) return;
        setLock(parseMcpLock(raw));
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLock(null);
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
            Pick a project to see its MCP server configuration.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Reading MCP lock…</div>
      </div>
    );
  }

  // Lock missing or unreadable — show informational panel
  if (error || !lock) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">No MCP servers installed in this project.</p>
            <p className="route-empty-body">
              Run{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                eidolons mcp install &lt;server&gt;
              </code>{" "}
              to add an MCP server. The store lists all available servers in the nexus{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>roster/mcps.yaml</code>.
            </p>
            <span className="route-empty-note">
              {projectPath}/eidolons.mcp.lock
            </span>
          </div>
        </div>
      </div>
    );
  }

  const mcps = lock.mcps ?? [];

  if (mcps.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No MCP servers installed in this project.</p>
          <p className="route-empty-body">
            Your{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>eidolons.mcp.lock</code>{" "}
            exists but has no entries.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
      <div className="route-card">
        <p className="route-card-title">
          Installed servers — {mcps.length}
          {lock.catalogue_version && (
            <span
              className="badge badge-muted"
              style={{ marginLeft: "8px", verticalAlign: "middle" }}
            >
              catalogue v{lock.catalogue_version}
            </span>
          )}
        </p>
        {mcps.map((mcp) => (
          <div
            key={mcp.name}
            style={{
              borderBottom: "1px solid var(--border)",
              padding: "12px 0",
            }}
          >
            {/* Primary heading row */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "13px" }}>
                {mcp.name}
              </span>
              {mcp.kind && (
                <span className="badge badge-ok">{mcp.kind}</span>
              )}
              {mcp.version && (
                <span className="badge badge-muted mono">v{mcp.version}</span>
              )}
            </div>

            {/* Detail rows */}
            <table className="route-table" style={{ marginBottom: 0 }}>
              <tbody>
                {mcp.source?.repo && (
                  <tr>
                    <td style={{ color: "var(--text-muted)", width: "110px" }}>Source</td>
                    <td className="mono" style={{ fontSize: "11px" }}>{mcp.source.repo}</td>
                  </tr>
                )}
                {mcp.target && (
                  <tr>
                    <td style={{ color: "var(--text-muted)" }}>Target</td>
                    <td className="mono" style={{ fontSize: "11px" }}>{mcp.target}</td>
                  </tr>
                )}
                {mcp.installed_at && (
                  <tr>
                    <td style={{ color: "var(--text-muted)" }}>Installed</td>
                    <td className="mono" style={{ fontSize: "11px" }}>{mcp.installed_at}</td>
                  </tr>
                )}
                {mcp.hosts_wired && mcp.hosts_wired.length > 0 && (
                  <tr>
                    <td style={{ color: "var(--text-muted)" }}>Wired into</td>
                    <td style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {mcp.hosts_wired.join(", ")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
