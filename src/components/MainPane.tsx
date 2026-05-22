// MainPane.tsx — Host shell that renders the active route's content.
// projectPath and project handlers are owned by App.tsx and passed in as props.
// A RouteErrorBoundary keyed by activeRoute prevents route crashes from tearing
// down the entire shell.

import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useRouteContext } from "@/lib/RouteContext";
import type { DoctorResult } from "@/lib/useDoctor";
import type { UseMcpStoreResult } from "@/lib/useMcpStore";
import { DoctorRoute } from "@/routes/DoctorRoute";
import { HarnessRoute } from "@/routes/HarnessRoute";
import { McpStoreRoute } from "@/routes/McpStoreRoute";
import { MethodologyRoute } from "@/routes/MethodologyRoute";
import { ProjectRoute } from "@/routes/ProjectRoute";
import { RosterRoute } from "@/routes/RosterRoute";
import { SettingsRoute } from "@/routes/SettingsRoute";

// ---------------------------------------------------------------------------
// RouteRenderer — maps activeRoute → component
// ---------------------------------------------------------------------------

interface RouteRendererProps {
  projectPath: string | null;
  onPickProject: () => Promise<void> | void;
  onClearProject: () => void;
  onCheckUpgrades?: () => void;
  doctor: DoctorResult;
  mcpStore: UseMcpStoreResult;
}

function RouteRenderer({
  projectPath,
  onPickProject,
  onClearProject,
  onCheckUpgrades,
  doctor,
  mcpStore,
}: RouteRendererProps) {
  const { activeRoute } = useRouteContext();

  switch (activeRoute) {
    case "roster":
      return <RosterRoute />;
    case "project":
      return (
        <ProjectRoute
          projectPath={projectPath}
          onPickProject={() => void onPickProject()}
          onCheckUpgrades={onCheckUpgrades}
        />
      );
    case "mcp-store":
      return <McpStoreRoute projectPath={projectPath} mcpStore={mcpStore} />;
    case "harness":
      return <HarnessRoute projectPath={projectPath} />;
    case "doctor":
      return <DoctorRoute projectPath={projectPath} doctor={doctor} />;
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
// MainPane — accepts projectPath + handlers from App.tsx; renders RouteRenderer
// wrapped in an error boundary keyed by the active route.
// ---------------------------------------------------------------------------

interface MainPaneProps {
  projectPath: string | null;
  onPickProject: () => Promise<void> | void;
  onClearProject: () => void;
  onCheckUpgrades?: () => void;
  doctor: DoctorResult;
  mcpStore: UseMcpStoreResult;
}

export function MainPane({
  projectPath,
  onPickProject,
  onClearProject,
  onCheckUpgrades,
  doctor,
  mcpStore,
}: MainPaneProps) {
  const { activeRoute } = useRouteContext();

  return (
    <main className="main-pane" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
      <RouteErrorBoundary key={activeRoute} routeId={activeRoute}>
        <RouteRenderer
          projectPath={projectPath}
          onPickProject={onPickProject}
          onClearProject={onClearProject}
          onCheckUpgrades={onCheckUpgrades}
          doctor={doctor}
          mcpStore={mcpStore}
        />
      </RouteErrorBoundary>
    </main>
  );
}
