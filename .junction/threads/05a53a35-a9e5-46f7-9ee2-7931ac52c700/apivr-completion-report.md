---
thread_id: "05a53a35-a9e5-46f7-9ee2-7911ac52c700"
message_id: "290fbe64-6451-4a55-8d3d-653be7669e6b"
parent_id: "d4de7edc-33e7-4597-a0ce-b1ba925fd26e"
from_eidolon: apivr
from_version: "3.1.2"
to_eidolon: idg
to_version: "1.2.2"
upstream_report: "./root-cause-report.md"
branch: feat/v0.1-integration
head: 47559aa
---

## What built

Three changes on branch `feat/v0.1-integration` (HEAD `47559aa`), applied exactly as VIGIL specified in `root-cause-report.md ## interventions`, scoped to P0-A, P0-B, and P1-A.

## Changes

**P0-A — `src/components/RouteErrorBoundary.tsx` (new)**
Class component using `getDerivedStateFromError` + `componentDidCatch(error: Error, info: ErrorInfo)`. `ErrorInfo` imported explicitly from `"react"` to avoid the broken `React.ErrorInfo` reference in the snippet. Renders a friendly error pane with Retry button. Commit `9b53529`.

**P0-B — single `projectPath` store (commits `a79f29f`)**
- `src/App.tsx`: added `handleClearProject` that calls `clearProjectPath()` + `setProjectPathState(null)`; imported `clearProjectPath` from `./lib/projectStore`; replaced `<MainPane />` with `<MainPane projectPath={projectPath} onPickProject={handlePickProject} onClearProject={handleClearProject} />`.
- `src/components/MainPane.tsx`: deleted local `useState<string|null>(() => getProjectPath())` and its handlers; removed `getProjectPath/setProjectPath/clearProjectPath` imports and `open`/`useCallback`; added `MainPaneProps` interface; wired `RouteErrorBoundary key={activeRoute}` around `RouteRenderer`; passed props through.
- `src/routes/DoctorRoute.tsx`: deleted one-shot `useState/useEffect` localStorage read; deleted `getProjectPath` import; accepts `{ projectPath: string | null }` prop matching all other routes.

**P1-A — `src/routes/ProjectRoute.tsx` (commit `47559aa`)**
Replaced interface declarations: `DeclaredMember { name, version?, source? }`, `LockMember { name, version?, archive_sha256?, manifest_sha256?, verification?, installed_at? }`, `EidolonsYaml { members?: DeclaredMember[]; version?: number | string }`, `EidolonsLock { members?: LockMember[] }`. Replaced render path with `Map`-indexed lookup (`declaredByName`, `lockByName`, `allNames`). Table rows now pass only scalar fields — no object-as-React-child possible.

## Failures and why

None. All three interventions applied cleanly. No merge conflicts; the branch was already at `c309cbe` which is the HEAD VIGIL inspected.

Deliberate skips: P1-B (fs capability scope — needs Tauri 2 doc verification, tracked as v0.2 follow-up), P2-A, P2-B (moot after P0-B).

## Test summary

No automated test suite covers Tauri UI routes (`pnpm test` targets Rust unit tests only and `cargo check` was not run per tool constraints). Self-validation performed by reading all five affected files post-edit and confirming:

- `RouteErrorBoundary.tsx`: `ErrorInfo` imported from `"react"` directly; no `React.ErrorInfo` reference; class component shape valid.
- `MainPane.tsx`: no `getProjectPath`/`setProjectPath`/`clearProjectPath` imports; no `useState` for projectPath; `RouteErrorBoundary key={activeRoute}` wraps `RouteRenderer`; `DoctorRoute` receives `projectPath={projectPath}`.
- `App.tsx`: `clearProjectPath` imported; `handleClearProject` defined; `<MainPane>` receives all three props.
- `DoctorRoute.tsx`: no `getProjectPath` import; no local `useState`/`useEffect` for project path; `DoctorRouteProps { projectPath: string | null }` interface present.
- `ProjectRoute.tsx`: interfaces correct; `declaredByName`/`lockByName`/`allNames` Map-indexed; table rows use only `name`, `version`, `verification` scalars.

Hand-off to IDG to chronicle the blank-pane fix.
