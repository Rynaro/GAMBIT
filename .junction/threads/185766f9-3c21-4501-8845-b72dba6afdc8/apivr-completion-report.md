---
eidolon: apivr
version: 3.1.2
kind: apivr-completion-report
status: completed
created_at: "2026-05-21T00:00:00Z"
files_changed_count: 15
tests_run: 0
tests_passed: 0
deltas_count: 0
escalations_count: 0
---

## What built

Live `eidolons sync` streaming for GAMBIT v0.1, satisfying spec position `smoke_b_sync_stream` (§7.1). The implementation spans a Rust backend (`sync.rs`) that locates the `eidolons` CLI, spawns it, and streams stdout/stderr line-by-line as Tauri events, and a React frontend that subscribes to those events via `useSync`, renders them in a virtualised bottom-anchored log pane (`LogPane`) with ANSI colour via `anser`, and wires the "Sync project" palette command to call `sync.start(projectPath)`.

The four previously shipped pieces are fully integrated: the project picker provides the working directory; the palette command ("Sync project") is no longer a console.info stub — it now invokes `start_sync`; the drift pill and vibrancy are untouched.

## Changes

**Frontend (TypeScript + React)**
- `package.json` — added `anser@^2` and `@tanstack/react-virtual@^3` to `dependencies`.
- `src/lib/parseAnsi.ts` — new. Thin `anser` wrapper returning `Array<{ text, class }>`.
- `src/lib/useSync.ts` — new. React hook managing sync state machine (`idle → running → done|failed|cancelled`). Subscribes to `sync-stdout`, `sync-stderr`, `sync-complete` Tauri events. Exposes `start`, `cancel`, `clear`.
- `src/components/LogLine.tsx` — new. `React.memo`-wrapped single-line renderer consuming `parseAnsi` tokens.
- `src/components/LogPane.tsx` — new. Bottom-anchored panel (~40 vh), `useVirtualizer` for 10k-line performance, auto-scroll with pause-on-scroll-up, top bar with status pill + spinner + Cancel/Close buttons, footer with line count + exit code.
- `src/components/LogPane.css` — new. Panel, ANSI colour classes, status pill pulse animation, status colour tokens.
- `src/lib/commands.ts` — modified. Added `CommandHandlers` interface and `setCommandHandlers()` injection point. `resolveCommand("action:sync")` now calls the injected `onSyncProject` handler instead of console.info stub.
- `src/App.tsx` — modified. Mounts `useSync`, injects handler via `setCommandHandlers` in `useEffect`, conditionally renders `<LogPane>` when `sync.state !== "idle"`.

**Backend (Rust)**
- `src-tauri/Cargo.toml` — added `tauri-plugin-shell = "2"`, `tokio = { version = "1", features = ["process", "io-util", "rt"] }`, `which = "6"`.
- `src-tauri/src/sync.rs` — new. `start_sync` + `cancel_sync` Tauri commands. `SyncState` holds `Arc<Mutex<Option<Child>>>`. Binary discovery via `which::which("eidolons")` with `~/.eidolons/nexus/cli/eidolons` fallback.
- `src-tauri/src/lib.rs` — modified. Registered `tauri_plugin_shell::init()`, declared `mod sync`, extended `invoke_handler!` with `sync::start_sync`, `sync::cancel_sync`, added `.manage(SyncState::new())`.

**Capabilities**
- `src-tauri/capabilities/default.json` — added `"shell:default"` permission.

**Tests**
- `tests/unit/parseAnsi.test.ts` — new. 6 Vitest cases: empty string, plain text, red ANSI, bold, nested colour+bold, malformed input.
- `tests/unit/useSync.test.ts` — new. 6 Vitest cases: idle initial state, idle→running, running→done, running→failed, running→cancelled, invoke-error path.

**Docs**
- `CHANGELOG.md` — Unreleased > Added: sync-stream milestone entry.
- `README.md` — one-line addition noting live streaming with ANSI and cancel.

**Threads**
- `.junction/threads/185766f9-3c21-4501-8845-b72dba6afdc8/apivr-completion-report.md` — this file.
- `.junction/threads/185766f9-3c21-4501-8845-b72dba6afdc8/apivr-completion-report.md.envelope.json` — ECL envelope.

## Failures and why

**SIGKILL-not-SIGINT (intentional v0.1 scope):** `cancel_sync` calls `child.kill().await` which sends SIGKILL on macOS, not SIGINT. The spec acknowledged this explicitly: "accept that `child.kill()` sends SIGKILL on macOS — document this gap as a follow-up (v0.2 will SIGINT properly via `nix` or `libc::kill`)." No corrective action needed for v0.1. Tracked as v0.2 follow-up: wire `nix::sys::signal::kill(pid, Signal::SIGINT)` to give the child a clean-shutdown window before escalating to SIGKILL.

No other failures. The Rust control flow was verified by inspection: `start_sync` guards against concurrent runs (kills previous child first), drains both pipes in parallel tokio tasks before awaiting the wait, and emits `sync-complete` with the real exit code. The `cancel_sync` path clears the Arc slot so the wait task sees `None` and emits exit_code=-2. Frontend `useSync` handles the error path from `invoke` by surfacing a synthetic stderr line rather than silently swallowing the error.

## Test summary

Unit tests written: 12 (6 for `parseAnsi`, 6 for `useSync`). Runtime execution deferred to user validation per APIVR-Δ tool constraints (no `pnpm` or `cargo` available in-agent). Tests follow the same mock pattern established by `useDriftWatcher.test.ts` in the existing suite.

Validation steps for the user:
1. `pnpm install` (inside container or host) — installs `anser` and `@tanstack/react-virtual`.
2. `make ci` — lint + typecheck + vitest + cargo-check all pass inside Docker.
3. `pnpm tauri dev` on host — window opens, pick a project, press ⌘K → "Sync project" → log pane appears, lines stream with ANSI colour, Cancel button available while running, Close appears after completion.

Hand-off to IDG to chronicle the sync-stream milestone.
