import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Toaster } from "sonner";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { CommandPalette } from "./components/CommandPalette";
import { DriftPill } from "./components/DriftPill";
import { LogPane } from "./components/LogPane";
import { UpgradePane } from "./components/UpgradePane";
import { useCommandPalette } from "./lib/useCommandPalette";
import { useDriftWatcher } from "./lib/useDriftWatcher";
import { useSync } from "./lib/useSync";
import { useUpgrade } from "./lib/useUpgrade";
import { useDoctor } from "./lib/useDoctor";
import { useMcpStore } from "./lib/useMcpStore";
import { setCommandHandlers } from "./lib/commands";
import { getProjectPath, setProjectPath, clearProjectPath } from "./lib/projectStore";
import { RouteProvider, useRouteContext } from "./lib/RouteContext";

// ---------------------------------------------------------------------------
// AppShell — inner shell, can call useRouteContext (inside <RouteProvider>)
// ---------------------------------------------------------------------------

function AppShell() {
  const palette = useCommandPalette();
  const { setActiveRoute } = useRouteContext();

  const [projectPath, setProjectPathState] = useState<string | null>(
    () => getProjectPath()
  );

  const { state: driftState, projectBasename, clearDrift } = useDriftWatcher(projectPath);

  // Sync hook — manages live eidolons sync streaming state.
  const sync = useSync();

  // Upgrade hook — manages the check + apply two-phase flow.
  const upgrade = useUpgrade();

  // Doctor hook — lifted to App shell so the palette can trigger runs.
  const doctor = useDoctor();

  // MCP Store hook — lifted to App shell so the palette can trigger refresh.
  const mcpStore = useMcpStore(projectPath);

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

  const showLogPane = sync.state !== "idle";
  const showUpgradePane = upgrade.state !== "idle";

  return (
    <div className="app-shell">
      <Sidebar
        palette={palette}
        projectPath={projectPath}
        onPickProject={handlePickProject}
      />
      <div className="main-content-area">
        <DriftPill
          state={driftState}
          projectBasename={projectBasename}
          clearDrift={clearDrift}
        />
        <MainPane
            projectPath={projectPath}
            onPickProject={handlePickProject}
            onClearProject={handleClearProject}
            onCheckUpgrades={
              projectPath
                ? () => { void upgrade.check(projectPath); }
                : undefined
            }
            doctor={doctor}
            mcpStore={mcpStore}
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
      {showUpgradePane && (
        <UpgradePane
          projectPath={projectPath}
          upgrade={upgrade}
        />
      )}

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
