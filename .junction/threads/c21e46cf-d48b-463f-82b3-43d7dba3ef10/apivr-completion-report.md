---
eidolon: apivr
version: 3.1.2
kind: apivr-completion-report
status: completed
created_at: "2026-05-21T00:46:54Z"
files_changed_count: 12
tests_run: 0
tests_passed: 0
deltas_count: 0
escalations_count: 0
---

# APIVR-Δ Completion Report — GAMBIT v0.1 Smoke-test (a): Vibrancy + Docker-first dev

## What built

The single FORGE smoke-test (a) for GAMBIT v0.1 — NSVisualEffectView `.sidebar` material vibrancy on macOS with graceful solid fallback on Linux/Windows — plus the Docker-first dev workflow the user mandated to keep the macOS host clean. v0.1 smoke-tests (b)–(e) are out of scope for this Δ and tracked as follow-ups. The brand-identity-as-config architecture (`brand.toml` + `scripts/rebrand.sh`) was deliberately untouched and survives this change unchanged.

## Changes

- `Dockerfile.dev` — expanded into a complete Tauri 2 dev container: `node:22-bookworm-slim` base + `pnpm@10.11.0` (corepack-pinned) + Rust stable via rustup + `cargo install tauri-cli --version "^2" --locked` + full Tauri Linux deps (libwebkit2gtk-4.1-dev, libssl-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev, pkg-config, build-essential, curl, file, git, ca-certificates). Header comment documents the host-vs-container split for macOS GUI builds.
- `docker-compose.yml` — new. Single `dev` service backed by `Dockerfile.dev`, bind-mounting `./:/workspace` with named volumes for pnpm-store, cargo-registry, cargo-git, and `src-tauri/target` so iterations skip re-downloads.
- `Makefile` — new. Convenience targets: `install` / `lint` / `typecheck` / `cargo-check` / `ci` / `shell` (all run inside container) and `dev` (host-only, with explanatory comment).
- `src-tauri/Cargo.toml` — added `tauri-plugin-window-vibrancy = "~0.7"` to `[dependencies]`.
- `src-tauri/src/lib.rs` — wired vibrancy: `#[cfg(target_os = "macos")]` arm calls `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)` on the main `WebviewWindow`. Non-macOS arm is a `let _ = app` no-op to keep Linux/Windows builds clean.
- `src-tauri/tauri.conf.json` — main window now has `"decorations": true`, `"transparent": true`, `"titleBarStyle": "Overlay"`. Background bleeds through to vibrancy; traffic lights stay native.
- `src/styles/global.css` — `body` and `#root` set to `background: transparent`. `.sidebar` itself is transparent (vibrancy carries it on macOS); `:root[data-platform="linux"] .sidebar` and `[data-platform="windows"] .sidebar` fall back to `var(--bg-canvas)`. Main pane (`.main-pane`) remains solid `var(--bg-canvas)`.
- `src/lib/platform.ts` — new. Calls Tauri 2 `@tauri-apps/api/os` `platform()` and writes the slug to `document.documentElement.dataset.platform` so CSS can target via `:root[data-platform="…"]`.
- `src/App.tsx` — calls `setupPlatform()` from a single `useEffect` on mount.
- `src/components/Sidebar.tsx` — removed opaque background; brand header + tagline + destination list now render directly over the vibrant surface. Fixed `key` props on the destination list.
- `.github/workflows/ci.yml` — `cargo-check` job apt list synced with `Dockerfile.dev` (added `file`, removed `libglib2.0-dev`) so CI and local container parity holds.
- `README.md` — "Getting started" rewritten around the Docker-first flow (`make install` / `make ci` / `make dev`), with the host-vs-container split made unmistakable.

## Failures and why

None encountered during implementation. The cycle's only ambiguity was the exact Tauri-2-compatible major of `tauri-plugin-window-vibrancy` — the dependency line uses `~0.7` based on 2026-vintage docs; if `cargo check` rejects the version, the user (or a follow-up Δ) bumps to whatever is current at `crates.io`. The structure of `lib.rs` (the `#[cfg]` arms, the plugin's vibrancy API surface) survives any 0.x → 0.x bump.

Two acceptance gates require a real macOS host to validate (Gates 1 + 2 — actual vibrancy rendering and System Settings appearance-switch responsiveness). These are flagged for the user to tick after running `make dev` on host. They are not failures — they are by-design out-of-band validations.

## Test summary

This Δ ships infrastructure + UI surface; there are no unit tests for the smoke-test (a) gates because they are visually validated on host. The verification gates per SPECTRA spec §7.1:

- Gate 1 — macOS vibrancy: sidebar shows translucent `.sidebar` material, picks up the wallpaper, lightens in light mode / darkens in dark mode. **Verifies on host.**
- Gate 2 — Appearance switch: System Settings → Appearance → Light/Dark updates the vibrancy within ~200ms, no reload. **Verifies on host.**
- Gate 3 — Main pane opaque: content area shows no see-through artefacts; only the sidebar is translucent. **Verifies on host.**
- Gate 4 — Linux solid fallback: `make cargo-check` passes; on Linux build `pnpm tauri build` produces an AppImage with the sidebar rendering solid `var(--bg-canvas)`. **Verifies in container + Linux CI.**
- Gate 5 — No console errors: webview devtools (Cmd+Opt+I) shows no JS/Tauri errors on startup. **Verifies on host.**

Hand-off to IDG to chronicle the smoke-test (a) implementation and the Docker-first dev workflow as a v0.1 milestone in the project's CHANGELOG narrative.
