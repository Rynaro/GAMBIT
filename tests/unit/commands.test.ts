import { describe, expect, it, vi } from "vitest";
import { COMMANDS, GROUP_LABELS, resolveCommand } from "../../src/lib/commands";
import type { CommandGroup } from "../../src/lib/commands";

// ---------------------------------------------------------------------------
// (i) Command list shape
// ---------------------------------------------------------------------------

describe("COMMANDS static list", () => {
  it("is non-empty", () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  it("contains all three groups", () => {
    const groups = new Set(COMMANDS.map((c) => c.group));
    expect(groups.has("navigate")).toBe(true);
    expect(groups.has("actions")).toBe(true);
    expect(groups.has("about")).toBe(true);
  });

  it("has all 7 navigate destinations", () => {
    const navItems = COMMANDS.filter((c) => c.group === "navigate");
    const labels = navItems.map((c) => c.label);
    expect(labels).toContain("Roster");
    expect(labels).toContain("Project");
    expect(labels).toContain("MCP Store");
    expect(labels).toContain("Harness");
    expect(labels).toContain("Doctor");
    expect(labels).toContain("Methodology");
    expect(labels).toContain("Settings");
  });

  it("has all 3 action stubs", () => {
    const actionItems = COMMANDS.filter((c) => c.group === "actions");
    const labels = actionItems.map((c) => c.label);
    expect(labels).toContain("Sync project");
    expect(labels).toContain("Doctor");
    expect(labels).toContain("Check upgrades");
  });

  it("has an About GAMBIT command", () => {
    const aboutItems = COMMANDS.filter((c) => c.group === "about");
    expect(aboutItems.length).toBeGreaterThan(0);
    expect(aboutItems[0].id).toBe("about:gambit");
  });

  it("every command has a non-empty id and label", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id.length).toBeGreaterThan(0);
      expect(cmd.label.length).toBeGreaterThan(0);
    }
  });

  it("every id follows the <group-prefix>:<slug> pattern", () => {
    const prefixMap: Record<CommandGroup, string> = {
      navigate: "nav:",
      actions: "action:",
      about: "about:",
    };
    for (const cmd of COMMANDS) {
      const expected = prefixMap[cmd.group];
      expect(cmd.id).toMatch(new RegExp(`^${expected}`));
    }
  });
});

// ---------------------------------------------------------------------------
// (ii) GROUP_LABELS
// ---------------------------------------------------------------------------

describe("GROUP_LABELS", () => {
  it("has a label for every group", () => {
    const groups: CommandGroup[] = ["navigate", "actions", "about"];
    for (const g of groups) {
      expect(GROUP_LABELS[g]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// (iii) 3-letter prefix fuzzy sanity — label containment checks
// ---------------------------------------------------------------------------

describe("3-letter prefix label matching (containment)", () => {
  function topMatchForPrefix(prefix: string): string | undefined {
    const lower = prefix.toLowerCase();
    // First: exact prefix match on the label
    const exact = COMMANDS.find((c) => c.label.toLowerCase().startsWith(lower));
    if (exact) return exact.label;
    // Fallback: contains
    return COMMANDS.find((c) => c.label.toLowerCase().includes(lower))?.label;
  }

  it('"ros" prefix returns Roster as top result', () => {
    expect(topMatchForPrefix("ros")).toBe("Roster");
  });

  it('"doc" prefix returns Doctor as top result', () => {
    expect(topMatchForPrefix("doc")).toBe("Doctor");
  });

  it('"met" prefix returns Methodology as top result', () => {
    expect(topMatchForPrefix("met")).toBe("Methodology");
  });

  it('"syn" matches Sync project', () => {
    const labels = COMMANDS.map((c) => c.label.toLowerCase());
    const syncIdx = labels.findIndex((l) => l.includes("syn"));
    const rosterIdx = labels.findIndex((l) => l.includes("roster"));
    // "syn" appears in "Sync project" but not in "Roster"
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(rosterIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).not.toBe(rosterIdx);
    // "syn" does not appear in "Roster"
    expect("roster".includes("syn")).toBe(false);
    expect("sync project".includes("syn")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (iv) resolveCommand action runner
// ---------------------------------------------------------------------------

describe("resolveCommand", () => {
  it("logs navigate actions via console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    resolveCommand("nav:roster");
    expect(spy).toHaveBeenCalledWith("[palette] navigate →", "roster");
    spy.mockRestore();
  });

  it("logs stub actions via console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    resolveCommand("action:sync");
    expect(spy).toHaveBeenCalledWith("[palette] action →", "sync");
    spy.mockRestore();
  });

  it("logs about info via console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    resolveCommand("about:gambit");
    expect(spy).toHaveBeenCalled();
    const args = spy.mock.calls[0];
    expect(args[0]).toBe("[palette] about →");
    spy.mockRestore();
  });

  it("handles all nav destinations without throwing", () => {
    const navIds = COMMANDS.filter((c) => c.group === "navigate").map((c) => c.id);
    for (const id of navIds) {
      expect(() => resolveCommand(id)).not.toThrow();
    }
  });
});
