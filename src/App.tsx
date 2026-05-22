import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import "./styles/global.css";
import { CommandPalette } from "./components/CommandPalette";
import { DriftPill } from "./components/DriftPill";
import { LogPane } from "./components/LogPane";
import { MainPane } from "./components/MainPane";
import { Sidebar } from "./components/Sidebar";
import { UpgradePane } from "./components/UpgradePane";
import { RouteProvider, useRouteContext } from "./lib/RouteContext";
import { setCommandHandlers } from "./lib/commands";
import { clearProjectPath, getProjectPath, setProjectPath } from "./lib/projectStore";
import { useCommandPalette } from "./lib/useCommandPalette";
import { useDoctor } from "./lib/useDoctor";
import { useDriftWatcher } from "./lib/useDriftWatcher";
import { useMcpStore } from "./lib/useMcpStore";
import { useSessions } from "./lib/useSessions";
import { useSync } from "./lib/useSync";
import { useUpgrade } from "./lib/useUpgrade";

// ---------------------------------------------------------------------------
// AppShell — inner shell, can call useRouteContext (inside <RouteProvider>)
// ---------------------------------------------------------------------------

function AppShell() {
  const palette = useCommandPalette();
  const { setActiveRoute } = useRouteContext();

  const [projectPath, setProjectPathState] = useState<string | null>(() => getProjectPath());

  const { state: driftState, projectBasename, clearDrift } = useDriftWatcher(projectPath);

  // Sync hook — manages live eidolons sync streaming state.
  const sync = useSync();

  // Upgrade hook — manages the check + apply two-phase flow.
  const upgrade = useUpgrade();

  // Doctor hook — lifted to App shell so the palette can trigger runs.
  const doctor = useDoctor();

  // MCP Store hook — lifted to App shell so the palette can trigger refresh.
  const mcpStore = useMcpStore(projectPath);

  // Sessions store — lifted to the App shell (mirrors useDoctor / useMcpStore).
  // Living above the router is WHAT keeps a session's transcript alive across
  // a route change — the S2 fix for the route-change transcript-loss bug.
  const sessions = useSessions();

  // Inject the command handlers into commands.ts once on mount.
  // Re-inject when projectPath, sync.start, upgrade.check, doctor.start,
  // mcpStore.refresh, or setActiveRoute changes.
  useEffect(() => {
    setCommandHandlers({
      onSyncProject: () => {
        if (!projectPath) {
          console.warn("[App] Sync project: no project picked — pick a project first");
          return;
        }
        sync.start(projectPath);
      },
      onNavigate: (routeId) => {
        setActiveRoute(routeId);
      },
      onCheckUpgrades: () => {
        if (!projectPath) {
          console.warn("[App] Check upgrades: no project picked — pick a project first");
          return;
        }
        void upgrade.check(projectPath);
      },
      onRunDoctor: () => {
        if (!projectPath) {
          console.warn("[App] Doctor: no project picked — pick a project first");
          return;
        }
        doctor.start(projectPath);
      },
      onRefreshMcpStore: () => {
        void mcpStore.refresh();
      },
    });
  }, [projectPath, sync.start, upgrade.check, doctor.start, mcpStore.refresh, setActiveRoute]);

  async function handlePickProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Pick an Eidolons project",
      });
      if (typeof selected === "string" && selected.trim() !== "") {
        setProjectPath(selected);
        setProjectPathState(selected);
      }
    } catch (err) {
      console.warn("[App] folder dialog failed:", err);
    }
  }

  const handleClearProject = () => {
    clearProjectPath();
    setProjectPathState(null);
  };

  // S8 — the Roster's "Launch" action: stash the chosen Eidolon in the store
  // and switch to the Sessions route, which seeds its picker from
  // `sessions.pendingEidolon`. The single-shot `pendingSessionEidolon` App
  // state is gone — the store now owns this handoff (story S2).
  const handleLaunchSession = (eidolonName: string) => {
    sessions.setPendingEidolon(eidolonName);
    setActiveRoute("sessions");
  };

  const showLogPane = sync.state !== "idle";
  const showUpgradePane = upgrade.state !== "idle";

  return (
    <div className="app-shell">
      <Sidebar palette={palette} projectPath={projectPath} onPickProject={handlePickProject} />
      <div className="main-content-area">
        <DriftPill state={driftState} projectBasename={projectBasename} clearDrift={clearDrift} />
        <MainPane
          projectPath={projectPath}
          onPickProject={handlePickProject}
          onClearProject={handleClearProject}
          onLaunchSession={handleLaunchSession}
          onCheckUpgrades={
            projectPath
              ? () => {
                  void upgrade.check(projectPath);
                }
              : undefined
          }
          doctor={doctor}
          mcpStore={mcpStore}
          sessions={sessions}
        />
      </div>
      <CommandPalette open={palette.open} setOpen={palette.setOpen} />

      {/* Log pane mounts as a fixed bottom panel whenever a sync is in flight
          or has just completed/failed. Cleared via the Close button (sync.clear). */}
      {showLogPane && (
        <LogPane
          state={sync.state}
          lines={sync.lines}
          exitCode={sync.exitCode}
          projectPath={sync.projectPath}
          cancel={sync.cancel}
          clear={sync.clear}
        />
      )}

      {/* Upgrade pane mounts as a fixed bottom panel whenever an upgrade check
          or apply is in flight. Dismissed via the Dismiss/Close button. */}
      {showUpgradePane && <UpgradePane projectPath={projectPath} upgrade={upgrade} />}

      {/* Sonner toast stack — system theme, bottom-right, richColors. */}
      <Toaster
        position="bottom-right"
        theme="system"
        richColors
        closeButton
        toastOptions={{
          // success and info auto-dismiss; errors stay until clicked (per spec §3.5)
          duration: 2500,
          style: { fontFamily: "var(--font-ui)", fontSize: "13px" },
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App — outer root, mounts <RouteProvider> then renders <AppShell>
// ---------------------------------------------------------------------------

export function App() {
  return (
    <RouteProvider>
      <AppShell />
    </RouteProvider>
  );
}
