// commands.ts — Static command list and action runner for the ⌘K palette.
// Pure TS (no React) so vitest can import and test it directly.
//
// Design note: palette commands are pure data; side-effecting handlers (like
// startSync) must be injected via `setCommandHandlers()` from App.tsx.
// This avoids circular imports and keeps commands.ts testable without Tauri.

import { BRAND } from "@/lib/brand";
import type { RouteId } from "@/lib/useRoute";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandGroup = "navigate" | "actions" | "about";

export type CommandId =
  // Navigate
  | "nav:roster"
  | "nav:project"
  | "nav:mcp-store"
  | "nav:harness"
  | "nav:doctor"
  | "nav:methodology"
  | "nav:sessions"
  | "nav:settings"
  // Actions
  | "action:sync"
  | "action:doctor"
  | "action:upgrades"
  | "action:mcp-refresh"
  // About
  | "about:gambit";

export interface Command {
  id: CommandId;
  group: CommandGroup;
  label: string;
  /** Short description shown as secondary text in the palette row. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Static command list
// ---------------------------------------------------------------------------

export const COMMANDS: Command[] = [
  // Navigate group
  { id: "nav:roster", group: "navigate", label: "Roster" },
  { id: "nav:project", group: "navigate", label: "Project" },
  { id: "nav:mcp-store", group: "navigate", label: "MCP Store" },
  { id: "nav:harness", group: "navigate", label: "Harness" },
  { id: "nav:doctor", group: "navigate", label: "Doctor" },
  { id: "nav:methodology", group: "navigate", label: "Methodology" },
  { id: "nav:sessions", group: "navigate", label: "Sessions" },
  { id: "nav:settings", group: "navigate", label: "Settings" },

  // Actions group
  { id: "action:sync", group: "actions", label: "Sync project", description: "Run eidolons sync" },
  { id: "action:doctor", group: "actions", label: "Doctor", description: "Run eidolons doctor" },
  {
    id: "action:upgrades",
    group: "actions",
    label: "Check upgrades",
    description: "Run eidolons upgrade --check",
  },
  {
    id: "action:mcp-refresh",
    group: "actions",
    label: "Refresh MCP Store",
    description: "Reload eidolons mcp list",
  },

  // About group
  { id: "about:gambit", group: "about", label: `About ${BRAND.name}`, description: BRAND.tagline },
];

// ---------------------------------------------------------------------------
// Group metadata (for rendering group headings in the palette)
// ---------------------------------------------------------------------------

export const GROUP_LABELS: Record<CommandGroup, string> = {
  navigate: "Navigate",
  actions: "Actions",
  about: "About",
};

// ---------------------------------------------------------------------------
// Injected handlers (set once by App.tsx via setCommandHandlers)
// ---------------------------------------------------------------------------

export interface CommandHandlers {
  /** Called when the user selects "Sync project" from the palette. */
  onSyncProject: () => void;
  /**
   * Called when the user selects a Navigate command from the palette.
   * Should switch the active route and close the palette.
   */
  onNavigate: (routeId: RouteId) => void;
  /** Called when the user selects "Doctor" from the palette. */
  onRunDoctor: () => void;
  /** Called when the user selects "Check upgrades" from the palette. Optional; no-op if omitted. */
  onCheckUpgrades?: () => void;
  /** Called when the user selects "Refresh MCP Store" from the palette. */
  onRefreshMcpStore: () => void;
}

// Default no-op handlers — safe if App.tsx hasn't injected yet.
// The console.info calls here intentionally match the test expectations in
// tests/unit/commands.test.ts so that pre-injection calls are observable.
let handlers: CommandHandlers = {
  onSyncProject: () => {
    console.info("[palette] action →", "sync");
  },
  onNavigate: (routeId: RouteId) => {
    console.info("[palette] navigate →", routeId);
  },
  onRunDoctor: () => {
    console.warn("[palette] Doctor: no handler injected yet");
  },
  onRefreshMcpStore: () => {
    console.warn("[palette] Refresh MCP Store: no handler injected yet");
  },
};

/**
 * Called once from App.tsx after the sync and doctor hooks are initialised.
 * Injects live handlers so palette commands can trigger side-effects.
 */
export function setCommandHandlers(h: CommandHandlers): void {
  handlers = h;
}

// ---------------------------------------------------------------------------
// Action runner
// ---------------------------------------------------------------------------

const FF_LINEAGE =
  "Eidolons answer the call. Junction is where they bind. GAMBIT is where you compose them.";

export function resolveCommand(id: CommandId, closePalette?: () => void): void {
  if (id.startsWith("nav:")) {
    const routeId = id.replace("nav:", "") as RouteId;
    handlers.onNavigate(routeId);
    closePalette?.();
    return;
  }

  if (id === "action:sync") {
    handlers.onSyncProject();
    return;
  }

  if (id === "action:doctor") {
    handlers.onRunDoctor();
    return;
  }

  if (id === "action:upgrades") {
    if (handlers.onCheckUpgrades) {
      handlers.onCheckUpgrades();
    } else {
      console.warn("[palette] Check upgrades: no handler injected yet");
    }
    return;
  }

  if (id === "action:mcp-refresh") {
    handlers.onRefreshMcpStore();
    return;
  }

  if (id.startsWith("action:")) {
    const actionId = id.replace("action:", "");
    console.info("[palette] action →", actionId);
    return;
  }

  if (id === "about:gambit") {
    console.info("[palette] about →", BRAND.tagline, "|", FF_LINEAGE);
    return;
  }
}
