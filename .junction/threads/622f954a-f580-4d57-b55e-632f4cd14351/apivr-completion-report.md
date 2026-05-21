---
thread_id: "622f954a-f580-4d57-b55e-632f4cd14351"
milestone: "Routes scaffolding"
from: "apivr@3.1.2"
to: "idg@1.2.2"
branch: "feat/v0.1-routes"
date: "2026-05-21"
---

## What built

Replaced the no-op destination stubs in GAMBIT v0.1 with a full client-side routing system and 7 route pane components.

**New infrastructure:**
- `src/lib/useRoute.ts` — `RouteId` union type + `useRoute` hook (localStorage key `gambit:activeRoute`, default `project`)
- `src/lib/RouteContext.tsx` — `RouteProvider` + `useRouteContext` consumer; mounts at `<App>` root via the outer-shell / inner-shell split
- `src/routes/index.ts` — `ROUTES` registry (id / label / subtitle) shared by Sidebar, RouteRenderer, and Navigate commands
- `src/components/RouteHeader.tsx` + `RouteHeader.css` — shared chrome: 24px semibold title, 13px muted subtitle, flush-right verb buttons

**Route components (src/routes/):**
- `RosterRoute.tsx` — reads `~/.eidolons/nexus/roster/index.yaml` via `BaseDirectory.Home`; inline line-regex YAML parser for member entries; member table with status/version/repo columns; friendly offline empty state
- `ProjectRoute.tsx` — reads `eidolons.yaml` + `eidolons.lock` via `yaml@^2`; declared-vs-lock members table with integrity badge (verified/legacy/missing); pick-project CTA when no path
- `McpStoreRoute.tsx` — reads `eidolons.mcp.lock`; server table (kind/version/enabled toggle); install-hint empty state
- `HarnessRoute.tsx` — reads `.eidolons/harness/manifest.json`; health/version/binary/installed_at table + features pills; Junction-not-installed CTA
- `MethodologyRoute.tsx` — `readDir .eidolons/` → filters dirs with `agent.md`; left-nav of discovered Eidolons; right `<pre>` renders active `agent.md`
- `SettingsRoute.tsx` — three cards: Project (path + Switch + Clear), Appearance (theme/sidebar/accent tokens), About (BRAND.name/tagline/ffOrigin/lineage/repo link)
- `DoctorRoute.tsx` — STUB ONLY. Centred placeholder with styled `stub-pill` badge. Parallel `feat/v0.1-doctor` branch will overwrite on merge.

**Modified files:**
- `src/components/MainPane.tsx` — now a `RouteRenderer` host; manages project path state internally (open picker + clear); routes on `activeRoute` from context
- `src/components/Sidebar.tsx` — destination buttons wire `onClick → setActiveRoute`; `data-active` + `aria-current="page"` on active button
- `src/App.tsx` — outer `App` wraps `<RouteProvider>`; inner `AppShell` consumes context to inject `onNavigate` into commands.ts
- `src/lib/commands.ts` — `CommandHandlers` gains `onNavigate(RouteId)`; `resolveCommand` nav branch calls `handlers.onNavigate`; default no-ops match test expectations
- `src/styles/global.css` — route layout tokens: `.route-pane`, `.route-card`, `.route-table`, `.badge-*`, `.stub-pill`, `.methodology-layout`, `.settings-row`, `.route-loading`
- `package.json` — added `yaml@^2` (permitted EXCEPTION to no-new-deps rule for YAML parsing of `eidolons.yaml`/`eidolons.lock`/`eidolons.mcp.lock`)

## Changes

Commits on `feat/v0.1-routes`:
1. `8a2ac92` — `feat(routes): RouteContext + useRoute + route registry + RouteHeader chrome`
2. `b34e27e` — `feat(routes): 6 real route components + Doctor stub + wire navigation`
3. (this commit) `chore(threads): apivr completion report for routes scaffolding`

Files touched: 19 (12 created, 7 modified). Branch pushed to `origin/feat/v0.1-routes`.

## Failures and why

None blocking. Pre-existing test failures (9) carried forward unchanged:
- `parseAnsi.test.ts` (3): `AnserJsonEntry.classes` property missing — pre-existing `anser` type mismatch
- `useSync.test.ts` (6): `fn is not a function` in Tauri mock — pre-existing jsdom/Tauri mock gap

Net test delta: -1 failure vs baseline (fixed the pre-existing `logs stub actions via console.info` test that was broken before this branch).

My changes introduced no new TypeScript errors in `src/` (pre-existing `parseAnsi.ts` + `vite.config.ts` errors excluded). Biome config `noDelete` unknown-key error is pre-existing.

`yaml@^2` dep addition is the only `package.json` change; it is the documented EXCEPTION allowed by the mission spec for YAML parsing.

## Test summary

| File | Before | After | Delta |
|---|---|---|---|
| `commands.test.ts` | 15/16 | 16/16 | +1 |
| `projectStore.test.ts` | 9/9 | 9/9 | 0 |
| `useDriftWatcher.test.ts` | 7/7 | 7/7 | 0 |
| `parseAnsi.test.ts` | 3/6 | 3/6 | 0 (pre-existing) |
| `useSync.test.ts` | 1/7 | 1/7 | 0 (pre-existing) |
| **Total** | **35/45** | **36/45** | **+1** |

Type-check: no new errors in `src/` files. All new components pass tsc with zero errors in the routes surface.

Hand-off to IDG to chronicle alongside the parallel Doctor PR.
