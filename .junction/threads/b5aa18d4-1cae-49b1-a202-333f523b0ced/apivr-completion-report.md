---
thread_id: b5aa18d4-1cae-49b1-a202-333f523b0ced
from: apivr@3.1.2
to: idg@1.2.2
date: 2026-05-21
branch: feat/v0.1-integration
commits:
  - 98b8331  feat(upgrade): Rust IPC — check_upgrades + start_upgrade_apply + cancel_upgrade
  - 8d6be25  feat(upgrade): React useUpgrade hook + UpgradePane + commands wiring
---

## What was built

The Upgrade flow for GAMBIT v0.1 — the third user verb alongside Sync and Doctor.

**Backend (Rust)** — `src-tauri/src/upgrade.rs` (new, 280 lines):
- `check_upgrades`: async one-shot command that spawns `eidolons upgrade --check --json` in the project cwd, reads full stdout, parses it as `UpgradePlan` via serde, returns the struct to TS.
- `start_upgrade_apply`: async streaming command that spawns `eidolons upgrade --yes`, streams stdout/stderr line-by-line as `upgrade-stdout` / `upgrade-stderr` Tauri events, emits `upgrade-complete { exitCode }` on exit.
- `cancel_upgrade`: SIGKILL via `child.kill().await` (SIGINT is a v0.2 follow-up, same gap as sync/doctor).
- `UpgradeState`, `UpgradePlan`/`NexusBlock`/`UpgradeMember`/`UpgradeSummary` structs derived from the live fixture.
- Registered in `src-tauri/src/lib.rs` (new `pub mod upgrade`, `UpgradeState::new()` managed, three commands in `invoke_handler!`).

**Frontend (TypeScript + React)**:
- `src/lib/upgrade.types.ts` — interfaces mirroring the live fixture verbatim.
- `src/lib/useUpgrade.ts` — seven-state machine (idle / checking / reviewing / applying / done / failed / cancelled). `check()` one-shot invoke; `apply()` subscribes to three upgrade events; `cancel()` / `dismiss()` handle cleanup.
- `src/components/UpgradePane.tsx` — bottom-anchored panel with four visual modes: checking spinner, reviewing table (nexus row first + 6 member rows with status badges), applying log stream, terminal summary.
- `src/components/UpgradePane.css` — design-token CSS matching LogPane shape.
- `src/lib/commands.ts` — `onCheckUpgrades?` added to `CommandHandlers`; `action:upgrades` case wired.
- `src/App.tsx` — `useUpgrade()` mounted, handler injected, `<UpgradePane>` rendered when `state !== "idle"`.
- `src/components/MainPane.tsx` + `src/routes/ProjectRoute.tsx` — `onCheckUpgrades` threaded through to an "Upgrade…" button in the Project route header.

**Tests**:
- `tests/parsers/eidolons-upgrade-check.fixture.json` — live fixture copied verbatim.
- `tests/unit/parseUpgradeCheck.test.ts` — 15 vitest assertions covering shape, field values, member names, idempotency.

## Validation steps for host

1. Open GAMBIT on a project with `eidolons.yaml`.
2. Press ⌘K → type "upgrades" → Enter — the UpgradePane appears with spinner "Checking for upgrades…".
3. Plan-review table renders: nexus row (up-to-date) + 6 member rows with amber "upgrade available" badges.
4. Click **Apply all** — pane transitions to applying mode, log lines stream in.
5. On exit: exit badge appears (`exit 0` / `exit 1`), Close button dismisses the pane.
6. Alternatively: "Upgrade…" button in ProjectRoute header triggers the same check flow.

## Open questions

1. **Per-member selection (v0.2):** The table renders all members but Apply is all-or-nothing. A checkbox column + filtered `--members atlas,spectra` CLI flag is the natural next step. Blocked by `eidolons upgrade` CLI not yet supporting `--members`.
2. **`eidolons upgrade self` (nexus self-upgrade):** The nexus row is shown in the plan table but Apply currently only upgrades members. Should "Apply all" include nexus when `nexus_upgrade_available: true`? Left as v0.2 follow-up since the CLI's self-upgrade path needs separate investigation.

Hand-off to IDG to chronicle the Upgrade flow alongside Sync + Doctor.
