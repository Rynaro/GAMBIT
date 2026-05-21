// MainPane.tsx — Host shell that renders the active route's content.
// Switched from the welcome empty state to a RouteRenderer that maps
// the active route from RouteContext to the matching route component.

import { useRouteContext } from "@/lib/RouteContext";
import { RosterRoute } from "@/routes/RosterRoute";
import { ProjectRoute } from "@/routes/ProjectRoute";
import { McpStoreRoute } from "@/routes/McpStoreRoute";
import { HarnessRoute } from "@/routes/HarnessRoute";
import { DoctorRoute } from "@/routes/DoctorRoute";
import { MethodologyRoute } from "@/routes/MethodologyRoute";
import { SettingsRoute } from "@/routes/SettingsRoute";
import { getProjectPath, setProjectPath, clearProjectPath } from "@/lib/projectStore";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// RouteRenderer — maps activeRoute → component
// ---------------------------------------------------------------------------

interface RouteRendererProps {
  projectPath: string | null;
  onPickProject: () => Promise<void>;
  onClearProject: () => void;
}

function RouteRenderer({ projectPath, onPickProject, onClearProject }: RouteRendererProps) {
  const { activeRoute } = useRouteContext();

  switch (activeRoute) {
    case "roster":
      return <RosterRoute />;
    case "project":
      return (
        <ProjectRoute
          projectPath={projectPath}
          onPickProject={() => void onPickProject()}
        />
      );
    case "mcp-store":
      return <McpStoreRoute projectPath={projectPath} />;
    case "harness":
      return <HarnessRoute projectPath={projectPath} />;
    case "doctor":
      return <DoctorRoute />;
    case "methodology":
      return <MethodologyRoute projectPath={projectPath} />;
    case "settings":
      return (
        <SettingsRoute
          projectPath={projectPath}
          onPickProject={() => void onPickProject()}
          onClearProject={onClearProject}
        />
      );
    default:
      return (
        <div className="route-pane">
          <div className="route-empty">
            <p className="route-empty-heading">Unknown route.</p>
          </div>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// MainPane — manages project state and renders RouteRenderer
// ---------------------------------------------------------------------------

export function MainPane() {
  const [projectPath, setProjectPathState] = useState<string | null>(
    () => getProjectPath()
  );

  const handlePickProject = useCallback(async () => {
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
      console.warn("[MainPane] folder dialog failed:", err);
    }
  }, []);

  const handleClearProject = useCallback(() => {
    clearProjectPath();
    setProjectPathState(null);
  }, []);

  return (
    <main className="main-pane" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
      <RouteRenderer
        projectPath={projectPath}
        onPickProject={handlePickProject}
        onClearProject={handleClearProject}
      />
    </main>
  );
}
