import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { CommandPalette } from "./components/CommandPalette";
import { DriftPill } from "./components/DriftPill";
import { LogPane } from "./components/LogPane";
import { useCommandPalette } from "./lib/useCommandPalette";
import { useDriftWatcher } from "./lib/useDriftWatcher";
import { useSync } from "./lib/useSync";
import { setCommandHandlers } from "./lib/commands";
import { getProjectPath, setProjectPath } from "./lib/projectStore";

export function App() {
  const palette = useCommandPalette();

  const [projectPath, setProjectPathState] = useState<string | null>(
    () => getProjectPath()
  );

  const { state: driftState, projectBasename, clearDrift } = useDriftWatcher(projectPath);

  // Sync hook — manages live eidolons sync streaming state.
  const sync = useSync();

  // Inject the "Sync project" handler into commands.ts once on mount.
  // Using useEffect so the reference is stable after the first render.
  useEffect(() => {
    setCommandHandlers({
      onSyncProject: () => {
        if (!projectPath) {
          console.warn("[App] Sync project: no project picked — pick a project first");
          return;
        }
        sync.start(projectPath);
      },
    });
    // Re-inject when projectPath or sync.start changes so the closure is fresh.
  }, [projectPath, sync.start]);

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

  const showLogPane = sync.state !== "idle";

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
        <MainPane />
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
    </div>
  );
}
