// McpStoreRoute.tsx — MCP Store route with Install / Uninstall / Upgrade actions.
//
// Primary data source: `eidolons mcp list --json` (via mcp_list Rust command).
// Replaces the older eidolons.mcp.lock-only read for this route.
// parseMcpLock is preserved in src/lib/parseMcpLock.ts for HarnessRoute.
//
// Fixture: gambit/.junction/threads/e9cadae1-ca03-4229-aba2-71096babf139/input/mcp-list.fixture.json
//
// Table columns: Name · Kind · Scope · Installed · Latest · Status badge · Actions
// Status badge by `update` field:
//   "no"        → green "up-to-date" pill
//   "install"   → amber "install" pill
//   "upgrade"   → amber "upgrade" pill
//   "downgrade" → warn-grey "downgrade" pill
//
// Actions column:
//   installed === ""                   → Install button
//   installed !== "" && update === "no" → Uninstall button
//   installed !== "" && update !== "no" → Upgrade + Uninstall buttons
//     (Upgrade calls install() — the CLI install command is idempotent/upgrades)

import { RouteHeader } from "@/components/RouteHeader";
import { McpInstallPane } from "@/components/McpInstallPane";
import type { UseMcpStoreResult } from "@/lib/useMcpStore";
import { getRoute } from "@/routes/index";
import type { McpListEntry } from "@/lib/mcp.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UpdateBadgeProps {
  update: string;
}

