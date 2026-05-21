// McpStoreRoute.tsx — Reads eidolons.mcp.lock from the selected project;
// renders installed MCP servers. Placeholder if absent.

import { useState, useEffect } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parse as parseYaml } from "yaml";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpServerEntry {
  kind?: string;
  image?: string;
  version?: string;
  enabled?: boolean;
  installed_at?: string;
}

interface McpLock {
  servers?: Record<string, McpServerEntry>;
  schema_version?: string;
}

interface McpStoreRouteProps {
  projectPath: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
        setLock(parseYaml(raw) as McpLock);
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
            <p className="route-empty-heading">No MCP servers installed yet.</p>
            <p className="route-empty-body">
              Run{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                eidolons mcp install &lt;server&gt;
              </code>{" "}
              to add an MCP server. The store lists all available servers in the nexus <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>roster/mcps.yaml</code>.
            </p>
            <span className="route-empty-note">
              {projectPath}/eidolons.mcp.lock
            </span>
          </div>
        </div>
      </div>
    );
  }

  const servers = lock.servers ?? {};
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No MCP servers installed yet.</p>
          <p className="route-empty-body">
            Your <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>eidolons.mcp.lock</code> exists but has no entries.
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
          Installed servers — {serverNames.length}
          {lock.schema_version && (
            <span
              className="badge badge-muted"
              style={{ marginLeft: "8px", verticalAlign: "middle" }}
            >
              v{lock.schema_version}
            </span>
          )}
        </p>
        <table className="route-table">
          <thead>
            <tr>
              <th>Server</th>
              <th>Kind</th>
              <th>Version</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {serverNames.map((name) => {
              const entry = servers[name];
              return (
                <tr key={name}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {name}
                  </td>
                  <td className="mono">{entry.kind ?? "—"}</td>
                  <td className="mono">{entry.version ?? "—"}</td>
                  <td>
                    {entry.enabled === false ? (
                      <span className="badge badge-warn">disabled</span>
                    ) : (
                      <span className="badge badge-ok">enabled</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
