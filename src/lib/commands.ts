// commands.ts — Static command list and action runner for the ⌘K palette.
// Pure TS (no React) so vitest can import and test it directly.

import { BRAND } from "@/lib/brand";

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
  | "nav:settings"
  // Actions
  | "action:sync"
  | "action:doctor"
  | "action:upgrades"
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
  { id: "nav:roster",      group: "navigate", label: "Roster" },
  { id: "nav:project",     group: "navigate", label: "Project" },
  { id: "nav:mcp-store",   group: "navigate", label: "MCP Store" },
  { id: "nav:harness",     group: "navigate", label: "Harness" },
  { id: "nav:doctor",      group: "navigate", label: "Doctor" },
  { id: "nav:methodology", group: "navigate", label: "Methodology" },
  { id: "nav:settings",    group: "navigate", label: "Settings" },

  // Actions group
  { id: "action:sync",     group: "actions",  label: "Sync project",    description: "Run eidolons sync" },
  { id: "action:doctor",   group: "actions",  label: "Doctor",          description: "Run eidolons doctor" },
  { id: "action:upgrades", group: "actions",  label: "Check upgrades",  description: "Run eidolons upgrade --check" },

  // About group
  { id: "about:gambit",    group: "about",    label: `About ${BRAND.name}`, description: BRAND.tagline },
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
// Action runner
// ---------------------------------------------------------------------------

const FF_LINEAGE =
  "Eidolons answer the call. Junction is where they bind. GAMBIT is where you compose them.";

export function resolveCommand(id: CommandId): void {
  if (id.startsWith("nav:")) {
    const destinationId = id.replace("nav:", "");
    console.info("[palette] navigate →", destinationId);
    return;
  }

  if (id.startsWith("action:")) {
    const actionId = id.replace("action:", "");
    console.info("[palette] action →", actionId);
    return;
  }

  if (id === "about:gambit") {
    console.info(
      "[palette] about →",
      BRAND.tagline,
      "|",
      FF_LINEAGE,
    );
    return;
  }
}
