# Changelog

All notable changes to GAMBIT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `McpStoreRoute`: corrected `eidolons.mcp.lock` schema — top-level key is `mcps` (array of `{name, kind, version, source, target, hosts_wired, installed_at}`), not `servers: Record<string,_>`. Route now iterates `mcps[]` and renders name, kind badge, version, source repo, target path, installed-at, and hosts-wired list. Live fixture pinned at `tests/parsers/eidolons-mcp-lock.fixture.yaml`.
- `HarnessRoute`: primary read now targets `eidolons.mcp.lock` (finds `mcps[name==="junction"]`); `.eidolons/harness/manifest.json` is a fallback sidecar only. Route shows registered status pill, version, binary target path, source repo, installed-at from mcp.lock; sidecar health + features rendered under "Sidecar details" if present.
- `RosterRoute`: YAML parser corrected from `members:` / `  <name>:` (wrong shape) to `eidolons:` / `  - name: <value>` (real roster/index.yaml shape). Members are now correctly extracted from the array.
- Shared parsing logic extracted to `src/lib/parseMcpLock.ts` (`parseMcpLock`, `findJunctionEntry`), used by both McpStoreRoute and HarnessRoute.
- Tauri 2 fs capability scope now allows route components to read user-picked project files and the `$HOME/.eidolons` subtree (P1-B from VIGIL's blank-pane root-cause-report). Routes affected: Roster (`nexus/roster/index.yaml`), Project + MCP Store (`eidolons.{yaml,lock,mcp.lock}` in picked project), Harness (`.eidolons/harness/manifest.json`), Methodology (`.eidolons/*` directory listing + `agent.md` reads).
- Doctor route now renders the live `eidolons doctor` check grid. Three independent bugs fixed together:
  parser regex updated to match category-grouped output (`=== Foo ===` headings, glyph at line start, no
  `[N/M]` badges); stdout listener wired up (real check rows are on stdout, only the banner + summary on
  stderr); `exit_code` wire field renamed to `exitCode` to match the Rust `serde rename_all = "camelCase"`
  output (also applied to `useSync.ts`). See VIGIL root-cause-report at
  `.junction/threads/904039f7-0699-46e8-8ccc-f587b2c04caa/root-cause-report.md`.

### v0.1 → v0.2 Doctor follow-ups

The following P1/P2 items are deferred from this round:

- **P1-A** — Defensive "done-but-empty" render branch in `DoctorDashboard.tsx`: surface "Doctor ran but
  produced no parseable output" + "View raw" when `state === "done" && checks.length === 0`.
- **P1-B** — Render `category` headings in the dashboard grid: group rows by `check.category`, emit an
  `<h3>` between groups; drop the now-meaningless `[i/n]` badge from `CheckRow`.
- **P1-C** — Rename `rawStderr` → `rawOutput` in `useDoctor.ts`, `DoctorDashboard.tsx`, `DoctorRoute.tsx`
  (the combined-stream buffer is no longer stderr-only post-P0-B).
- **P2-A** — Defensive `typeof doctor.exitCode === "number"` guard in `DoctorRoute.tsx:80`,
  `DoctorDashboard.tsx:177`, and `LogPane.tsx:124` to belt-and-braces the P0-C fix.
- **P2-B** — Update the "Parser note (GAP-03)" comment in `doctor.rs:22-24` to reflect that check rows are
  on stdout and the banner/summary are on stderr.

### Added

- Syntax highlighting in methodology fenced code blocks via rehype-highlight. Supports rust/bash/ts/json/yaml/diff out of the box. Theme uses GAMBIT design tokens for keyword/string/comment colors.
- MCP Store now supports Install / Uninstall / Upgrade actions per row. Uses `eidolons mcp list --json` as the primary catalogue + install-state source (replaces the older eidolons.mcp.lock-only read). Streaming output via McpInstallPane; auto-refresh after completion. Closes v0.2 DoD §7.1 'MCP Store install/uninstall end-to-end'.
- Methodology route now renders agent.md files as proper markdown (react-markdown + remark-gfm) — headings, fenced code, GFM tables, lists, blockquotes, inline code. YAML front-matter is stripped before render. Replaces the previous `<pre>`-text fallback.
- Upgrade flow: ⌘K palette "Check upgrades" runs `eidolons upgrade --check --json`, renders a plan-review table (nexus + 6 Eidolon members with status badges), Apply-all button streams `eidolons upgrade --yes` with cancel support. Mirrors Sync + Doctor patterns. Per-member selection deferred to v0.2.
- NSVisualEffectView `.sidebar` vibrancy on macOS with graceful solid fallback on Linux/Windows (smoke-test a).
- Docker-first dev workflow — `Dockerfile.dev`, `docker-compose.yml`, `Makefile` (install/lint/typecheck/cargo-check/ci/shell containerised; `make dev` host-only for the GUI).
- ⌘K command palette (cmdk) — smoke-test b. Navigate + stub actions + About. Cold-open target <100ms.
- `eidolons.lock` file watcher + drift pill (smoke-test c). 250ms debounce in Rust via notify-debouncer-mini. Minimal project picker via @tauri-apps/plugin-dialog.
- Live `eidolons sync` streaming with ANSI-coloured log pane (smoke-test sync-stream). Virtualized via @tanstack/react-virtual; ANSI parsed by anser. Cancel via SIGKILL (SIGINT is a v0.2 follow-up).

### v0.0.1 → v0.1 follow-ups

The following items are scoped for the v0.1 MVP (smoke-test-driven):

- (a) NSVisualEffectView vibrancy on macOS sidebar (graceful solid fill on Linux).
- (b) `eidolons sync` stdout streaming: virtualized log pane with ANSI rendering and SIGINT support.
- (c) FSEvents / `notify` file-watcher on `eidolons.lock` — 250 ms debounce, drift pill within 1 s.
- (d) ⌘K command palette (cmdk) — cold open <100 ms, fuzzy-matched project/navigate sections.
- (e) Linux AppImage cross-compile in CI matrix — graceful solid sidebar fallback.
- Bundled `eidolons` CLI extraction on first launch + SHA-256 checksum verification.
- shadcn/ui + Radix primitives — deferred from v0.0.1 (v0.0.1 uses plain CSS variables).
- Real route components for Roster, Project, MCP Store, Harness, Doctor, Methodology, Settings.
- Tailwind CSS — adopted alongside shadcn in v0.1.
- Project picker: pick a folder, validate `eidolons.yaml` present.
- Drift pill in status bar wired to live file-watching.
- Sonner toast integration (success 2.5 s auto-dismiss, errors persist with "View log").

## [0.0.1] — 2026-05-20

### Added

- Initial scaffold. Brand-identity-as-config. Tauri 2 + React 18 + Vite. License: MIT.
- `brand.toml` — single source of truth for project identity (name, slug, bundle_id, tagline, FF lineage).
- `scripts/rebrand.sh` — bash 3.2 compatible script that regenerates every derived identity file in one atomic pass. Usage: `./scripts/rebrand.sh NEWNAME`.
- Derived identity files: `src/lib/brand.ts`, `src-tauri/src/brand.rs`.
- Tauri 2.x + React 18 + Vite 5 project structure.
- Dark-mode-first CSS variables covering the full design token set from the SPECTRA spec (bg, surface, border, text, accent, status tokens).
- `Sidebar` component — branded header (name + tagline), placeholder destination list (Roster, Project, MCP Store, Harness, Doctor, Methodology, Settings).
- `MainPane` component — welcome empty state with FF lineage copy.
- `src/lib/theme.ts` — TypeScript design token constants.
- CI workflows: `ci.yml` (lint + typecheck + cargo check), `cli-pin-check.yml` (pin stub).
- `src-tauri/cli.pin.toml` — bundled CLI pin stub (version 1.3.0, SHA placeholder).
- `src-tauri/resources/` — placeholder directory for bundled CLI tarball.
- `Dockerfile.dev` + `.devcontainer/devcontainer.json` — dev container skeleton (Node 22 + Rust + Tauri Linux deps).
- MIT License.
