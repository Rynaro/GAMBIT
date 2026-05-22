// eidolonRoster.test.ts — Vitest unit tests for the project Eidolon loader.
//
// Covers the two pure parsers behind `readProjectEidolons`:
//   - parseMemberNames  — `members:` extraction from eidolons.yaml
//   - parseAgentMd      — agent.md YAML front-matter → ProjectEidolon identity
//
// Fixture: tests/parsers/agent-md.fixture.md — representative front-matter
//   (mirrors .eidolons/atlas/agent.md, incl. the nested `comm:` key).
//
// `readProjectEidolons` itself is filesystem + Tauri-bound; its filesystem
// orchestration is exercised behind a stubbed `readTextFile` so the graceful
// "skip malformed member" behaviour is asserted without touching disk.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

// --- Stub the Tauri fs plugin before importing the module under test. -------
const readTextFileMock = vi.fn<(path: string) => Promise<string>>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (path: string) => readTextFileMock(path),
}));

import {
  CORTEX_EIDOLON_NAME,
  cortexDescriptorPath,
  parseAgentMd,
  parseMemberNames,
  readCortexRosterEntry,
  readProjectEidolons,
  readProjectRoster,
} from "../../src/lib/eidolonRoster";

const FIXTURE_AGENT_MD = readFileSync(join(__dirname, "../parsers/agent-md.fixture.md"), "utf-8");

// ---------------------------------------------------------------------------
// parseMemberNames
// ---------------------------------------------------------------------------

describe("parseMemberNames", () => {
  it("extracts the ordered members list from eidolons.yaml", () => {
    const raw = [
      "version: 1",
      "hosts:",
      "  wire: [claude-code]",
      "members:",
      "  - name: atlas",
      '    version: "^1.5.3"',
      "  - name: spectra",
      '    version: "^4.3.3"',
      "  - name: apivr",
      "",
      "# composition follows",
      "composition:",
      "  - name: should-not-be-counted",
    ].join("\n");
    expect(parseMemberNames(raw)).toEqual(["atlas", "spectra", "apivr"]);
  });

  it("returns an empty array when there is no members block", () => {
    expect(parseMemberNames("version: 1\nhosts:\n  wire: []\n")).toEqual([]);
  });

  it("strips surrounding quotes from member names", () => {
    const raw = "members:\n  - name: \"atlas\"\n  - name: 'spectra'\n";
    expect(parseMemberNames(raw)).toEqual(["atlas", "spectra"]);
  });
});

// ---------------------------------------------------------------------------
// parseAgentMd
// ---------------------------------------------------------------------------

