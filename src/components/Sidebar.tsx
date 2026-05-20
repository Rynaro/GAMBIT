import { BRAND } from "@/lib/brand";

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

export function Sidebar() {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="sidebar-name">{BRAND.name}</span>
        <span className="sidebar-tagline">{BRAND.tagline}</span>
      </header>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <ul className="sidebar-destinations">
          {DESTINATIONS.map((dest, i) => (
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
    </aside>
  );
}
