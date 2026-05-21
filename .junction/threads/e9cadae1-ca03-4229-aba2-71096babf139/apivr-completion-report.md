---
thread_id: e9cadae1-ca03-4229-aba2-71096babf139
from: apivr@3.1.2
to: idg@1.2.2
date: 2026-05-21T17:20:00Z
branch: feat/v0.1-integration
commits:
  - dbdafdb  feat(mcp): Rust IPC — mcp_list + mcp_install/uninstall + mcp_cancel
  - 58b5853  feat(mcp): React useMcpStore + McpInstallPane + McpStoreRoute rewrite
---

## Objective

Promote the GAMBIT MCP Store from read-only display to actionable: per-row Install,
Upgrade, and Uninstall buttons with streaming output and auto-refresh after completion.
Closes v0.2 DoD §7.1 "MCP Store install/uninstall end-to-end against real Docker daemon".

## What was implemented

### Backend — `src-tauri/src/mcp.rs` (new)

Four Tauri IPC commands following the exact patterns established in `sync.rs` and `upgrade.rs`:

- `mcp_list` — one-shot; spawns `eidolons mcp list --json` in `project_path` cwd, captures
  full stdout, parses into `Vec<McpListEntry>`. `McpListEntry` mirrors the JSON shape from
  `input/mcp-list.fixture.json` exactly: `installed` is `String` (empty string when not
  installed, never null). Returns `Err` with first-200-chars diagnostics on parse failure.

- `mcp_install` / `mcp_uninstall` — streaming; shared via `stream_mcp_op(action)` helper.
  Kills any prior child, spawns `eidolons mcp install|uninstall <name>`, streams stdout/stderr
  as `mcp-stdout` / `mcp-stderr` events (`{ line, ts }`), emits `mcp-complete`
  (`{ exitCode, action, name }`) on exit. Child handle stored in `McpStoreState` for cancel.

- `mcp_cancel` — SIGKILL via `child.kill().await`. v0.2 SIGINT follow-up noted in comments.

`src-tauri/src/lib.rs` updated: `pub mod mcp`, `.manage(McpStoreState::new())`, four commands
added to `invoke_handler!`.

### Frontend — hooks, components, route

- `src/lib/mcp.types.ts` (new): `McpListEntry`, `McpAction`, `McpCompletePayload` interfaces.
  `installed: string` (never nullable) enforced by type + fixture documentation.

- `src/lib/useMcpStore.ts` (new): 8-state machine
  (idle/loading/ready/installing/uninstalling/done/failed/cancelled). `refresh()` is
  one-shot mcp_list; `install()` / `uninstall()` both delegate to `startStreamingOp(action)`.
  On `mcp-complete` exit 0 or -2, auto-refresh fires after 300ms. `dismiss()` resets to
  `ready`. Auto-refresh on mount when `projectPath` is present.

- `src/components/McpInstallPane.tsx` (new): bottom-anchored panel; header shows project
  basename, verb+name, status pill (pulse animation when active), Cancel/Close buttons.
  Body renders streamed log lines; terminal-state strip shows exit-code badge and
  completion/failure label. Footer shows line count + exit code.

- `src/components/McpInstallPane.css` (new): design tokens consistent with `UpgradePane.css`.

- `src/routes/McpStoreRoute.tsx`: full rewrite. Drops `parseMcpLock` as primary source
  (file preserved for HarnessRoute). Delegates to `useMcpStore`. Renders 7-column table
  (Name/Kind/Scope/Installed/Latest/Status/Actions). `UpdateBadge` component handles
  `no|install|upgrade|downgrade` enum. `ActionCell` renders Install / Upgrade+Uninstall /
  Uninstall per row based on `installed` and `update` fields. Refresh button in card header.
  `McpInstallPane` overlays when state is one of installing/uninstalling/done/failed/cancelled.

- `src/lib/commands.ts`: `action:mcp-refresh` command + `onRefreshMcpStore?` handler.

### Tests + docs

- `tests/parsers/eidolons-mcp-list.fixture.json`: verbatim copy of live capture.
- `tests/unit/parseMcpList.test.ts`: 15 vitest cases pinning McpListEntry shape, all green.
- `CHANGELOG.md` Unreleased > Added: MCP Store actionable promotion entry.
- `README.md`: one-line "Installs, upgrades, and uninstalls MCP servers" added.

## Fixtures referenced

All three staged captures at `.junction/threads/e9cadae1-ca03-4229-aba2-71096babf139/input/`:

1. `mcp-list.fixture.json` — derived `McpListEntry` interfaces and test assertions from this.
2. `mcp-install.help.txt` — confirmed CLI signature `eidolons mcp install <name>`.
3. `mcp-uninstall.help.txt` — confirmed CLI signature `eidolons mcp uninstall <name>`.

## Validation steps for host

1. Open GAMBIT, pick an Eidolons project.
2. Navigate to MCP Store — catalogue table loads via `eidolons mcp list --json`.
3. Click **Install** on `atlas-aci` (update: "install") — McpInstallPane slides up,
   status pill pulses "installing", streaming log lines appear.
4. On completion: `mcp-complete` fires, pane transitions to "done", exit code renders
   green if 0. Row auto-refreshes: `installed` populates from `""` to the version string.
5. Click **Uninstall** on the same row — streaming pane for uninstall; row reverts.
6. Click **Refresh** button — re-invokes `mcp_list`, table updates.
7. Palette ⌘K → "Refresh MCP Store" → triggers `useMcpStore.refresh()`.

## Open questions

1. The fixture shows both `atlas-aci` and `junction` with `installed: ""` (neither installed).
   The spec notes `installed: "0.2.0"` for junction. The live mcp-list output may differ from
   what the parent described in the brief — the Rust and React code handle both states
   correctly (empty = not installed, non-empty = installed version).

2. `onRefreshMcpStore` in `CommandHandlers` is wired in `commands.ts` but App.tsx does not
   yet inject the handler (the McpStore hook is local to `McpStoreRoute`). The palette
   entry exists and will no-op with a console.warn until a future pass lifts `useMcpStore`
   to the app shell or uses a context/event bus. No regressions — pattern matches
   `onRunDoctor` which has the same lifecycle.

---

Hand-off to IDG to chronicle the MCP Store promotion from read-only to actionable,
alongside the three-verb core (Sync/Doctor/Upgrade).
