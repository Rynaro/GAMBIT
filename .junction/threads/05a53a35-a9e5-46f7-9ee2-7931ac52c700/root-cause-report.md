# Root-cause report — GAMBIT main pane blanks after project pick

## reproduction

Reproducer matches the symptom brief verbatim (`gambit/.junction/threads/05a53a35-a9e5-46f7-9ee2-7931ac52c700/input/diagnose-prompt.md:5-13`). Read-only walk of `/Users/henrique/workspace/oss/agents/gambit/` at `feat/v0.1-integration` HEAD `c309cbe`. Reproducer is plausible on inspection — I did not run the Tauri shell, but the wiring evidence is sufficient to attribute. Stance: **confirmed root cause for the user-visible symptom (H2); plus one latent crash hazard (a near-miss H1) that has not surfaced yet only because H2 happens to mask it.**

Key fixed facts confirmed during the walk:

- `src/App.tsx:24-26` owns one `projectPath` state, seeded from `getProjectPath()` once.
- `src/App.tsx:50-64` `handlePickProject` writes localStorage via `setProjectPath(selected)` (lib helper), then calls `setProjectPathState(selected)` — App's state is the one bound to `useDriftWatcher` (`App.tsx:28`) and to `<Sidebar projectPath=…>` (`App.tsx:72`).
- `src/App.tsx:81` renders `<MainPane />` with **no props** — there is no wiring from App's `projectPath` state into MainPane.
- `src/components/MainPane.tsx:71-95` owns a **second, independent** `projectPath` state. It is seeded from `getProjectPath()` at mount (`MainPane.tsx:72-74`) and never re-reads localStorage afterwards. The only writers are MainPane's own `handlePickProject`/`handleClearProject` (`MainPane.tsx:76-95`).
- `src/lib/projectStore.ts` is a thin, non-reactive localStorage wrapper; there is no `storage` event subscription, no broadcast channel, no in-memory pub/sub. A write from App.tsx is invisible to MainPane until MainPane remounts.
- `src/components/MainPane.tsx:99-103` passes its own local `projectPath` into every route through `RouteRenderer`, so all routes see MainPane's snapshot — not App's.
- No `ErrorBoundary` exists anywhere in the tree (`rg ErrorBoundary|componentDidCatch|getDerivedStateFromError src/` returns no hits). `src/main.tsx:14-18` mounts `createRoot(...).render(<StrictMode><App/></StrictMode>)` directly.

## hypotheses

**H2 (CONFIRMED, primary, high-confidence): two `projectPath` stores diverge; MainPane stays on its initial value forever.**

Evidence: App.tsx and MainPane each own a `useState<string|null>(() => getProjectPath())` (`App.tsx:24-26`, `MainPane.tsx:72-74`). When the user clicks the sidebar's "Pick project…" button (`Sidebar.tsx:84-91`), Sidebar invokes its `onPickProject` prop, which is bound to **App.tsx's** `handlePickProject` (`App.tsx:73`). App writes localStorage and updates App's state; MainPane's `<MainPane />` (`App.tsx:81`) has no props and no `key` change, so React reconciles the same instance — MainPane re-renders but its `useState` initializer does not re-run. MainPane's internal `projectPath` is still whatever it was at mount (null on first launch). The active route still receives null and continues to render its "No project selected" empty state. From the user's seat the result is that **picking a project visibly updates the sidebar footer ("Switch" appears) and brings the DriftPill out of `idle` — but the main pane refuses to acknowledge the pick.** The "blank" perception is the unchanged empty-state copy framed by visibly updated chrome around it. This is what makes the bug feel like the pane "went blank" instead of "didn't react."

H2 also explains the partial liveness: `useDriftWatcher(projectPath)` in `App.tsx:28` is bound to App's state, so its effect runs (`useDriftWatcher.ts:50-116`) → `start_watching` invoked → drift events arrive → DriftPill renders. The sidebar footer rerenders against the new App-side prop (`Sidebar.tsx:69-92`). MainPane just sits on null.

**H1 (REJECTED as the trigger, but CONFIRMED as a latent crash hazard): a route synchronously crashes on a non-null `projectPath`.**

`src/routes/ProjectRoute.tsx:18-33` declares the shape of `eidolons.yaml`/`eidolons.lock` *incorrectly*:

```ts
interface EidolonsYaml { members?: string[]; version?: string; }
interface EidolonsLock { members?: Record<string, LockEntry>; }
```

The actual on-disk shape is an array of objects in both files. `eidolons.yaml:10-28` has `members: [ {name, version, source}, ... ]`; `eidolons.lock:5-65` has the same structure. So `yamlData?.members` evaluates to an **array of `{name, version, source}` objects**, not a `string[]`. At `ProjectRoute.tsx:158-162`:

