// AUTO-GENERATED from brand.toml — do not edit by hand.
// Run `./scripts/rebrand.sh <NEW_NAME>` to regenerate.

export const BRAND = {
  name: "GAMBIT",
  slug: "gambit",
  display: "GAMBIT",
  tagline: "The ControlCenter where you equip the Eidolons.",
  ffOrigin: "FF7 — orbs slotted into equipment for abilities and summons",
  github: {
    org: "Rynaro",
    repo: "GAMBIT",
    url: "https://github.com/Rynaro/GAMBIT",
  },
  bundleId: "dev.eidolons.gambit",
  homebrewTap: "rynaro/gambit",
  domain: "gambit.eidolons.dev",
  lineage: {
    agents: "Eidolons",
    harness: "Junction",
    controlCenter: "GAMBIT",
  },
} as const;

export type Brand = typeof BRAND;
