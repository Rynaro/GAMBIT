---
thread_id: b6b9efae-c1d3-4bd6-b355-692bf76d716a
from: apivr@3.1.2
to: idg@1.2.2
performative: PROPOSE
date: 2026-05-21T00:00:00Z
---

## Summary

Implemented the GAMBIT nexus self-upgrade feature on branch `feat/v0.2-nexus-upgrade` (commit `371ce10`). The Upgrade pane now exposes an "Upgrade nexus" button when `plan.nexus.status === "upgrade available"`, wired to `eidolons upgrade --system --yes` via a new Rust command streamed through the existing event pair.

## Delta

**Files changed (commit `371ce10`):**

- `src-tauri/src/upgrade.rs` — Added `start_nexus_upgrade` command. Mirrors `start_upgrade_apply` exactly; only the spawn args differ (`.args(["upgrade", "--system", "--yes"])`). Uses the same `UpgradeState` mutex and emits the same `upgrade-stdout`, `upgrade-stderr`, `upgrade-complete` events so the React hook's existing listener registration is reused without modification.
- `src-tauri/src/lib.rs` — Registered `upgrade::start_nexus_upgrade` in `generate_handler![...]` (single-line addition).
- `src/lib/useUpgrade.ts` — Added `nexusUpgrade(projectPath)` action that transitions to `applying`, attaches the same three event listeners, and invokes `start_nexus_upgrade`. Added `lastAction: "members" | "nexus" | null` field to the state and the `UseUpgradeResult` interface. The `apply` function sets `lastAction("members")`; `nexusUpgrade` sets `lastAction("nexus")`; `dismiss` resets it to `null`.
- `src/components/UpgradePane.tsx` — In the reviewing-state footer: when `plan.nexus.status === "upgrade available"`, renders an "Upgrade nexus (cur → latest)" button wired to `upgrade.nexusUpgrade(projectPath)`, disabled when not in `reviewing` state. When `plan.nexus.status === "up-to-date"`, renders a "Nexus up-to-date" pill (optional polish included).
- `src/components/UpgradePane.css` — Added `.upgrade-action-btn`, `.upgrade-nexus-btn` (muted warn secondary style using existing CSS tokens), and `.upgrade-nexus-uptodate-pill` styles.
- `CHANGELOG.md` — Added entry under Unreleased > Added documenting the nexus self-upgrade button and noting that per-member selection is deferred to v1.0 pending upstream `--members` CLI flag.

## Verification gates

1. `cargo check` from `src-tauri/` — no type errors in Rust (new function signature matches existing pattern exactly).
2. TypeScript: `UseUpgradeResult` interface exports `nexusUpgrade` and `lastAction`; `UpgradePane.tsx` destructures `nexusUpgrade` from `upgrade` prop — no type gaps.
3. Manual smoke: open Upgrade pane in reviewing state with a fixture where `plan.nexus.status === "upgrade available"` — "Upgrade nexus (v1.2.0 → v1.3.0)" button appears between Dismiss and Apply all; click streams output via the same log view as Apply all.
4. When `plan.nexus.status === "up-to-date"` the button is absent and the green pill appears instead.
5. Per-member selection is intentionally absent — documented in CHANGELOG as CLI-blocked.

## Reflection

The `apply` event-listener registration block is duplicated verbatim inside `nexusUpgrade` rather than extracted into a shared helper. This is intentional for v0.2 (matching the spec's "simplest reuse" guidance) but is an obvious refactor target for a follow-up. The `lastAction` field is available for callers (e.g., a future log-pane header that says "Upgrading nexus…" vs "Upgrading members…") but UpgradePane itself does not yet consume it — that's a cosmetic follow-up.

Hand-off to IDG to chronicle alongside parallel siblings (hooks-lift + syntax-highlight).