```ts
const declaredMembers: string[] = yamlData?.members ?? [];
const lockMembers = lockData?.members ?? {};
const allMembers = Array.from(new Set([...declaredMembers, ...Object.keys(lockMembers)]));
```

`Object.keys(arrayOfObjects)` returns string indices (`"0","1"...`), so `allMembers` becomes a mixed `Set` of objects and digit-strings. Then `ProjectRoute.tsx:219-251` does `allMembers.map((name) => <tr key={name}><td>{name}</td>…</tr>)`. Passing an object as a React child throws synchronously at render with the classic **"Objects are not valid as a React child (found: object with keys {name, version, source})"** — and since there is no error boundary, this would tear down the entire `createRoot` tree.

Why this is REJECTED as the symptom's *trigger*: this crash can only fire if `ProjectRoute` receives a non-null `projectPath` and `yamlData` is populated. ProjectRoute's `projectPath` comes from MainPane's local state (`MainPane.tsx:100`), which is stuck on null by H2 in this session. So the throw is **latent**. It WILL fire the next time the user relaunches GAMBIT (because `MainPane.tsx:72-74` lazily reads the persisted localStorage at mount), or the moment H2 is fixed without also fixing the data shape. Confidence: high.

**H3 (REJECTED as the trigger, CONFIRMED as a real adjacent gap): fs plugin capability scope.**

`src-tauri/capabilities/default.json:6-12` grants only `fs:default`. Tauri 2's `plugin-fs` default scope does not include arbitrary user paths like `/Users/.../eidolons.yaml`; reads outside the app-scoped dirs return a permission-denied rejection. But every route's `readTextFile(...)` is inside a `.then/.catch` or `try/catch` (`ProjectRoute.tsx:65-95`, `McpStoreRoute.tsx:52-66`, `HarnessRoute.tsx:46-59`, `MethodologyRoute.tsx:46-79,95-108`, `RosterRoute.tsx:84-109`). Rejection → `setError(...)` → renders the error empty state. Not blank. So H3 is not the symptom's trigger — but once H2 and H1 are fixed, users will hit "Couldn't read this project" on every pick until `fs:default` is extended. Confidence: high.

**H4 (REJECTED): `yaml@^2` not installed.** `pnpm-lock.yaml` contains `yaml@2.9.0: {}` (confirmed via `rg "yaml@" pnpm-lock.yaml`). `package.json:38` declares it; lockfile resolves it. Confidence: high.

**H5 (REJECTED): `useEffect` dependency loop / StrictMode silent bail.** None of the route effects mutate their own dep array. ProjectRoute (`:52-100`), McpStoreRoute (`:42-68`), HarnessRoute (`:36-62`), MethodologyRoute (`:34-83` and `:86-111`) all depend only on `projectPath` (and `selected` for methodology). They set `yamlData`/`lockData`/etc., which are not in deps. No loop. React 18 + StrictMode does not "bail to blank". Confidence: high.

**H6 (REJECTED): DriftPill / layout absorbs the pane.** `DriftPill.css:5-22,24-28` defines a sticky 32px header with `opacity` transition; layout box is fixed height. `.main-content-area` (`global.css:320-327`) keeps `<MainPane>` at `flex: 1`. No collapse. Confidence: high.

**H7 (new, INCONCLUSIVE but plausible secondary): DoctorRoute also has a stale-localStorage bug.**

`src/routes/DoctorRoute.tsx:16-21` lazy-reads localStorage once at mount and runs a one-shot `useEffect(()=>setProjectPath(getProjectPath()),[])` — empty deps. Same family as H2 but local to DoctorRoute. Confidence: medium for "secondary contributor", high for "real bug to fix alongside H2."

## interventions

**P0-A — Wrap the active route in an ErrorBoundary (preventive infra; required by the brief).**

File: **new** `src/components/RouteErrorBoundary.tsx`, plus a one-line wrap in `src/components/MainPane.tsx`.

```tsx
// src/components/RouteErrorBoundary.tsx — new file
import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; routeId?: string }
interface State { error: Error | null }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[RouteErrorBoundary]", this.props.routeId, error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="route-pane">
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">This route crashed.</p>
            <p className="route-empty-body">
              {this.props.routeId
                ? `The "${this.props.routeId}" route threw while rendering.`
                : "The active route threw while rendering."}{" "}
              Pick a different route from the sidebar, or fix the underlying error and reload.
            </p>
            <pre className="route-empty-note" style={{ whiteSpace: "pre-wrap", color: "var(--status-error)" }}>
              {this.state.error.message}
            </pre>
            <button type="button" className="route-verb-btn" onClick={this.reset} style={{ marginTop: 8 }}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
```

In `src/components/MainPane.tsx:97-105`, wrap `<RouteRenderer …/>` keyed by `activeRoute` so navigation resets the error state:

