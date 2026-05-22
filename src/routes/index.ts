// routes/index.ts — Route registry shared by Sidebar, RouteRenderer, and
// the Navigate command group in commands.ts.

import type { RouteId } from "@/lib/useRoute";

export interface RouteEntry {
  id: RouteId;
  label: string;
  /** One-line purpose shown as the route header subtitle. */
  subtitle: string;
}

export const ROUTES: RouteEntry[] = [
  {
    id: "roster",
    label: "Roster",
    subtitle: "Browse the whole Eidolons team and presets.",
  },
  {
    id: "project",
    label: "Project",
    subtitle: "Declared members vs installed reality, with drift surfacing.",
  },
  {
    id: "mcp-store",
    label: "MCP Store",
    subtitle: "Browse, install, and inspect MCP servers.",
  },
  {
    id: "harness",
    label: "Harness",
    subtitle: "Junction install status and harness-bound features.",
  },
  {
    id: "doctor",
    label: "Doctor",
    subtitle: "Health dashboard for your Eidolons project.",
  },
  {
    id: "methodology",
    label: "Methodology",
    subtitle: "Read each Eidolon's agent.md and methodology notes.",
  },
  {
    id: "sessions",
    label: "Sessions",
    subtitle: "Launch a project Eidolon and converse with it across turns.",
  },
  {
    id: "settings",
    label: "Settings",
    subtitle: "Project picker, appearance, and about.",
  },
];

export function getRoute(id: RouteId): RouteEntry {
  const entry = ROUTES.find((r) => r.id === id);
  if (!entry) throw new Error(`Unknown route id: ${id}`);
  return entry;
}
