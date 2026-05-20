// AUTO-GENERATED from brand.toml — do not edit by hand.
// Run `./scripts/rebrand.sh <NEW_NAME>` to regenerate.

export const BRAND = {
  name: "MATERIA",
  slug: "materia",
  display: "MATERIA",
  tagline: "The ControlCenter where you equip the Eidolons.",
  ffOrigin: "FF7 — orbs slotted into equipment for abilities and summons",
  github: {
    org: "Rynaro",
    repo: "MATERIA",
    url: "https://github.com/Rynaro/MATERIA",
  },
  bundleId: "dev.eidolons.materia",
  homebrewTap: "rynaro/materia",
  domain: "materia.eidolons.dev",
  lineage: {
    agents: "Eidolons",
    harness: "Junction",
    controlCenter: "MATERIA",
  },
} as const;

export type Brand = typeof BRAND;
