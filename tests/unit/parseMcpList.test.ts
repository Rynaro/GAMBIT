// parseMcpList.test.ts — Vitest unit tests pinning the McpListEntry JSON shape.
//
// Fixture: tests/parsers/eidolons-mcp-list.fixture.json — verbatim capture
//   of a live `eidolons mcp list --json` run.
//
// The "parser" is JSON.parse; the test pins the shape and field invariants.
//
// Cases:
//   1. Parsed array has length 2.
//   2. entries[0].name === "atlas-aci" and entries[0].installed === "" (empty string).
//   3. entries[1].name === "junction" and entries[1].installed === "".
//   4. entries[1].update === "install" (fixture has both as "install").
//   5. installed is a string, not null, on all entries.
//   6. All entries have name, scope, kind, installed, latest, update fields.
//   7. Idempotency: JSON.parse(JSON.stringify(entries)) deep-equals entries.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { McpListEntry } from "../../src/lib/mcp.types";

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(__dirname, "../parsers/eidolons-mcp-list.fixture.json");

function loadFixture(): McpListEntry[] {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as McpListEntry[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpListEntry fixture shape", () => {
  it("is an array with length 2", () => {
    const entries = loadFixture();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(2);
  });

  it("entries[0].name === 'atlas-aci'", () => {
    const entries = loadFixture();
    expect(entries[0].name).toBe("atlas-aci");
  });

  it("entries[0].installed is an empty string (not null, not undefined)", () => {
    const entries = loadFixture();
    expect(entries[0].installed).toBe("");
    expect(entries[0].installed).not.toBeNull();
    expect(entries[0].installed).not.toBeUndefined();
  });

  it("entries[1].name === 'junction'", () => {
    const entries = loadFixture();
    expect(entries[1].name).toBe("junction");
  });

  it("entries[1].installed is an empty string", () => {
    const entries = loadFixture();
    // Fixture has both entries as not installed (installed: "").
    expect(entries[1].installed).toBe("");
  });

  it("entries[1].update === 'install'", () => {
    const entries = loadFixture();
    expect(entries[1].update).toBe("install");
  });

  it("entries[0].update === 'install'", () => {
    const entries = loadFixture();
    expect(entries[0].update).toBe("install");
  });

  it("all entries have required string fields", () => {
    const entries = loadFixture();
    for (const entry of entries) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.scope).toBe("string");
      expect(typeof entry.kind).toBe("string");
      expect(typeof entry.installed).toBe("string"); // "" is a string
      expect(typeof entry.latest).toBe("string");
      expect(typeof entry.update).toBe("string");
    }
  });

  it("installed is never null on any entry", () => {
    const entries = loadFixture();
    for (const entry of entries) {
      expect(entry.installed).not.toBeNull();
    }
  });

  it("entries[0].scope === 'system'", () => {
    const entries = loadFixture();
    expect(entries[0].scope).toBe("system");
  });

  it("entries[0].kind === 'oci-image'", () => {
    const entries = loadFixture();
    expect(entries[0].kind).toBe("oci-image");
  });

  it("entries[1].kind === 'binary'", () => {
    const entries = loadFixture();
    expect(entries[1].kind).toBe("binary");
  });

  it("entries[0].latest === '0.2.2'", () => {
    const entries = loadFixture();
    expect(entries[0].latest).toBe("0.2.2");
  });

  it("entries[1].latest === '0.2.0'", () => {
    const entries = loadFixture();
    expect(entries[1].latest).toBe("0.2.0");
  });

  it("idempotency: JSON.parse(JSON.stringify(entries)) deep-equals entries", () => {
    const entries = loadFixture();
    const roundtripped = JSON.parse(JSON.stringify(entries)) as McpListEntry[];
    expect(roundtripped).toEqual(entries);
  });
});
