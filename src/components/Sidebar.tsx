import { Fragment } from "react";
import { BRAND } from "@/lib/brand";
import { isMacOS } from "@/lib/platform";
import { basename } from "@/lib/pathUtils";
import type { CommandPaletteState } from "@/lib/useCommandPalette";

const DESTINATIONS = [
  { id: "roster", label: "Roster" },
  { id: "project", label: "Project" },
  { id: "mcp-store", label: "MCP Store" },
  { id: "harness", label: "Harness" },
  { id: "doctor", label: "Doctor" },
  { id: "methodology", label: "Methodology" },
  // system group — divider before this in v0.1
  { id: "settings", label: "Settings" },
] as const;

interface SidebarProps {
  palette: CommandPaletteState;
  projectPath: string | null;
  onPickProject: () => void;
}

export function Sidebar({ palette, projectPath, onPickProject }: SidebarProps) {
  const hotkey = isMacOS() ? "⌘K" : "Ctrl K";
  const projectBasename = projectPath ? basename(projectPath) : null;

  return (
    // background is transparent — NSVisualEffectView .sidebar vibrancy shows
    // through on macOS. On Linux/Windows the CSS fallback
    // :root[data-platform="linux"] .sidebar fills in var(--bg-canvas).
    <aside className="sidebar">
      <header className="sidebar-header">
        {/* Text stays crisp against vibrancy — no background on the header */}
        <span className="sidebar-name">{BRAND.name}</span>
        <span className="sidebar-tagline">{BRAND.tagline}</span>
      </header>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <ul className="sidebar-destinations">
          {DESTINATIONS.map((dest) => (
            <Fragment key={dest.id}>
              {dest.id === "settings" && (
                <li aria-hidden="true" className="sidebar-divider" />
              )}
              <li>
                <button
                  type="button"
                  className="sidebar-destination"
                  data-destination={dest.id}
                  aria-label={dest.label}
                >
                  {dest.label}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      </nav>

      <footer className="sidebar-footer">
        {projectBasename ? (
          <div className="sidebar-project-row">
            <span className="sidebar-project-name" title={projectPath ?? ""}>
              {projectBasename}
            </span>
            <button
              type="button"
              className="sidebar-project-switch"
              onClick={onPickProject}
              aria-label="Switch project"
            >
              Switch
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="sidebar-pick-project"
            onClick={onPickProject}
          >
            Pick project…
          </button>
        )}

        <button
          type="button"
          className="sidebar-palette-pill"
          onClick={() => palette.setOpen(true)}
          aria-label="Open command palette"
        >
          <span className="sidebar-palette-key">{hotkey}</span>
          <span className="sidebar-palette-label">Open palette</span>
        </button>
      </footer>
    </aside>
  );
}
