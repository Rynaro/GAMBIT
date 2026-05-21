// upgrade.types.ts — TypeScript interfaces mirroring the JSON shape emitted by
// `eidolons upgrade --check --json`.
//
// Live fixture pinned at:
//   tests/parsers/eidolons-upgrade-check.fixture.json
//
// Observed status enums in the wild:
//   "upgrade available" — installed < latest, constraint allows the bump
//   "up-to-date"        — installed == latest
//   "pinned-out"        — installed < latest but semver constraint forbids bump

export type UpgradeStatus = "upgrade available" | "up-to-date" | "pinned-out";

export interface NexusCurrent {
  tag: string;
  commit: string;
}

export interface NexusLatest {
  tag: string;
}

export interface NexusBlock {
  current: NexusCurrent;
  latest: NexusLatest;
  /** Known values: "upgrade available" | "up-to-date" | "pinned-out".
   *  Typed permissively so unknown future enums render rather than crash. */
  status: UpgradeStatus | string;
}

export interface UpgradeMember {
  name: string;
  installed: string;
  latest: string;
  constraint: string;
  /** Known values: "upgrade available" | "up-to-date" | "pinned-out". */
  status: UpgradeStatus | string;
}

export interface UpgradeSummary {
  nexus_upgrade_available: boolean;
  member_upgrades_available: number;
  member_upgrades_pinned_out: number;
  members_not_installed: number;
}

export interface UpgradePlan {
  nexus: NexusBlock;
  members: UpgradeMember[];
  summary: UpgradeSummary;
}
