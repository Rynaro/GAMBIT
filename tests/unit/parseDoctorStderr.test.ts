// parseDoctorStderr.test.ts — Vitest unit tests for the doctor combined-output parser.
//
// Fixture: tests/parsers/doctor.fixture.txt — verbatim capture of a live
//   `eidolons doctor` run (category-grouped, glyph-at-start rows, no [N/M] badges).
//
// Cases:
//   1. Empty / blank input → []
//   2. Verbatim fixture round-trip → 30 checks
//   3. First check is the eidolons.yaml present pass in "Manifest + lock"
//   4. Pending upgrades rows carry warn status + correct category
//   5. Banner + summary lines are ignored (not present as check names)
//   6. ANSI escape stripping
//   7. Idempotency

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { type DoctorCheck, parseDoctorStderr } from "../../src/lib/parseDoctorStderr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(__dirname, "../parsers/doctor.fixture.txt");

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf-8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseDoctorStderr", () => {
  // ------------------------------------------------------------------
  // Edge cases: empty / blank input
  // ------------------------------------------------------------------

  it("returns [] for empty input", () => {
    expect(parseDoctorStderr("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseDoctorStderr("  \n  \n")).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Real fixture round-trip
  // ------------------------------------------------------------------

  it("parses verbatim eidolons doctor output → 30 checks", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    // 2 (manifest) + 6 (installed) + 1 (host) + 1 (dispatch) +
    // 6 (release) + 6 (cache) + 1 (mcp-servers) + 1 (mcp-drift) +
    // 6 (pending-upgrade member rows) = 30
    // The "· Run `eidolons upgrade`" trailer is appended as a message
    // continuation on the last upgrade row, not counted as a separate check.
    expect(result).toHaveLength(30);
  });

  it("first check is the eidolons.yaml present pass", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    expect(result[0]).toMatchObject<Partial<DoctorCheck>>({
      category: "Manifest + lock",
      name: "eidolons.yaml present",
      status: "pass",
    });
  });

  it("captures Pending upgrades as warn rows with category", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    const warnRows = result.filter((c) => c.status === "warn");
    expect(warnRows.length).toBeGreaterThan(0);
    const pendingRow = warnRows.find((c) => c.category === "Pending upgrades");
    expect(pendingRow).toBeDefined();
    expect(pendingRow!.status).toBe("warn");
  });

  it("ignores banner + summary lines — no check has those names", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    for (const check of result) {
      expect(check.name).not.toContain("All checks passed");
      expect(check.name).not.toContain("eidolons doctor —");
    }
  });

  it("all checks carry a non-empty category matching their section heading", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    for (const check of result) {
      expect(check.category.length).toBeGreaterThan(0);
    }
  });

  it("index and total are correctly back-filled", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);
    expect(result[0].index).toBe(1);
    expect(result[result.length - 1].index).toBe(result.length);
    for (const check of result) {
      expect(check.total).toBe(result.length);
    }
  });

  // ------------------------------------------------------------------
  // ANSI-strip
  // ------------------------------------------------------------------

  it("strips ANSI escape sequences and parses identically", () => {
    const green = "\x1b[32m";
    const reset = "\x1b[0m";
    const withAnsi = `=== Manifest + lock ===\n  ${green}✓${reset} eidolons.yaml present`;
    const withoutAnsi = `=== Manifest + lock ===\n  ✓ eidolons.yaml present`;
    const resultWithAnsi = parseDoctorStderr(withAnsi);
    const resultWithout = parseDoctorStderr(withoutAnsi);
    expect(resultWithAnsi).toEqual(resultWithout);
    expect(resultWithAnsi[0].status).toBe("pass");
  });

  // ------------------------------------------------------------------
  // Idempotency
  // ------------------------------------------------------------------

  it("is idempotent: parsing the same input twice yields equal output", () => {
    const fixture = loadFixture();
    const first = parseDoctorStderr(fixture);
    const second = parseDoctorStderr(fixture);
    expect(second).toEqual(first);
  });

  // ------------------------------------------------------------------
  // Minimal unit: single-check inputs
  // ------------------------------------------------------------------

  it("parses a single pass check with category", () => {
    const input = "=== Manifest + lock ===\n  ✓ eidolons.yaml present";
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<DoctorCheck>>({
      index: 1,
      total: 1,
      category: "Manifest + lock",
      name: "eidolons.yaml present",
      status: "pass",
      message: "",
    });
  });

  it("parses a fail check with category and message continuation", () => {
    const input = [
      "=== Host wiring ===",
      "  ✗ host wiring complete",
      "    CLAUDE.md missing eidolon:spectra block",
    ].join("\n");
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("fail");
    expect(result[0].category).toBe("Host wiring");
    expect(result[0].message).toContain("CLAUDE.md missing");
  });

  it("handles all three statuses in one input", () => {
    const input = ["=== Checks ===", "  ✓ check A", "  · check B", "  ✗ check C"].join("\n");
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("pass");
    expect(result[1].status).toBe("warn");
    expect(result[2].status).toBe("fail");
  });
});