function UpdateBadge({ update }: UpdateBadgeProps) {
  if (update === "no") {
    return (
      <span className="badge badge-ok" style={{ fontSize: "10px" }}>
        up-to-date
      </span>
    );
  }
  if (update === "install") {
    return (
      <span
        className="badge"
        style={{
          fontSize: "10px",
          background: "color-mix(in srgb, var(--status-warn) 18%, transparent 82%)",
          color: "var(--status-warn)",
        }}
      >
        install
      </span>
    );
  }
  if (update === "upgrade") {
    return (
      <span
        className="badge"
        style={{
          fontSize: "10px",
          background: "color-mix(in srgb, var(--status-warn) 18%, transparent 82%)",
          color: "var(--status-warn)",
        }}
      >
        upgrade
      </span>
    );
  }
  if (update === "downgrade") {
    return (
      <span className="badge badge-muted" style={{ fontSize: "10px" }}>
        downgrade
      </span>
    );
  }
  // Unknown future enum value — render permissively.
  return (
    <span className="badge badge-muted" style={{ fontSize: "10px" }}>
      {update}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

interface ActionCellProps {
  entry: McpListEntry;
  activeMcp: string | null;
  isOperating: boolean;
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
}

function ActionCell({
  entry,
  activeMcp,
  isOperating,
  onInstall,
  onUninstall,
}: ActionCellProps) {
  const thisIsActive = activeMcp === entry.name && isOperating;
  const disabled = isOperating;

  const btnStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 500,
    padding: "2px 10px",
    borderRadius: "var(--radius-control)",
    border: "1px solid var(--border-subtle)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled && !thisIsActive ? 0.45 : 1,
    background: "none",
    color: "var(--text-secondary)",
    marginRight: "6px",
  };

  const installBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: "var(--accent)",
    color: "var(--text-on-accent, #fff)",
    borderColor: "var(--accent)",
  };

  if (entry.installed === "") {
    // Not installed — show Install button.
    return (
      <button
        type="button"
        style={installBtnStyle}
        disabled={disabled}
        onClick={() => onInstall(entry.name)}
        aria-label={`Install ${entry.name}`}
      >
        Install
      </button>
    );
  }

  if (entry.update === "no") {
    // Installed and up-to-date — show Uninstall only.
    return (
      <button
        type="button"
        style={{
          ...btnStyle,
          borderColor: "var(--status-error)",
          color: "var(--status-error)",
        }}
        disabled={disabled}
        onClick={() => onUninstall(entry.name)}
        aria-label={`Uninstall ${entry.name}`}
      >
        Uninstall
      </button>
    );
  }

  // Installed but update available — Upgrade + Uninstall.
  return (
    <>
      <button
        type="button"
        style={installBtnStyle}
        disabled={disabled}
        onClick={() => onInstall(entry.name)}
        aria-label={`Upgrade ${entry.name}`}
      >
        Upgrade
      </button>
      <button
        type="button"
        style={{
          ...btnStyle,
          borderColor: "var(--status-error)",
          color: "var(--status-error)",
        }}
        disabled={disabled}
        onClick={() => onUninstall(entry.name)}
        aria-label={`Uninstall ${entry.name}`}
      >
        Uninstall
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface McpStoreRouteProps {
  projectPath: string | null;
  mcpStore: UseMcpStoreResult;
}

const ROUTE = getRoute("mcp-store");

const PANE_STATES = new Set([
  "installing",
  "uninstalling",
  "done",
  "failed",
  "cancelled",
]);

export function McpStoreRoute({ projectPath, mcpStore }: McpStoreRouteProps) {
  const mcp = mcpStore;
  const { state, entries, error, refresh, install, uninstall, activeMcp } = mcp;

  const isOperating =
    state === "installing" || state === "uninstalling";
  const showPane = PANE_STATES.has(state);

  // ---- No project picked ----
  if (!projectPath) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project selected.</p>
          <p className="route-empty-body">
            Pick a project to see its MCP server catalogue.
          </p>
        </div>
      </div>
    );
  }

  // ---- Loading ----
  if (state === "loading" || state === "idle") {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Loading MCP catalogue…</div>
      </div>
    );
  }

  // ---- Failed (list fetch error) ----
  if (state === "failed" && entries.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">Could not load MCP catalogue.</p>
            <p className="route-empty-body" style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              {error ?? "Unknown error"}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              style={{
                marginTop: "12px",
                fontSize: "11px",
                padding: "4px 12px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-control)",
                background: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Empty catalogue ----
  if (
    (state === "ready" || state === "done") &&
    entries.length === 0
  ) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No MCPs in the catalogue.</p>
          <p className="route-empty-body">
            The project's MCP roster is empty. Run{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              eidolons mcp list
            </code>{" "}
            to verify.
          </p>
        </div>
      </div>
    );
  }

  // ---- Main table view ----
  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      <div className="route-card">
        {/* Card header row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "12px",
          }}
        >
          <p className="route-card-title" style={{ margin: 0 }}>
            MCP Catalogue — {entries.length} server{entries.length !== 1 ? "s" : ""}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isOperating || state === "loading"}
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-control)",
              background: "none",
              color: "var(--text-secondary)",
              cursor: isOperating ? "not-allowed" : "pointer",
              opacity: isOperating ? 0.5 : 1,
            }}
            aria-label="Refresh MCP catalogue"
          >
            Refresh
          </button>
        </div>

        {/* Catalogue table */}
        <table className="route-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Kind</th>
              <th style={{ textAlign: "left" }}>Scope</th>
              <th style={{ textAlign: "left" }}>Installed</th>
              <th style={{ textAlign: "left" }}>Latest</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.name}
                style={{
                  opacity:
                    isOperating && activeMcp !== entry.name ? 0.55 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {entry.name}
                </td>
                <td>
                  <span className="badge badge-muted" style={{ fontSize: "10px" }}>
                    {entry.kind}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {entry.scope}
                </td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {entry.installed === "" ? (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
                  ) : (
                    entry.installed
                  )}
                </td>
                <td className="mono" style={{ fontSize: "11px" }}>
                  {entry.latest}
                </td>
                <td>
                  <UpdateBadge update={entry.update} />
                </td>
                <td>
                  <ActionCell
                    entry={entry}
                    activeMcp={activeMcp}
                    isOperating={isOperating}
                    onInstall={(name) => void install(name)}
                    onUninstall={(name) => void uninstall(name)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* McpInstallPane — bottom-anchored when an op is in flight or just completed */}
      {showPane && (
        <McpInstallPane projectPath={projectPath} mcp={mcp} />
      )}
    </div>
  );
}