```tsx
import { useRouteContext } from "@/lib/RouteContext";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

const { activeRoute } = useRouteContext();
return (
  <main className="main-pane" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
    <RouteErrorBoundary key={activeRoute} routeId={activeRoute}>
      <RouteRenderer projectPath={projectPath} onPickProject={handlePickProject} onClearProject={handleClearProject} />
    </RouteErrorBoundary>
  </main>
);
```

Severity: **P0**. Confidence: high.

**P0-B — Collapse to a single `projectPath` store; drop MainPane's local copy.** (Actual root-cause fix for H2.)

File: `src/components/MainPane.tsx` (full replacement of the body, plus an import shave) and `src/App.tsx:81` (pass props).

In `src/App.tsx:81`, change `<MainPane />` to:

```tsx
<MainPane
  projectPath={projectPath}
  onPickProject={handlePickProject}
  onClearProject={handleClearProject}
/>
```

Add `handleClearProject` in App.tsx alongside `handlePickProject`:

```tsx
const handleClearProject = () => {
  clearProjectPath();
  setProjectPathState(null);
};
```

Import `clearProjectPath` from `./lib/projectStore`.

In `src/components/MainPane.tsx`, delete the local state and handlers and accept the props:

```tsx
interface MainPaneProps {
  projectPath: string | null;
  onPickProject: () => Promise<void> | void;
  onClearProject: () => void;
}

export function MainPane({ projectPath, onPickProject, onClearProject }: MainPaneProps) {
  const { activeRoute } = useRouteContext();
  return (
    <main className="main-pane" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
      <RouteErrorBoundary key={activeRoute} routeId={activeRoute}>
        {/* inline the route switch from RouteRenderer here, using the props */}
      </RouteErrorBoundary>
    </main>
  );
}
```

Also fix `src/routes/DoctorRoute.tsx:16-21` — delete the local `useState/useEffect` localStorage read and accept `projectPath` as a prop, threaded the same as other routes.

Severity: **P0**. Confidence: high.

**P1-A — Fix `ProjectRoute`'s data shape (latent crash hazard H1).**

File: `src/routes/ProjectRoute.tsx:18-33` and render path `:158-251`.

```ts
interface DeclaredMember { name: string; version?: string; source?: string }
interface LockMember { name: string; version?: string; archive_sha256?: string; manifest_sha256?: string; verification?: string; installed_at?: string }
interface EidolonsYaml { members?: DeclaredMember[]; version?: number | string }
interface EidolonsLock { members?: LockMember[] }
```

Then index by name:

```ts
const declaredMembers = yamlData?.members ?? [];
const lockMembers = lockData?.members ?? [];
const declaredByName = new Map(declaredMembers.map((m) => [m.name, m]));
const lockByName = new Map(lockMembers.map((m) => [m.name, m]));
const allNames = Array.from(new Set([...declaredByName.keys(), ...lockByName.keys()]));
```

Render rows by name only. Severity: **P1** (latent, will fire on first relaunch with persisted project path once P0-B lands). Confidence: high.

**P1-B — Extend `fs` capability scope so route readers can actually open user-picked paths.**

File: `src-tauri/capabilities/default.json`. Add a permission entry that grants read access to user-picked paths. For v0.1, the simplest is `"fs:allow-read-text-file"` plus a broad `"fs:scope"` (e.g. `**`) — or the proper Tauri 2 runtime scope via `fs_scope.allow()` triggered when the user picks a folder. Verify exact permission identifier strings against installed `tauri-plugin-fs` version. Severity: **P1**. Confidence: medium-high.

**P2-A — Make `useSync` accept `projectPath` from App.tsx** instead of cached locally. Severity: P2.

**P2-B — Add `storage` event listener fallback in `projectStore.ts`** to broadcast writes across components. Becomes moot after P0-B. Severity: P2.

## blame_target

- `src/components/MainPane.tsx:71-95` — duplicate `projectPath` `useState` with no subscription to App-side updates — **primary blame**.
- `src/App.tsx:81` — `<MainPane />` rendered with no props, no wiring from App's `projectPath` into the pane — **co-primary blame**.
- `src/routes/ProjectRoute.tsx:18-33,158-162,219-251` — wrong type shape for `members` field — **latent crash blame**.
- `src/routes/DoctorRoute.tsx:16-21` — one-shot localStorage read, never reacts to updates — **same-family bug**.
- Absence of any `ErrorBoundary` in `src/` — **debuggability blame**.

Commit attribution: `b34e27e` (`feat(routes): 6 real route components + Doctor stub + wire navigation`) introduced the duplicate-state seam by giving MainPane its own state instead of taking the path from App via props. `e188e9a` inherited the pattern in DoctorRoute. The integration merge `a7b4b5a` did not reconcile the two state owners — Agent A's open question correctly predicted this exact failure mode.
