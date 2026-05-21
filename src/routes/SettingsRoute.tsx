// SettingsRoute.tsx — Project picker, appearance info, About, and CLI Binary status.
// Four sections: Project, Appearance, CLI Binary, About.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsRouteProps {
  projectPath: string | null;
  onPickProject: () => void;
  onClearProject: () => void;
}

interface BinaryStatus {
  resolvedPath: string | null;
  bundledExtracted: boolean;
  bundledPath: string | null;
  pathLookup: string | null;
  nexusFallbackExists: boolean;
  nexusFallbackPath: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("settings");

export function SettingsRoute({
  projectPath,
  onPickProject,
  onClearProject,
}: SettingsRouteProps) {
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus | null>(null);

  useEffect(() => {
    invoke<BinaryStatus>("binary_status")
      .then(setBinaryStatus)
      .catch((e) => console.error("[settings] binary_status failed:", e));
  }, []);

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      {/* Project section */}
      <div className="route-card">
        <p className="settings-section-title">Project</p>

        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-row-label">Current project</span>
            {projectPath ? (
              <span className="settings-row-value" title={projectPath}>
                {projectPath}
              </span>
            ) : (
              <span className="settings-row-muted">None selected</span>
            )}
          </div>

          <div className="settings-row">
            <span className="settings-row-label">Switch project</span>
            <button
              type="button"
              className="route-verb-btn"
              onClick={onPickProject}
            >
              Pick folder…
            </button>
          </div>

          {projectPath && (
            <div className="settings-row">
              <span className="settings-row-label">Clear project</span>
              <button
                type="button"
                className="route-verb-btn"
                onClick={onClearProject}
                style={{ color: "var(--status-error)" }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Appearance section */}
      <div className="route-card">
        <p className="settings-section-title">Appearance</p>

        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-row-label">Theme</span>
            <span className="settings-row-muted">
              Follows system (auto dark / light)
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Sidebar</span>
            <span className="settings-row-muted">
              NSVisualEffectView vibrancy on macOS · solid fallback on Linux/Windows
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Accent</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: "var(--accent-gradient)",
                  flexShrink: 0,
                }}
              />
              <span className="settings-row-muted">#A87CFF → #5EE3D1</span>
            </div>
          </div>
        </div>
      </div>

      {/* CLI Binary section */}
      <div className="route-card">
        <p className="settings-section-title">CLI Binary</p>

        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-row-label">Resolved path</span>
            {binaryStatus?.resolvedPath ? (
              <span className="settings-row-value" title={binaryStatus.resolvedPath}>
                {binaryStatus.resolvedPath}
              </span>
            ) : (
              <span className="settings-row-muted" style={{ color: "var(--status-error)" }}>
                Not found
              </span>
            )}
          </div>

          <div className="settings-row">
            <span className="settings-row-label">Bundled (extracted)</span>
            <span
              className="settings-row-muted"
              style={{
                color: binaryStatus?.bundledExtracted
                  ? "var(--status-ok)"
                  : "var(--text-muted)",
              }}
            >
              {binaryStatus === null
                ? "Checking…"
                : binaryStatus.bundledExtracted
                ? binaryStatus.bundledPath ?? "present"
                : "Not extracted"}
            </span>
          </div>

          <div className="settings-row">
            <span className="settings-row-label">PATH lookup</span>
            <span
              className="settings-row-muted"
              style={{
                color: binaryStatus?.pathLookup
                  ? "var(--status-ok)"
                  : "var(--text-muted)",
              }}
            >
              {binaryStatus === null
                ? "Checking…"
                : binaryStatus.pathLookup ?? "Not found"}
            </span>
          </div>

          <div className="settings-row">
            <span className="settings-row-label">Nexus fallback</span>
            <span
              className="settings-row-muted"
              style={{
                color: binaryStatus?.nexusFallbackExists
                  ? "var(--status-ok)"
                  : "var(--text-muted)",
              }}
            >
              {binaryStatus === null
                ? "Checking…"
                : binaryStatus.nexusFallbackExists
                ? binaryStatus.nexusFallbackPath ?? "present"
                : "Not installed"}
            </span>
          </div>
        </div>
      </div>

      {/* About section */}
      <div className="route-card">
        <p className="settings-section-title">About</p>

        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-row-label">Application</span>
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {BRAND.name}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Tagline</span>
            <span className="settings-row-muted">{BRAND.tagline}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">FF lineage</span>
            <span className="settings-row-muted">{BRAND.ffOrigin}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Ecosystem</span>
            <span className="settings-row-muted">
              Eidolons answer the call. Junction is where they bind. {BRAND.name} is where you compose them.
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Repository</span>
            <a
              href={BRAND.github.url}
              target="_blank"
              rel="noreferrer"
              className="settings-row-value"
              style={{ color: "var(--accent-primary)", textDecoration: "none" }}
            >
              {BRAND.github.url}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
