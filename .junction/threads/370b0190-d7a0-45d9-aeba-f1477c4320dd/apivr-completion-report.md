---
eidolon: apivr
version: 3.1.2
kind: apivr-completion-report
status: completed
created_at: "2026-05-21T00:00:00Z"
files_changed_count: 4
tests_run: 0
tests_passed: 0
deltas_count: 0
escalations_count: 0
---

## What built

Applied the P0 root-cause fix (macos-private-api Cargo feature + macOSPrivateApi JSON key) and the first P1 recommendation (setupPlatform hoist to pre-render) from VIGIL's analysis at `root-cause-report.md`.

## Changes

**Commit 1 — `fix(vibrancy): enable macos-private-api on tauri + macOSPrivateApi at app root`** (`babc4c6`)

- `src-tauri/Cargo.toml`: added `"macos-private-api"` to the `tauri` dependency features list (was `features = []`). This unlocks the Tauri 2 code path that calls `NSWindow.setOpaque(false)` / `NSWindow.setBackgroundColor(.clear)` at runtime — without it `transparent: true` in config is parsed but silently ignored.
- `src-tauri/tauri.conf.json`: added `"macOSPrivateApi": true` at the `app` object root, sibling to `"windows"`. The JSON validated clean (no trailing-comma issues). The `windows[0]` entry is unchanged.

**Commit 2 — `refactor(platform): hoist setupPlatform() to main.tsx pre-render`** (`2d15a69`)

- `src/main.tsx`: added `import { setupPlatform } from "./lib/platform"` and a `setupPlatform()` call before `createRoot(root).render(...)`. The call runs synchronously at module evaluation, before React's first render, so `[data-platform]` is stamped on `<html>` on the very first frame.
- `src/App.tsx`: removed the `setupPlatform` import and the `useEffect(() => { setupPlatform(); }, [])` block. Also dropped the now-unused `useEffect` import (only `useState` remains from react).

## Failures and why

No failures. All four edits are syntactically clean (JSON validated, TypeScript imports/removals are consistent). `cargo check` and `pnpm tauri dev` are deferred to the parent — tool constraints prohibit running them here per mission scope.

**Deferred interventions (not failures):**

- P1 platform.ts overhaul (restore `@tauri-apps/plugin-os` as primary detector): deferred — `@tauri-apps/plugin-os` is not wired in the project yet. Tracked as a v0.1 follow-up.
- P2 Makefile/Rust smoke gate: process change, out of scope.
- P2 `titleBarStyle: "Overlay"` reconsideration: deferred until P0 is visually verified on macOS per VIGIL's recommendation.

## Test summary

Tests run: 0 (tool constraints prohibit `cargo check` / `pnpm tauri dev`; visual validation is human-judged on macOS). Parent to run `cargo check` and visual smoke after merge.

Hand-off to IDG to chronicle the vibrancy fix in the Unreleased section of CHANGELOG.md.