describe("parseAgentMd", () => {
  it("parses identity fields from agent.md front-matter", () => {
    const id = parseAgentMd(FIXTURE_AGENT_MD, "atlas");
    expect(id.name).toBe("atlas");
    expect(id.description).toContain("Read-only codebase scout");
    expect(id.role).toBe("Explorer/Scout — read-only codebase intelligence");
    expect(id.methodology).toBe("ATLAS");
    expect(id.methodologyVersion).toBe("1.0");
  });

  it("parses space-separated allowed-tools into a string[]", () => {
    const id = parseAgentMd(FIXTURE_AGENT_MD, "atlas");
    expect(Array.isArray(id.allowedTools)).toBe(true);
    expect(id.allowedTools).toEqual([
      "view_file",
      "list_dir",
      "search_text",
      "search_symbol",
      "graph_query",
      "test_dry_run",
      "memex_read",
    ]);
    for (const tool of id.allowedTools) {
      expect(typeof tool).toBe("string");
    }
  });

  it("parses a YAML flow-sequence handoffs into a string[]", () => {
    const id = parseAgentMd(FIXTURE_AGENT_MD, "atlas");
    expect(id.handoffs).toEqual(["spectra", "apivr"]);
  });

  it("does not let body content bleed into the parsed identity", () => {
    const id = parseAgentMd(FIXTURE_AGENT_MD, "atlas");
    expect(id.allowedTools).not.toContain("this-line-is-body-not-front-matter");
  });

  it("returns empty identity fields when front-matter is absent", () => {
    const id = parseAgentMd("# Just a heading\n\nNo front-matter.\n", "ghost");
    expect(id.name).toBe("ghost");
    expect(id.description).toBe("");
    expect(id.role).toBe("");
    expect(id.methodology).toBe("");
    expect(id.methodologyVersion).toBe("");
    expect(id.allowedTools).toEqual([]);
    expect(id.handoffs).toEqual([]);
  });

  it("returns empty identity (no throw) on unparseable front-matter", () => {
    const broken = "---\n  : : not : valid : yaml\n\t- bad\n---\nbody\n";
    const id = parseAgentMd(broken, "broken");
    expect(id.name).toBe("broken");
    expect(id.allowedTools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readProjectEidolons — filesystem orchestration with stubbed readTextFile
// ---------------------------------------------------------------------------

describe("readProjectEidolons", () => {
  it("loads every member and skips a malformed agent.md gracefully", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("eidolons.yaml")) {
        return "members:\n  - name: atlas\n  - name: spectra\n  - name: ghost\n";
      }
      if (path.endsWith("/.eidolons/atlas/agent.md")) {
        return FIXTURE_AGENT_MD;
      }
      if (path.endsWith("/.eidolons/spectra/agent.md")) {
        // No front-matter — should yield empty identity, not throw.
        return "# SPECTRA\n\nNo front-matter here.\n";
      }
      // ghost/agent.md is "missing" — reject.
      throw new Error("ENOENT");
    });

    const eidolons = await readProjectEidolons("/proj");

    // All three members are present — none dropped.
    expect(eidolons.map((e) => e.name)).toEqual(["atlas", "spectra", "ghost"]);

    const atlas = eidolons[0];
    expect(atlas.methodology).toBe("ATLAS");
    expect(atlas.allowedTools).toContain("view_file");
    expect(atlas.agentMdPath).toBe("/proj/.eidolons/atlas/agent.md");

    // Member with no front-matter: empty identity but still listed.
    const spectra = eidolons[1];
    expect(spectra.allowedTools).toEqual([]);
    expect(spectra.methodology).toBe("");
    expect(spectra.agentMdPath).toBe("/proj/.eidolons/spectra/agent.md");

    // Member with a missing agent.md: kept with empty identity.
    const ghost = eidolons[2];
    expect(ghost.name).toBe("ghost");
    expect(ghost.allowedTools).toEqual([]);
    expect(ghost.agentMdPath).toBe("/proj/.eidolons/ghost/agent.md");
  });

  it("returns an empty array when eidolons.yaml is unreadable", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async () => {
      throw new Error("ENOENT");
    });
    expect(await readProjectEidolons("/proj")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cortex (default) — the synthetic TRANCE-lite roster entry (story S4)
// ---------------------------------------------------------------------------

describe("readCortexRosterEntry", () => {
  it("builds an available Cortex entry when EIDOLONS.md is present", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/.eidolons/cortex/EIDOLONS.md")) return "# routing descriptor";
      throw new Error("ENOENT");
    });

    const cortex = await readCortexRosterEntry("/proj");
    expect(cortex.name).toBe(CORTEX_EIDOLON_NAME);
    expect(cortex.isCortex).toBe(true);
    expect(cortex.unavailable).toBe(false);
    // `agentMdPath` points at the routing descriptor so the launcher's
    // existing `readTextFile(agentMdPath)` flow needs no extra branch.
    expect(cortex.agentMdPath).toBe("/proj/.eidolons/cortex/EIDOLONS.md");
    expect(cortex.agentMdPath).toBe(cortexDescriptorPath("/proj"));
    // Cortex routing is dynamic — no over-restricted allow-list.
    expect(cortex.allowedTools).toEqual([]);
  });

  it("degrades gracefully (unavailable, no throw) when EIDOLONS.md is absent", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const cortex = await readCortexRosterEntry("/proj");
    expect(cortex.name).toBe(CORTEX_EIDOLON_NAME);
    expect(cortex.isCortex).toBe(true);
    expect(cortex.unavailable).toBe(true);
    expect(cortex.description).toContain("not found");
  });
});

describe("readProjectRoster", () => {
  it("prepends the Cortex (default) entry ahead of the project's Eidolons", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("/.eidolons/cortex/EIDOLONS.md")) return "# routing descriptor";
      if (path.endsWith("eidolons.yaml")) return "members:\n  - name: atlas\n";
      if (path.endsWith("/.eidolons/atlas/agent.md")) return FIXTURE_AGENT_MD;
      throw new Error("ENOENT");
    });

    const roster = await readProjectRoster("/proj");
    // Entry 0 is always the synthetic Cortex default.
    expect(roster[0].name).toBe(CORTEX_EIDOLON_NAME);
    expect(roster[0].isCortex).toBe(true);
    // Named project Eidolons follow as explicit opt-in overrides.
    expect(roster[1].name).toBe("atlas");
    expect(roster[1].isCortex).toBeUndefined();
  });

  it("still yields a (disabled) Cortex entry in a project missing the descriptor", async () => {
    readTextFileMock.mockReset();
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("eidolons.yaml")) return "members:\n  - name: atlas\n";
      if (path.endsWith("/.eidolons/atlas/agent.md")) return FIXTURE_AGENT_MD;
      // cortex/EIDOLONS.md is absent.
      throw new Error("ENOENT");
    });

    const roster = await readProjectRoster("/proj");
    expect(roster[0].name).toBe(CORTEX_EIDOLON_NAME);
    expect(roster[0].unavailable).toBe(true);
    expect(roster[1].name).toBe("atlas");
  });
});
