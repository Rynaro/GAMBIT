---
thread_id: "250a5f7e-c00b-47fb-9581-a749aa35ab18"
from: "apivr@3.1.2"
to: "idg@1.2.2"
wave: "v0.2-polish"
date: "2026-05-21"
---

## Implemented

### Piece 1 — Sonner toast integration

`sonner@^1` added to `package.json` dependencies.

`<Toaster>` mounted in `AppShell` (inside `src/App.tsx`) at position `bottom-right`, `theme="system"`, `richColors`, `closeButton`. Default `duration: 2500ms`; errors set `duration: Infinity` per spec §3.5.

Toast wiring per hook:

- **`useSync`** — `sync-complete` handler emits `toast.success` (exit 0) or `toast.error` (non-zero). The `cancel()` callback emits `toast.info("Sync cancelled")` on the optimistic cancellation path (no `-2` sentinel exists on this hook — cancel is UI-driven only).
- **`useDoctor`** — `doctor-complete` handler checks `exitCode === -2` for cancelled (`toast.info`); otherwise derives check counts from the final parsed `DoctorCheck[]` array: fail → `toast.error(Infinity)`, warn → `toast.info`, all-pass → `toast.success`.
- **`useUpgrade`** — Both `apply` and `nexusUpgrade` complete handlers emit toasts. Label uses local verb string (`"Member upgrade"` / `"Nexus upgrade"`) rather than reading `lastAction` state (avoids closure staleness). Cancelled (`-2`) → `toast.info`, success → `toast.success`, failure → `toast.error(Infinity)`.
- **`useMcpStore`** — `mcp-complete` handler reads `ev.payload.action` and `ev.payload.name` directly from the typed `McpCompletePayload`. Cancelled → `toast.info`, success → `toast.success`, failure → `toast.error(Infinity)`.
- **`useDriftWatcher`** — `drift-detected` listener uses a state-setter callback to detect first `watching → drift` transition; emits `toast.info("Drift detected", { description: "${basename} · eidolons.lock changed" })` only on the transition edge, suppressing repeated toasts within the 5 s TTL window.

### Piece 2 — Light-mode CSS token audit

**New tokens added to `global.css`:**

- Shadow/overlay tokens: `--palette-backdrop-bg`, `--shadow-overlay-60`, `--shadow-overlay-40`, `--shadow-pane-lift` (dark-mode default values; light-mode block overrides all four to reduced-opacity variants).
- Light-mode block expanded to cover: `--accent-primary` (softer `#7c4fd4`), `--accent-gradient`, `--accent-secondary-amber` (darker `#c07a20` for legibility on white), `--status-ok/warn/error` (all darkened for contrast on light surfaces), plus all four new overlay tokens.

**Component fixes:**

- `CommandPalette.css` — backdrop `rgba(15,13,20,0.65)` → `var(--palette-backdrop-bg)`; box-shadow `rgba(0,0,0,0.6/0.4)` → `var(--shadow-overlay-60/40)`.
- `UpgradePane.css` — `box-shadow rgb(0 0 0 / 0.45)` → `var(--shadow-pane-lift)`; `.upgrade-pane-btn--primary` `#fff` fallback → `var(--bg-canvas)` (matches the pattern in `global.css .route-verb-btn.primary`); `var(--accent)` (undefined token) corrected to `var(--accent-primary)`.
- `LogPane.css` — `box-shadow rgb(0 0 0 / 0.45)` → `var(--shadow-pane-lift)`; ANSI color classes retained with a **DESIGN EXCEPTION** block-comment (ECMA-48 terminal palette colors are a display contract, not a theme decision).
- `McpInstallPane.css` — `box-shadow rgb(0 0 0 / 0.45)` → `var(--shadow-pane-lift)`.

**Result:** `grep '#[0-9a-fA-F]{3,8}' src/components/` returns zero non-ANSI matches.

## Validation steps for host

1. Run `eidolons sync` on a real project → toast appears bottom-right: "Sync complete · <project> · exit 0" (or error if CLI missing).
2. Cancel a running sync → "Sync cancelled" info toast appears.
3. Run `eidolons upgrade` → check → apply → "Member upgrade complete" success toast; or "Nexus upgrade complete" for the nexus button.
4. Run doctor → if checks pass: "Doctor passed all N checks"; if warnings: info toast; if failures: sticky error toast.
5. Install/uninstall an MCP → "Installed <name>" / "Uninstalled <name>" success toasts.
6. Toggle System Settings → Appearance → Light: sidebar bg changes to `#f4efe8`, route panes to `#ffffff`/`#fbf7f2`, accent purple darkens to `#7c4fd4`, status colors darken for contrast. Toggle back to Dark: full dark-mode palette restores.
7. Open the Command Palette in light mode: backdrop uses lighter `rgba(60,50,80,0.45)` overlay; sheet shadow is visibly softer.

## Open questions

1. **Drift toast noisiness** — the 5 s TTL auto-clear means repeated lock changes within a short window produce only one toast per transition edge. If users find this too quiet (or too noisy with rapid saves), the TTL or the toast suppression threshold can be tuned independently.
2. **`useSync` cancel double-fire** — if Rust does send a `sync-complete` event after `cancel_sync` (with `exitCode: 1` or similar), the `sync-complete` handler will fire an error toast after the "Sync cancelled" info toast already appeared. The existing pattern in the hook already handles this gracefully for state, but the toast duplication may be visible. If this surfaces, add a `cancelledRef` flag to suppress the complete-handler toast when cancel was called.

---

Hand-off to IDG to chronicle the v0.2 polish wave.
