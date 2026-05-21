import { BRAND } from "@/lib/brand";
import { basename } from "@/lib/pathUtils";

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
  projectPath: string | null;
  onPickProject: () => void;
}

export function Sidebar({ projectPath, onPickProject }: SidebarProps) {
  const projectBasename = projectPath ? basename(projectPath) : null;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="sidebar-name">{BRAND.name}</span>
        <span className="sidebar-tagline">{BRAND.tagline}</span>
      </header>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <ul className="sidebar-destinations">
          {DESTINATIONS.map((dest) => (
            <>
              {dest.id === "settings" && (
                <li key="divider" aria-hidden="true" className="sidebar-divider" />
              )}
              <li key={dest.id}>
                <button
                  type="button"
                  className="sidebar-destination"
                  data-destination={dest.id}
                  aria-label={dest.label}
                >
                  {dest.label}
                </button>
              </li>
            </>
          ))}
        </ul>
      </nav>

      {/* Project picker footer */}
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
      </footer>
    </aside>
  );
}
