# Diagnose: GAMBIT main pane blanks after picking a project folder

## Symptom

Confirmed visually on `feat/v0.1-integration` HEAD `c309cbe` (Darwin 25.3.0). Sequence:

1. `pnpm tauri dev` — window opens. Sidebar + welcome state render correctly.
2. Routes navigate fine (Roster, Doctor, MCP Store, etc.) with no project picked — empty-state copy renders in each pane.
3. User clicks "Pick project…" in the sidebar footer.
4. macOS folder dialog appears; user selects any folder (e.g. `/Users/henrique/workspace/oss/agents/eidolons`).
5. **Main content area goes blank** — sidebar still shows, drift pill appears (so `useDriftWatcher` is alive), but `<MainPane />` / the active route's pane shows nothing.

App does not crash to a process level — sidebar buttons still respond visually. The blank is contained to the main pane / route region.

## Repo + branch

- Repo: `Rynaro/GAMBIT`
- Local path: `/Users/henrique/workspace/oss/agents/gambit/`
- Branch: `feat/v0.1-integration`
- Head: `c309cbe` (tokio macros fix after a parallel routes+doctor merge)

## Recent changes (this session, freshest first)

- `c309cbe` — tokio macros feature added (compile fix).
- `fba8269` — Cargo.lock alignment.
- `3f8f28b` — merge of `feat/v0.1-doctor` into integration. Brought DoctorRoute real content + doctor.rs IPC + parseDoctorStderr + commands `onRunDoctor` field.
- `a7b4b5a` — merge of `feat/v0.1-routes` into integration. Brought RouteContext/useRoute + 6 real route components + Doctor stub + Sidebar navigation wiring + palette Navigate handlers. Added `yaml@^2` dep.

## Suspect surfaces (ranked by likelihood)

H1. **A route component crashes synchronously when `projectPath` becomes non-null.** Most likely a `parseYAML(eidolons.yaml content)` call on a file that doesn't exist (the user picked `agents/eidolons` which has `eidolons.yaml`, but they may have picked something else). Without an Error Boundary, a thrown error in a child component blanks the entire subtree.

H2. **Two `projectPath` stores diverge** (flagged by routes Agent A as an open question): `App.tsx` has one for `useDriftWatcher`; `MainPane.tsx` has another for the active route. When the user picks a project, only `App.tsx`'s state updates; `MainPane.tsx`'s state remains `null`. Routes that conditionally render based on `projectPath` then transition from null → null → suddenly something else, possibly triggering an effect cascade that blanks.

H3. **fs plugin capability scope rejects arbitrary project paths.** Tauri 2 `tauri-plugin-fs` requires explicit allowlist scopes for paths outside the app's data dir. If a route's `readTextFile('/Users/.../eidolons.yaml')` is denied, it throws — and without a try/catch in render, the route component crashes.

H4. **`yaml@^2` dep declared but not installed.** If pnpm didn't actually resolve the package (e.g. lockfile lagged the package.json on the routes branch), an import error blanks the bundle for any route that imports `yaml`.

H5. **`useEffect` dependency loop** — a route component re-renders infinitely when `projectPath` changes, and React 18's strict mode kicks in and silently bails to a blank fallback.

H6. **DriftPill or other parent absorbs the layout** — `useDriftWatcher` starting on the first project pick might add a wrapper that overflows or sets `display: none` on its sibling. Unlikely but cheap to check.

## Key files to inspect

- `src/App.tsx` — orchestrator: projectPath state, onPickProject handler, route provider, watcher hook, sync hook.
- `src/components/MainPane.tsx` — second projectPath state (per Agent A's question).
- `src/routes/RouteRenderer` (or wherever the active route mounts).
- All 7 `src/routes/*Route.tsx` files — every one of them is a candidate crash site.
- `src/lib/projectStore.ts` — localStorage IO.
- `src-tauri/capabilities/default.json` — fs scope might be too narrow.
- `package.json` + `pnpm-lock.yaml` — confirm `yaml@^2` is installed not just declared.

## Authority

Read-only. Use `git log`, `git show`, `rg`. No write tool. Emit a root-cause-report.md (return verbatim in your reply between `===REPORT-START===` / `===REPORT-END===` sentinels) with the four contract-required H2 sections — `reproduction`, `hypotheses`, `interventions`, `blame_target`. Evidence anchor required (cite file:line for every verdict).

Top-priority intervention preference: a global **Error Boundary** wrapping the route renderer would prevent any single route crash from blanking the whole pane, making this kind of bug surface visibly in the future regardless of root cause. Recommend it as P0 alongside the actual fix.
