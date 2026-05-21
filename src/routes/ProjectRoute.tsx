// ProjectRoute.tsx — Declared members vs installed reality.
// Reads eidolons.yaml + eidolons.lock from the selected project.
// If no project is selected, shows a CTA to pick one.
//
// NOTE: This route adds `yaml@^2` to parse eidolons.yaml/lock properly.
// See package.json — yaml is listed in dependencies.

import { useState, useEffect } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parse as parseYaml } from "yaml";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EidolonsYaml {
  members?: string[];
  version?: string;
}

interface LockEntry {
  version?: string;
  archive_sha256?: string;
  manifest_sha256?: string;
  verification?: string;
  installed_at?: string;
}

interface EidolonsLock {
  members?: Record<string, LockEntry>;
}

interface ProjectRouteProps {
  projectPath: string | null;
  onPickProject: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("project");

export function ProjectRoute({ projectPath, onPickProject }: ProjectRouteProps) {
  const [yamlData, setYamlData] = useState<EidolonsYaml | null>(null);
  const [lockData, setLockData] = useState<EidolonsLock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setYamlData(null);
      setLockData(null);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [rawYaml, rawLock] = await Promise.allSettled([
          readTextFile(`${projectPath}/eidolons.yaml`),
          readTextFile(`${projectPath}/eidolons.lock`),
        ]);

        if (cancelled) return;

        const parsedYaml =
          rawYaml.status === "fulfilled"
            ? (parseYaml(rawYaml.value) as EidolonsYaml)
            : null;

        const parsedLock =
          rawLock.status === "fulfilled"
            ? (parseYaml(rawLock.value) as EidolonsLock)
            : null;

        setYamlData(parsedYaml);
        setLockData(parsedLock);

        if (rawYaml.status === "rejected") {
          setError(`eidolons.yaml not found: ${rawYaml.reason}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [projectPath]);

  // No project selected
  if (!projectPath) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project picked yet.</p>
          <p className="route-empty-body">
            Pick a folder that contains an <code style={{ fontFamily: "var(--font-mono)" }}>eidolons.yaml</code> to see declared members, installed reality, and drift signals.
          </p>
          <button
            type="button"
            className="route-verb-btn primary"
            onClick={onPickProject}
          >
            Pick a folder
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Reading project files…</div>
      </div>
    );
  }

  if (error && !yamlData) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Couldn't read this project.</p>
            <p className="route-empty-body">
              No <code style={{ fontFamily: "var(--font-mono)" }}>eidolons.yaml</code> found at the selected path.
            </p>
            <span className="route-empty-note">{projectPath}</span>
            <button
              type="button"
              className="route-verb-btn"
              onClick={onPickProject}
              style={{ marginTop: "8px" }}
            >
              Switch project
            </button>
          </div>
        </div>
      </div>
    );
  }

  const declaredMembers: string[] = yamlData?.members ?? [];
  const lockMembers = lockData?.members ?? {};
  const allMembers = Array.from(
    new Set([...declaredMembers, ...Object.keys(lockMembers)])
  );

  return (
    <div className="route-pane">
      <RouteHeader
        title={ROUTE.label}
        subtitle={ROUTE.subtitle}
        actions={
          <button
            type="button"
            className="route-verb-btn"
            onClick={onPickProject}
          >
            Switch project
          </button>
        }
      />

      {/* Path row */}
      <div className="route-card">
        <p className="route-card-title">Project path</p>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          {projectPath}
        </span>
      </div>

      {/* Members table */}
      <div className="route-card">
        <p className="route-card-title">
          Members — {declaredMembers.length} declared
          {Object.keys(lockMembers).length > 0 && `, ${Object.keys(lockMembers).length} in lock`}
        </p>

        {allMembers.length === 0 ? (
          <div className="route-empty" style={{ padding: "var(--space-7) 0" }}>
            <p className="route-empty-body">
              No members declared yet. Add some with{" "}
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>eidolons add &lt;name&gt;</code>.
            </p>
          </div>
        ) : (
          <table className="route-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Declared</th>
                <th>Lock version</th>
                <th>Integrity</th>
              </tr>
            </thead>
            <tbody>
              {allMembers.map((name) => {
                const inYaml = declaredMembers.includes(name);
                const lockEntry = lockMembers[name];
                const verification = lockEntry?.verification;
                return (
                  <tr key={name}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {name}
                    </td>
                    <td>
                      {inYaml ? (
                        <span className="badge badge-ok">yes</span>
                      ) : (
                        <span className="badge badge-warn">lock-only</span>
                      )}
                    </td>
                    <td className="mono">
                      {lockEntry?.version ?? "—"}
                    </td>
                    <td>
                      {verification === "verified" ? (
                        <span className="badge badge-ok">verified</span>
                      ) : verification === "legacy-warning" ? (
                        <span className="badge badge-warn">legacy</span>
                      ) : verification === "missing" ? (
                        <span className="badge badge-error">missing</span>
                      ) : (
                        <span className="badge badge-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
