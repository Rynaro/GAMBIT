---
thread_id: f9b16f50-bc88-436f-b7ba-8b0f0643af4a
eidolon: apivr
version: 3.1.2
cycle: A→P→I→V→Δ
branch: feat/v0.1-doctor
commits:
  - sha: 729924b
    message: "feat(doctor): tauri shell-plugin spawning + Rust doctor.rs (start/cancel)"
  - sha: e188e9a
    message: "feat(doctor): React DoctorDashboard + useDoctor + parseDoctorStderr + DoctorRoute"
date: 2026-05-21
status: complete
---

## Anchor

Structural template: `src-tauri/src/sync.rs` (Rust IPC pattern) and `src/lib/useSync.ts` + `src/components/LogPane.tsx` (React streaming hook pattern). Both mirrored exactly — same `Arc<Mutex<Option<Child>>>` state shape, same three-event IPC contract, same `useRef<UnlistenFn[]>` teardown pattern.

Parser anchored on the actual `cli/src/doctor.sh` implementation: glyph anchors `✓`/`✗`/`·` at end of `[N/M] name glyph` lines; indented `→` continuation lines as message body; ANSI stripping via regex before matching. Nine checks: manifest+lock, installed members, host wiring, dispatch freshness, release integrity, cache hygiene, MCP servers, registry reachability, pending upgrades.

## Implementation

**Rust layer (`src-tauri/src/`):**
- `doctor.rs` (new) — `DoctorState { child: Arc<Mutex<Option<Child>>> }`, `start_doctor` spawns `eidolons doctor` in `project_path` cwd, pipes stdout/stderr line-by-line as `doctor-stdout`/`doctor-stderr` events, emits `doctor-complete { exit_code }`. `cancel_doctor` sends SIGKILL. V0.1 known gap (SIGKILL not SIGINT) documented; v0.2 follow-up tracked.
- `lib.rs` (modified) — `mod doctor;`, `DoctorState::new()` registered via `.manage()`, `doctor::start_doctor` + `doctor::cancel_doctor` added to `invoke_handler!`.

**Parser (`src/lib/`):**
- `parseDoctorStderr.ts` (new) — pure function, strips ANSI, matches `[N/M] name glyph` via regex, accumulates `→`-prefixed detail lines as `message`, idempotent, no side effects.
- `useDoctor.ts` (new) — state machine `idle/running/done/failed/cancelled`, incremental re-parse on every `doctor-stderr` line, `start(projectPath)` / `cancel()` / `clear()` surface.

**React layer (`src/`):**
- `components/DoctorDashboard.tsx` (new) — check grid, `CheckRow` sub-component with Details toggle, auto-expand on first failed check at `state === "done"`, raw stderr drawer.
- `components/DoctorDashboard.css` (new) — status pill colours using `--status-ok/warn/error` design tokens, `--motion-entry`/`--duration-panel` transitions.
- `routes/DoctorRoute.tsx` (new) — header with Run/Cancel button + last-run timestamp + exit code; three idle states (no project, no run yet, running/done); overrides parallel-branch stub.
- `lib/commands.ts` (modified) — `onRunDoctor?: () => void` added to `CommandHandlers` as optional field (backward-compatible with existing App.tsx callers); `action:doctor` wired.

**Tests (`tests/`):**
- `tests/parsers/doctor.fixture.txt` (new) — 9-check synthetic fixture with one pass, one fail (check 5: host wiring), two warns (check 6: dispatch freshness, check 9: pending upgrades), remaining passes.
- `tests/unit/parseDoctorStderr.test.ts` (new) — 10 vitest cases: empty, whitespace, single pass/warn/fail, 9-check round-trip, trailing whitespace tolerance, idempotency, ANSI stripping, all-three-statuses.

## Verify

- `cargo check` (Rust): exit 0 — no compilation errors.
- `pnpm test -- run tests/unit/parseDoctorStderr.test.ts`: 10/10 pass.
- `pnpm tsc --noEmit`: owned files clean; pre-existing errors in `parseAnsi.ts` and `vite.config.ts` (not owned by this branch) unchanged.
- Pre-existing test failures confirmed pre-existing: `parseAnsi`, `useSync`, `commands.test.ts (action:sync)` — all failures existed before this branch's first commit.

## Delta / Reflection

Divergence from spec: `DoctorRoute.tsx` reads `projectPath` from `getProjectPath()` (localStorage helper) rather than a `useProjectStore()` hook, because `projectStore.ts` exposes imperative functions, not a React hook. The `useEffect` re-reads on mount to stay fresh. This is more explicit than a hook but semantically equivalent for v0.1.

`onRunDoctor` in `CommandHandlers` made optional (`?`) to avoid a TS break in `App.tsx` (owned by the sibling `feat/v0.1-routes` branch). Callers already in `App.tsx` pass only `{ onSyncProject }` — making the field required would break the parallel branch on merge.

Open questions for IDG chronicle:
1. The `useSync` / `parseAnsi` test failures are pre-existing — worth a note that these tests need a Tauri mock setup (not provided in v0.1 test environment) before they can pass.
2. The `DoctorRoute.tsx` uses inline styles rather than CSS classes for the header and empty-state containers — acceptable for v0.1; a v0.2 pass should extract to a `DoctorRoute.css` module for consistency with `LogPane.css`.

Hand-off to IDG to chronicle the Doctor dashboard alongside the parallel routes branch.
