# Root-cause report — GAMBIT smoke-test (a) vibrancy not translucent

## reproduction

Verified symptom: the user ran `pnpm tauri dev` on `feat/v0.1-integration` (Darwin 25.3.0); GAMBIT opens with the sidebar painted as a solid dark surface (`var(--sidebar-bg)` or `var(--bg-canvas)`-tinted), not as an NSVisualEffectView `.sidebar` material. No JS console error, no Rust panic, `cargo check` is green in ~5 s, the main pane renders the welcome state correctly. The same defect existed on the parent branch `feat/v0.1-smoke-a-vibrancy` — it was never demonstrated working — so this is **not a regression introduced by the integration merge** (`git show 93e18fd`); it is an as-built defect inherited from smoke-test (a).

Reproducer is sound. The pipeline that should produce vibrancy:

1. `src-tauri/tauri.conf.json:23` declares `"transparent": true`.
2. `src-tauri/src/lib.rs:19-27` calls `apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)` inside the macOS `cfg`.
3. `src/styles/global.css:107`, `:118`, `:136` keep `html`, `body`, `#root`, `.sidebar` `background: transparent`.

The chain looks complete, but Tauri 2 requires an explicit Cargo feature to honour the JSON `transparent` flag on macOS, which is missing.

## hypotheses

**H1 — Vibrancy IS applied; macOS dark mode just renders it subtly. Verdict: rejected, high confidence.** If vibrancy were applied to an opaque NSWindow we would still see *no* translucency at all, which matches the user's report. But the corollary — "drag a colourful window behind and the sidebar picks up colour" — is the canonical empirical test in `diagnose-prompt.md:38`, and the user explicitly states the sidebar "appears as a solid dark surface", not a subtle but present material. H1 is the laziest explanation and the evidence contradicts it.

**H2 — Platform sniff runs after first paint (`src/App.tsx:14-16`). Verdict: rejected, high confidence.** `src/styles/global.css:144-149` only fills the sidebar with `var(--bg-canvas)` for `[data-platform="linux"]` and `[data-platform="windows"]`. On the first frame `[data-platform]` is undefined, so the only matching rule is `.sidebar { background: transparent; }` (`src/styles/global.css:136`). The transparency *is* set before paint; the late `useEffect` only adds an attribute that, on macOS, has no rule attached to it. H2 cannot explain an opaque sidebar. (It *is* a latent bug — if Linux/Windows ever runs this code path, the sidebar will flash transparent for one frame — but that is orthogonal to the macOS symptom.)

**H3 — `titleBarStyle: "Overlay"` interferes with `transparent: true` (`src-tauri/tauri.conf.json:23-24`). Verdict: inconclusive, low confidence.** The two flags can coexist on Tauri 2; the documented constraint is that `Overlay` requires `decorations: true`, which is satisfied (`src-tauri/tauri.conf.json:22`). Removing `Overlay` would not by itself enable transparency. Recommend leaving as-is until H4 is fixed; revisit only if vibrancy still misbehaves.

