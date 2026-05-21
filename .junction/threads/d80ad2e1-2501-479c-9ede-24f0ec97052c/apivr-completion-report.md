---
thread_id: d80ad2e1-2501-479c-9ede-24f0ec97052c
apivr_version: 3.1.2
task: hooks-lift-refactor
branch: feat/v0.2-hooks-lift
date: 2026-05-21T00:00:00Z
---

## Summary

Pure refactor: lifted `useDoctor` and `useMcpStore` from their route components up to the App shell (`AppShell` in `src/App.tsx`). Both hooks are now mounted at App level and their outputs threaded down via props through `MainPane` → `RouteRenderer` → `DoctorRoute` / `McpStoreRoute`. Palette handlers `action:doctor` and `action:mcp-refresh` are injected via `setCommandHandlers` in the existing `useEffect`, eliminating the "no handler injected yet" console warnings for those two actions.

## Delta

Files modified (6):

- `src/App.tsx` — imported `useDoctor` and `useMcpStore`; mounted both hooks; added `onRunDoctor` and `onRefreshMcpStore` to `setCommandHandlers` call; passed `doctor` and `mcpStore` props to `<MainPane>`.
- `src/components/MainPane.tsx` — imported `DoctorResult` and `UseMcpStoreResult` types; extended `RouteRendererProps` and `MainPaneProps` with `doctor: DoctorResult` and `mcpStore: UseMcpStoreResult`; threaded both props to `DoctorRoute` and `McpStoreRoute`.
- `src/routes/DoctorRoute.tsx` — replaced `useDoctor()` call with `doctor: DoctorResult` prop; removed hook import.
- `src/routes/McpStoreRoute.tsx` — replaced `useMcpStore(projectPath)` call with `mcpStore: UseMcpStoreResult` prop; removed hook import.
- `src/lib/commands.ts` — promoted `onRunDoctor` and `onRefreshMcpStore` from optional to required in `CommandHandlers`; added console.warn fallback defaults in the initial `handlers` object; removed defensive `if (handlers.onRunDoctor)` / `if (handlers.onRefreshMcpStore)` guards in `resolveCommand` (now direct calls).
- `CHANGELOG.md` — added entry under `## [Unreleased] > Changed`.

Hook implementations (`useDoctor.ts`, `useMcpStore.ts`) are untouched per constraint.

## Verification

No pnpm/cargo available per tool constraints. Host validation steps:

1. `pnpm typecheck` (or `tsc --noEmit`) — confirms prop types thread correctly end-to-end.
2. `pnpm test` — confirms `tests/unit/commands.test.ts` still passes (default handler shapes changed: `onRunDoctor` and `onRefreshMcpStore` now have console.warn bodies rather than `undefined`).
3. Manual smoke: open Doctor route, trigger `action:doctor` from palette — no console warning, doctor run starts; same for `action:mcp-refresh`.

## Open questions

None. `useDoctor()` takes no arguments (projectPath goes to `doctor.start(path)` at call time), so the lift is clean with no partial-application workaround needed. `useMcpStore(projectPath)` reactive on `projectPath` state — the App-level call stays reactive because it reads from the same `projectPath` state that is already in `AppShell`.

Hand-off to IDG to chronicle alongside parallel siblings (nexus-upgrade + syntax-highlight).
