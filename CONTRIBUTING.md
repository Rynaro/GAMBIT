# Contributing to MATERIA

## Before you change anything identity-bearing

All identity fields (name, slug, bundle ID, tagline, GitHub org/repo, Homebrew tap, domain) live in a single file: `brand.toml`. The derived files (`package.json` `productName`, `src-tauri/tauri.conf.json` identifier, `src/lib/brand.ts`, `src-tauri/src/brand.rs`, README headings) are **generated** — do not edit them by hand.

To rename the project, run:

```bash
./scripts/rebrand.sh NEWNAME
```

The script refuses to run if the working tree is dirty. Review the diff with `git diff` and commit when satisfied.

## Package manager

Use **pnpm only** — no npm, no yarn. The repo pins `pnpm@10.11.0` via the `packageManager` field in `package.json`. pnpm 11.x's `verify-deps-before-run` hook breaks `pnpm exec`; do not upgrade.

## Commits

Sign-off required (DCO-style):

```
feat(sidebar): add active destination indicator

Signed-off-by: Your Name <your@email.com>
```

Use the conventional commit prefix that best describes the change: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

## Code style

Run before every commit:

```bash
pnpm lint       # biome check
pnpm type-check # tsc --noEmit
```

CI enforces both. A red CI is a blocked PR.

## Rust side

```bash
cd src-tauri && cargo check
```

CI runs `cargo check` on the Rust side. Clippy warnings that are `deny`-level will block CI in v0.1.

## Design tokens

Do not hard-code color values in components. Use the CSS variables defined in `src/styles/global.css` (e.g. `var(--accent-primary)`) and the TypeScript constants in `src/lib/theme.ts`. New tokens must be added to both places.

## Tauri version

The Tauri minor version is pinned in `src-tauri/Cargo.toml`. Do not bump it without a dedicated PR and a manual review of the Tauri v2 migration guide for the target version.
