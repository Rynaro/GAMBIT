// parseDoctorStderr.test.ts — Vitest unit tests for the doctor stderr parser.
//
// Cases:
//   1. Empty input → []
//   2. Whitespace-only input → []
//   3. Single pass check
//   4. Single warn check with detail message
//   5. Single fail check with multi-line detail
//   6. 9-check full fixture round-trip
//   7. Trailing whitespace tolerance
//   8. Idempotency: parsing the same text twice yields the same result
//   9. ANSI escape stripping

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseDoctorStderr, type DoctorCheck } from "../../src/lib/parseDoctorStderr";

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
  it("returns [] for empty input", () => {
    expect(parseDoctorStderr("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseDoctorStderr("   \n   \n   ")).toEqual([]);
  });

  it("parses a single pass check", () => {
    const input = "  [1/9] eidolons.yaml present              ✓";
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject<Partial<DoctorCheck>>({
      index: 1,
      total: 9,
      name: "eidolons.yaml present",
      status: "pass",
      message: "",
    });
  });

  it("parses a single warn check with a detail message", () => {
    const input = [
      "  [4/9] dispatch freshness               ·",
      "        → 1 legacy pointer detected",
    ].join("\n");
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    const check = result[0];
    expect(check.index).toBe(4);
    expect(check.total).toBe(9);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("1 legacy pointer detected");
  });

  it("parses a single fail check with multi-line detail", () => {
    const input = [
      "  [5/9] host wiring complete               ✗",
      "        → CLAUDE.md missing eidolon:spectra block",
      "        → Re-run 'eidolons sync --force' to repair",
    ].join("\n");
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    const check = result[0];
    expect(check.status).toBe("fail");
    expect(check.message).toContain("CLAUDE.md missing");
    expect(check.message).toContain("Re-run");
    // Multi-line: message should have a newline between the two detail lines.
    expect(check.message.split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("parses the 9-check fixture round-trip correctly", () => {
    const fixture = loadFixture();
    const result = parseDoctorStderr(fixture);

    // Should produce exactly 9 checks.
    expect(result).toHaveLength(9);

    // Spot-check each check.
    const byIndex = (i: number) => result.find((c) => c.index === i)!;

    // Check 1: pass, no message
    expect(byIndex(1)).toMatchObject({ index: 1, total: 9, status: "pass" });
    expect(byIndex(1).message).toBe("");

    // Check 2: pass
    expect(byIndex(2)).toMatchObject({ status: "pass" });

    // Check 3: pass
    expect(byIndex(3)).toMatchObject({ status: "pass" });

    // Check 4: pass
    expect(byIndex(4)).toMatchObject({ status: "pass" });

    // Check 5: fail — has detail message
    expect(byIndex(5)).toMatchObject({ status: "fail" });
    expect(byIndex(5).message).toContain("CLAUDE.md missing");

    // Check 6: warn — has detail message
    expect(byIndex(6)).toMatchObject({ status: "warn" });
    expect(byIndex(6).message).toContain("legacy");

    // Check 7: pass
    expect(byIndex(7)).toMatchObject({ status: "pass" });

    // Check 8: pass
    expect(byIndex(8)).toMatchObject({ status: "pass" });

    // Check 9: warn — has detail message
    expect(byIndex(9)).toMatchObject({ status: "warn" });
    expect(byIndex(9).message).toContain("upgrade");
  });

  it("is tolerant of trailing whitespace on lines", () => {
    // Lines with trailing spaces / tabs should still parse correctly.
    const input = "  [1/9] eidolons.yaml present              ✓   \n  [2/9] lock present                       ✓  \t";
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("pass");
    expect(result[1].status).toBe("pass");
  });

  it("is idempotent: parsing the same text twice yields equal output", () => {
    const fixture = loadFixture();
    const first = parseDoctorStderr(fixture);
    const second = parseDoctorStderr(fixture);
    expect(second).toEqual(first);
  });

  it("strips ANSI escape sequences before matching glyphs", () => {
    // Simulate the actual CLI output where glyphs are wrapped in ANSI codes.
    // GREEN = \x1b[32m, RESET = \x1b[0m
    const green = "\x1b[32m";
    const reset = "\x1b[0m";
    const input = `  [1/9] eidolons.yaml present              ${green}✓${reset}`;
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("pass");
  });

  it("handles all three statuses in a single input", () => {
    const input = [
      "  [1/3] check A                            ✓",
      "  [2/3] check B                            ·",
      "        → some warning detail",
      "  [3/3] check C                            ✗",
      "        → some error detail",
    ].join("\n");
    const result = parseDoctorStderr(input);
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("pass");
    expect(result[1].status).toBe("warn");
    expect(result[1].message).toContain("warning detail");
    expect(result[2].status).toBe("fail");
    expect(result[2].message).toContain("error detail");
  });
});
