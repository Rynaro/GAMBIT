import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { CommandPalette } from "./components/CommandPalette";
import { DriftPill } from "./components/DriftPill";
import { useCommandPalette } from "./lib/useCommandPalette";
import { useDriftWatcher } from "./lib/useDriftWatcher";
import { setupPlatform } from "./lib/platform";
import { getProjectPath, setProjectPath } from "./lib/projectStore";

export function App() {
  useEffect(() => {
    setupPlatform();
  }, []);

  const palette = useCommandPalette();

  const [projectPath, setProjectPathState] = useState<string | null>(
    () => getProjectPath()
  );

  const { state, projectBasename, clearDrift } = useDriftWatcher(projectPath);

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

  return (
    <div className="app-shell">
      <Sidebar
        palette={palette}
        projectPath={projectPath}
        onPickProject={handlePickProject}
      />
      <div className="main-content-area">
        <DriftPill
          state={state}
          projectBasename={projectBasename}
          clearDrift={clearDrift}
        />
        <MainPane />
      </div>
      <CommandPalette open={palette.open} setOpen={palette.setOpen} />
    </div>
  );
}
