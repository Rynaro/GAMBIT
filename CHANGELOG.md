# Changelog

All notable changes to GAMBIT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- NSVisualEffectView `.sidebar` vibrancy on macOS with graceful solid fallback on Linux/Windows (smoke-test a).
- Docker-first dev workflow — `Dockerfile.dev`, `docker-compose.yml`, `Makefile` (install/lint/typecheck/cargo-check/ci/shell containerised; `make dev` host-only for the GUI).
- ⌘K command palette (cmdk) — smoke-test b. Navigate + stub actions + About. Cold-open target <100ms.
- `eidolons.lock` file watcher + drift pill (smoke-test c). 250ms debounce in Rust via notify-debouncer-mini. Minimal project picker via @tauri-apps/plugin-dialog.

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
