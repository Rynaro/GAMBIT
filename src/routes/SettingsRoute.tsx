// SettingsRoute.tsx — Project picker, appearance info, and About.
// Three sections: Project, Appearance, About.
// Pure state — no file reads needed.

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("settings");

export function SettingsRoute({
  projectPath,
  onPickProject,
  onClearProject,
}: SettingsRouteProps) {
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
