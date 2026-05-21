import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { DriftPill } from "./components/DriftPill";
import { getProjectPath, setProjectPath } from "./lib/projectStore";
import { useDriftWatcher } from "./lib/useDriftWatcher";

export function App() {
  // Read the persisted path on first render; useState initializer runs once.
  const [projectPath, setProjectPathState] = useState<string | null>(
    () => getProjectPath()
  );

  // The drift watcher hook manages the Rust watcher lifecycle + event subscription
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
      <Sidebar projectPath={projectPath} onPickProject={handlePickProject} />
      <div className="main-content-area">
        <DriftPill
          state={state}
          projectBasename={projectBasename}
          clearDrift={clearDrift}
        />
        <MainPane />
      </div>
    </div>
  );
}