**H4 — `transparent: true` is a no-op without the `macos-private-api` Cargo feature on `tauri`. Verdict: confirmed, high confidence.** This is the root cause. `src-tauri/Cargo.toml:17` reads `tauri = { version = "2", features = [] }` — the features list is empty. Tauri 2 deliberately gates the call that performs `NSWindow.setOpaque(false)` / `NSWindow.setBackgroundColor(.clear)` behind the `macos-private-api` Cargo feature (because the underlying private API is App-Store-rejection-risky). Without that feature, the JSON `"transparent": true` flag is accepted by config validation and stored, but the runtime never disables NSWindow opacity. Result: the webview composites onto an opaque NSWindow; `apply_vibrancy` (`src-tauri/src/lib.rs:25`) attaches a real `NSVisualEffectView` to the window, but it sits *behind* an opaque webview surface, so the material is invisible. No error is raised (the plugin's `apply_vibrancy` returns `Ok(())` — it successfully attached an NSVisualEffectView), explaining the silent failure. Cargo.lock confirms `window-vibrancy 0.7.1` is the actually-resolved version (`src-tauri/Cargo.lock:4206-4209`), so the plugin itself is fine; the precondition is missing. This same defect was present on `feat/v0.1-smoke-a-vibrancy:src-tauri/Cargo.toml:12` — the original smoke-a brief never gated this.

**H5 — Opaque parent masks the sidebar (`src/styles/global.css`). Verdict: rejected, high confidence.** Walking the box model from `src/App.tsx:42` (`.app-shell`) down: `html`/`body`/`#root` are all `transparent` (`global.css:101-119`), `.app-shell` declares no background (`global.css:122-126` — only `display: flex; height: 100%; overflow: hidden`), and `.sidebar` is `background: transparent` (`global.css:136`). The header/nav/footer children inside Sidebar (`src/components/Sidebar.tsx:28-96`) have no background set on the `<aside>` or its containers — only the destination-button hover state (`global.css:204-214`) and the palette pill (`global.css:295`) carry backgrounds, and they are bounded children. The DOM hierarchy is clean. The opaque surface the user sees is the NSWindow itself, not a CSS layer.

**H6 — Was vibrancy ever working on smoke-a in isolation? Verdict: confirmed defective at source, high confidence.** Both `feat/v0.1-smoke-a-vibrancy:src-tauri/Cargo.toml:12` and the current integration `Cargo.toml:17` omit the `macos-private-api` feature. The merge commit `93e18fd` did not change `tauri`'s feature set. The post-merge `274b9e1` only renamed the crate from `tauri-plugin-window-vibrancy` to `window-vibrancy`. The defect is intrinsic to APIVR-Δ's smoke-a implementation; the integration branch only inherited it. **The Gate-1 acceptance checkbox in the smoke-a APIVR-Δ completion report (`.junction/threads/01jwgambitv01a0000000000smke/delta-report.md` line referencing "Gate 1 — macOS vibrancy: Sidebar shows translucent .sidebar material…") was never ticked**, confirming the feature was never validated by a human on macOS.

**H7 (added) — `setupPlatform()` uses `navigator.userAgent` instead of Tauri's runtime API (`src/lib/platform.ts:6-12`). Verdict: confirmed regression but cosmetic, med confidence.** The smoke-a branch's `platform.ts` used `@tauri-apps/api/os.platform()` (`git show feat/v0.1-smoke-a-vibrancy:src/lib/platform.ts`) with a userAgent fallback. The current implementation drops the Tauri API entirely. This works on macOS (the UA contains "mac os x") but is brittler and may misreport on edge cases (e.g. iPad-class WKWebView UAs). Not the cause of the symptom; flag for cleanup.

## interventions

### P0 — Enable `macos-private-api` on Tauri + declare it in config (must-apply, fixes symptom)

**File:** `src-tauri/Cargo.toml`, line 17.

```diff
-tauri = { version = "2", features = [] }
+tauri = { version = "2", features = ["macos-private-api"] }
```

**File:** `src-tauri/tauri.conf.json`, at the `app` object root.

`macOSPrivateApi` lives at the **`app` object root** in Tauri 2's schema, not inside the `windows[]` entry. Concretely the JSON should become:

```json
"app": {
  "macOSPrivateApi": true,
  "windows": [
    { ... existing entry ... }
  ]
}
```

Confidence: **high** that this combination resolves the symptom. Severity: config-only (two-line Cargo, one-key JSON). Both edits are required — the Cargo feature exposes the code path; the JSON key turns it on at runtime.

### P1 — Move `setupPlatform()` out of `useEffect` so it runs before first paint (recommended)

**File:** `src/App.tsx`, lines 1-16.

```diff
 import { useEffect, useState } from "react";
 ...
 import { setupPlatform } from "./lib/platform";
 ...
+
+// Stamp data-platform on <html> synchronously, before React's first render,
+// so platform-conditional CSS rules apply on the very first frame.
+setupPlatform();
+
 export function App() {
-  useEffect(() => {
-    setupPlatform();
-  }, []);
-
   const palette = useCommandPalette();
```

Or equivalently call it inside `src/main.tsx` before `createRoot(...).render(...)` (`src/main.tsx:10-14`). Either location runs synchronously at module evaluation, well before paint. Confidence: **high** that this eliminates the first-frame flash on Linux/Windows; **does not change** the macOS opaque-sidebar symptom. Severity: one file, three lines moved.

### P1 — Restore Tauri's first-party platform API as the primary detector (recommended)

**File:** `src/lib/platform.ts`, lines 1-19.

Replace the userAgent-only implementation with the smoke-a hybrid (Tauri primary + UA fallback), in the synchronous-friendly shape:

```ts
import type { Platform as TauriPlatform } from "@tauri-apps/plugin-os";
// or: import { platform } from "@tauri-apps/plugin-os";  // Tauri 2 path
```

Use the Tauri 2 OS plugin (`@tauri-apps/plugin-os.platform()`, which is synchronous in v2 and returns "macos" | "linux" | "windows" | "android" | "ios") and keep the UA branch as a catch for non-Tauri preview environments. Confidence: medium that this materially improves correctness; primarily a hygiene fix. Severity: one file, ~20 lines.

### P2 — Add a vibrancy smoke gate to APIVR-Δ's `make ci` (optional, prevents recurrence)

**File:** `Makefile` (target list) and (ideally) a new Rust integration test that asserts `app.get_webview_window("main").unwrap().is_visible()` and pokes the `macos-private-api` feature gate at compile time. Realistically the macOS visual is human-judged, so the more durable fix is to require the Gate-1 checkbox in `.junction/threads/<smoke-thread>/delta-report.md` to be **ticked by a human** before APIVR-Δ emits its INFORM envelope. Severity: process change, not code. Confidence: addresses recurrence, not the immediate bug.

### P2 — Reconsider `titleBarStyle: "Overlay"` after the P0 fix lands (optional)

**File:** `src-tauri/tauri.conf.json`, line 24. If, after enabling `macos-private-api`, the traffic-light region exhibits weird vibrancy stitching, fall back to `"titleBarStyle": "Transparent"` or remove the field (defaults to `"Visible"`). Confidence: low — currently inconclusive whether Overlay is involved. Defer until P0 visually verified.

## blame_target

The Tauri `macos-private-api` Cargo feature and matching `macOSPrivateApi: true` config flag are absent; APIVR-Δ shipped smoke-a without this precondition and the integration merge inherited the defect. Primary fix lives in `src-tauri/Cargo.toml:17` (feature flag) and `src-tauri/tauri.conf.json` (top-level `app.macOSPrivateApi`).
