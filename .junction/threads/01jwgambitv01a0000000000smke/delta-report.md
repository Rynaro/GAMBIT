# APIVR-Δ Delta Report — GAMBIT v0.1 Smoke-test (a): Vibrancy

**Thread:** 01jwgambitv01a0000000000smke
**Step:** S0  
**From:** APIVR-Δ 3.1.2 → **To:** SPECTRA 4.3.2  
**Date:** 2026-05-20

## Changes delivered

- **Docker-first dev workflow:** Expanded `Dockerfile.dev` with full Tauri 2 Linux deps, Rust stable, `tauri-cli ^2`, and pnpm@10.11.0 via corepack. Added `docker-compose.yml` with named volumes (pnpm-store, cargo-registry, cargo-git, tauri-target). Added `Makefile` with `install / lint / typecheck / cargo-check / ci / shell / dev` targets; `make dev` is intentionally host-only with an explanatory comment.
- **Vibrancy wiring (Rust):** Added `tauri-plugin-window-vibrancy = "~0.7"` to `src-tauri/Cargo.toml`. Updated `src-tauri/src/lib.rs` with `#[cfg(target_os = "macos")]` guard around `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)`. Non-macOS arm uses `let _ = app` to suppress the unused-variable warning; the plugin's macOS-only imports are fully gated so Linux/Windows compile cleanly.
- **Window transparency (Tauri config):** Added `"decorations": true`, `"transparent": true`, `"titleBarStyle": "Overlay"` to `tauri.conf.json` window entry. Traffic lights stay visible; background bleeds through to vibrancy.
- **CSS surface contract:** `body` and `#root` set to `background: transparent`. Sidebar `background: transparent` (vibrancy carries it on macOS). Platform fallback selectors `:root[data-platform="linux"] .sidebar` and `[data-platform="windows"] .sidebar` use `var(--bg-canvas)`. Main pane remains `background-color: var(--bg-canvas)` — fully opaque.
- **Platform detector:** New `src/lib/platform.ts` calls Tauri 2 `@tauri-apps/api/os` `platform()` and writes the result to `document.documentElement.dataset.platform`. `App.tsx` calls it once in a `useEffect`. `Sidebar.tsx` cleaned up (background handled by CSS; `key` props fixed).
- **CI parity:** Updated `.github/workflows/ci.yml` cargo-check job apt list to match `Dockerfile.dev` exactly (`libssl-dev`, `libayatana-appindicator3-dev`, removed `libglib2.0-dev`, added `file`).

## Smoke-test (a) acceptance gates (user validates on host after `make dev`)

- [ ] **Gate 1 — macOS vibrancy:** Sidebar shows translucent `.sidebar` material, picks up the desktop wallpaper, lightens in light mode / darkens in dark mode.
- [ ] **Gate 2 — Appearance switch:** Switching System Settings → Appearance → Light/Dark updates the vibrancy within ~200ms, no app reload required.
- [ ] **Gate 3 — Main pane opaque:** Content area shows no see-through artefacts; only the sidebar is translucent.
- [ ] **Gate 4 — Linux solid fallback:** On Linux build (`make cargo-check` passing; `pnpm tauri build` on Linux), sidebar renders solid `var(--bg-canvas)` with no broken vibrancy artefacts.
- [ ] **Gate 5 — No console errors:** Webview devtools (Cmd+Opt+I on macOS) shows no JS/Tauri errors on startup.

## Renamability

The brand-as-config architecture (`brand.toml` → rebrand script) is untouched by this change. `brand.toml` was not modified. The renamability property of GAMBIT survives smoke-test (a) unchanged.

## Follow-ups for v0.1 (smoke-tests b–e)

- **(b) ⌘K command palette:** Keyboard-driven action surface, global hotkey wiring.
- **(c) File watcher:** `eidolons.yaml` / `eidolons.lock` drift detection via `tauri-plugin-fs` watch.
- **(d) Sync streaming:** Live output pane for `eidolons sync` / `upgrade` / `doctor` via Tauri shell plugin.
- **(e) Roster read:** Parse and display `roster/index.yaml` Eidolon list inside the Roster pane.
