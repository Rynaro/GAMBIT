// RosterRoute.tsx — Browse the Eidolons team roster from nexus roster/index.yaml.
// Reads from ~/.eidolons/nexus/roster/index.yaml via the Tauri fs plugin.
// Falls back to an informational panel if the file is unavailable.

import { useState, useEffect } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Minimal YAML line parser — extracts `name:` values under `members:` block
// without a full YAML library. Good enough for roster/index.yaml structure.
// ---------------------------------------------------------------------------

interface RosterMember {
  name: string;
  status?: string;
  latestVersion?: string;
  repo?: string;
}

function parseRosterYaml(raw: string): RosterMember[] {
  const members: RosterMember[] = [];
  const lines = raw.split("\n");
  let inMembers = false;
  let current: Partial<RosterMember> | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Detect `members:` top-level key
    if (/^members\s*:/.test(trimmed)) {
      inMembers = true;
      continue;
    }

    // Another top-level key ends the members block
    if (inMembers && /^[a-z_][\w-]*\s*:/.test(trimmed) && !/^\s/.test(line)) {
      inMembers = false;
    }

    if (!inMembers) continue;

    // A new member entry starts with `  <name>:` (2-space indent)
    const memberKey = line.match(/^  ([a-z][\w-]*)\s*:/);
    if (memberKey) {
      if (current?.name) members.push(current as RosterMember);
      current = { name: memberKey[1] };
      continue;
    }

    if (!current) continue;

    // Parse sub-keys within a member
    const statusMatch = line.match(/^\s+status\s*:\s*(.+)/);
    if (statusMatch) { current.status = statusMatch[1].trim().replace(/^['"]|['"]$/g, ""); }

    const repoMatch = line.match(/^\s+repo\s*:\s*(.+)/);
    if (repoMatch) { current.repo = repoMatch[1].trim().replace(/^['"]|['"]$/g, ""); }

    const latestMatch = line.match(/^\s+latest\s*:\s*(.+)/);
    if (latestMatch) {
      current.latestVersion = latestMatch[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  if (current?.name) members.push(current as RosterMember);
  return members;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("roster");

export function RosterRoute() {
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attemptedPath, setAttemptedPath] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // Try ~/.eidolons/nexus/roster/index.yaml via BaseDirectory.Home
      const relPath = ".eidolons/nexus/roster/index.yaml";
      setAttemptedPath(`~/${relPath}`);

      try {
        const raw = await readTextFile(relPath, { baseDir: BaseDirectory.Home });
        if (cancelled) return;
        const parsed = parseRosterYaml(raw);
        setMembers(parsed);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : String(err)
        );
        setMembers(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Fetching roster…</div>
      </div>
    );
  }

  if (error || !members) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Registry unreachable.</p>
            <p className="route-empty-body">
              Couldn't read the local roster. Maybe the kettle is louder than the wifi.
            </p>
            <p className="route-empty-body">
              Run <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>eidolons install</code> first to populate the nexus cache.
            </p>
            <span className="route-empty-note">{attemptedPath}</span>
            {error && (
              <span className="route-empty-note" style={{ marginTop: "4px", color: "var(--status-error)" }}>
                {error}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No members found in roster.</p>
          <p className="route-empty-body">
            The roster file was read but contained no member entries.
          </p>
          <span className="route-empty-note">{attemptedPath}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
      <div className="route-card">
        <p className="route-card-title">Team members</p>
        <table className="route-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Latest</th>
              <th>Repository</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.name}>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {m.name.toUpperCase()}
                </td>
                <td>
                  {m.status ? (
                    <span className={`badge ${m.status === "stable" ? "badge-ok" : m.status === "in_construction" ? "badge-warn" : "badge-muted"}`}>
                      {m.status}
                    </span>
                  ) : (
                    <span className="badge badge-muted">—</span>
                  )}
                </td>
                <td className="mono">{m.latestVersion ?? "—"}</td>
                <td className="mono">
                  {m.repo ? (
                    <span title={m.repo}>{m.repo}</span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
