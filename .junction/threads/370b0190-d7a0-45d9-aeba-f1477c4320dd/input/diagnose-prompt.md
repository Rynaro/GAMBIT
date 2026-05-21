# Diagnose: GAMBIT macOS sidebar not translucent (smoke-test a)

## Symptom

The user ran `pnpm tauri dev` on macOS (Darwin 25.3.0) on branch `feat/v0.1-integration`. The window opens cleanly — sidebar renders with the GAMBIT brand header, the destination list, the project picker + palette pill footer; main pane shows the welcome state. **But the sidebar does not look translucent.** It appears as a solid dark surface. The user expected NSVisualEffectView `.sidebar` material to pick up content behind the window and adapt to System Settings → Appearance Light↔Dark.

The window opened, so the plugin call did not panic. The compile passed (`cargo check` finished green in 5s). No console errors reported.

## Repo + branch

- Repo: `Rynaro/GAMBIT` (https://github.com/Rynaro/GAMBIT)
- Local path: `/Users/henrique/workspace/oss/agents/gambit/`
- Branch: `feat/v0.1-integration` (merges of smoke-a + smoke-b + smoke-c + a series of compile fixes)
- Head commit at time of report: latest on `feat/v0.1-integration`

## Suspect surfaces

These files are the implementation of smoke-test (a) vibrancy and the contracts smoke-test (b) palette + smoke-test (c) watcher impose on them:

- `src-tauri/src/lib.rs` — vibrancy plugin call. `#[cfg(target_os = "macos")] apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)` inside `setup()`. After the integration-branch fix the crate is `window-vibrancy` (not `tauri-plugin-window-vibrancy`).
- `src-tauri/tauri.conf.json` — window flags: `decorations: true`, `transparent: true`, `titleBarStyle: "Overlay"`. macOS bundle config exists.
- `src/styles/global.css` — `html`, `body`, `#root`, `.sidebar` all `background: transparent`. Platform-specific fallback rules `[data-platform="linux"] .sidebar` and `[data-platform="windows"] .sidebar` solidify to `var(--bg-canvas)`. Main pane and `.main-content-area` solid (`var(--bg-canvas)`).
- `src/lib/platform.ts` — synchronous userAgent sniff. `setupPlatform()` writes `document.documentElement.dataset.platform` to `"macos" | "linux" | "windows" | "unknown"`.
- `src/App.tsx` — calls `setupPlatform()` inside `useEffect` on mount (i.e. one render after the sidebar paints).
- `src/components/Sidebar.tsx` — pure presentational; no inline `style` overriding background.

## Possible root causes (hypotheses to verify)

1. **Vibrancy IS applied but macOS dark mode just renders the `.sidebar` material very subtly** — legit but not a bug. Switch to `NSVisualEffectMaterial::HudWindow` or `::Popover` if a more visible material is desired.
2. **Platform sniff runs after first paint** — for the first frame, `[data-platform]` is undefined; CSS specificity for `:root .sidebar { background: transparent }` should still win, but is there a hidden opaque parent? Verify the React DOM hierarchy.
3. **`titleBarStyle: "Overlay"` interferes with `transparent: true`** in Tauri 2 on macOS. Spec was inherited from APIVR-Δ smoke-a brief without independent verification.
4. **The window-vibrancy v0.7 API quietly no-ops** on the `WebviewWindow` reference Tauri 2 exposes. Some plugins want the raw `NSWindow`. Check the v0.7 plugin docs and the actual return of `apply_vibrancy()` — is the `expect()` masking a non-panic error?
5. **The vibrancy IS visible but the user did not test in light mode / against a colourful backdrop** — the material is by design subtle in dark mode against solid backgrounds.

## What "good" looks like

- Drag a colourful window behind GAMBIT — the sidebar picks up faint colour.
- Toggle System Settings → Appearance Light↔Dark — sidebar material visibly changes brightness.
- `<html>` element has `data-platform="macos"`.
- No console errors in the webview devtools.

## Authority

You are authorised to read the full repo, run `git log`, `git show`, `rg`. You are NOT authorised to modify the running app (no write tool). Emit a root-cause-report.md with the four required sections — `reproduction`, `hypotheses`, `interventions`, `blame_target` — and a sibling ECL v1.0 envelope addressed `vigil → PROPOSE → apivr` with `kind: root-cause-report`. APIVR-Δ will implement the patch.

Evidence anchor REQUIRED (cite file paths with line numbers for every hypothesis you reject or accept).
