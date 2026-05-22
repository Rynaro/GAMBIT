// parseUpgradeCheck.test.ts — Vitest unit tests for the UpgradePlan JSON shape.
//
// Fixture: tests/parsers/eidolons-upgrade-check.fixture.json — verbatim capture
//   of a live `eidolons upgrade --check --json` run.
//
// Cases:
//   1. Parsed object has nexus, members, summary top-level keys.
//   2. nexus.current.tag === "v1.3.0"
//   3. members.length === 6
//   4. members[0].name === "atlas" and members[0].status === "upgrade available"
//   5. summary.member_upgrades_available === 6
//   6. Idempotency: JSON.parse(JSON.stringify(plan)) deep-equals plan.
//   7. All expected member names are present.
//   8. Nexus status is "up-to-date" in the fixture.
//   9. summary.nexus_upgrade_available === false

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { UpgradePlan } from "../../src/lib/upgrade.types";

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(__dirname, "../parsers/eidolons-upgrade-check.fixture.json");

function loadFixture(): UpgradePlan {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as UpgradePlan;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpgradePlan fixture shape", () => {
  it("has nexus, members, summary top-level keys", () => {
    const plan = loadFixture();
    expect(plan).toHaveProperty("nexus");
    expect(plan).toHaveProperty("members");
    expect(plan).toHaveProperty("summary");
  });

  it("nexus.current.tag is v1.3.0", () => {
    const plan = loadFixture();
    expect(plan.nexus.current.tag).toBe("v1.3.0");
  });

  it("nexus.current.commit is a 40-hex SHA", () => {
    const plan = loadFixture();
    expect(plan.nexus.current.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("nexus.latest.tag matches nexus.current.tag (up-to-date)", () => {
    const plan = loadFixture();
    expect(plan.nexus.latest.tag).toBe(plan.nexus.current.tag);
  });

  it("nexus.status is up-to-date", () => {
    const plan = loadFixture();
    expect(plan.nexus.status).toBe("up-to-date");
  });

  it("members.length === 6", () => {
    const plan = loadFixture();
    expect(plan.members).toHaveLength(6);
  });

  it("members[0].name === atlas", () => {
    const plan = loadFixture();
    expect(plan.members[0].name).toBe("atlas");
  });

  it("members[0].status === upgrade available", () => {
    const plan = loadFixture();
    expect(plan.members[0].status).toBe("upgrade available");
  });

  it("all expected member names are present", () => {
    const plan = loadFixture();
    const names = plan.members.map((m) => m.name);
    expect(names).toContain("atlas");
    expect(names).toContain("spectra");
    expect(names).toContain("apivr");
    expect(names).toContain("idg");
    expect(names).toContain("forge");
    expect(names).toContain("vigil");
  });

  it("every member has installed, latest, constraint, status fields", () => {
    const plan = loadFixture();
    for (const member of plan.members) {
      expect(typeof member.installed).toBe("string");
      expect(typeof member.latest).toBe("string");
      expect(typeof member.constraint).toBe("string");
      expect(typeof member.status).toBe("string");
    }
  });

  it("summary.member_upgrades_available === 6", () => {
    const plan = loadFixture();
    expect(plan.summary.member_upgrades_available).toBe(6);
  });

  it("summary.nexus_upgrade_available === false", () => {
    const plan = loadFixture();
    expect(plan.summary.nexus_upgrade_available).toBe(false);
  });

  it("summary.member_upgrades_pinned_out === 0", () => {
    const plan = loadFixture();
    expect(plan.summary.member_upgrades_pinned_out).toBe(0);
  });

  it("summary.members_not_installed === 0", () => {
    const plan = loadFixture();
    expect(plan.summary.members_not_installed).toBe(0);
  });

  it("idempotency: JSON.parse(JSON.stringify(plan)) deep-equals plan", () => {
    const plan = loadFixture();
    const roundtripped = JSON.parse(JSON.stringify(plan)) as UpgradePlan;
    expect(roundtripped).toEqual(plan);
  });
});
