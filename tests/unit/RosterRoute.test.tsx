// RosterRoute.test.tsx — unit tests for the corrected (project-only) Roster.
//
// Hermetic: `readProjectEidolons` is mocked so no disk is touched.
//
// Coverage:
//   * no-project empty state
//   * project Eidolons rendering from a mocked roster
//   * a per-row "Launch" button is present and invokes the handoff callback

import type { ProjectEidolon } from "@/lib/eidolon.types";
import { RosterRoute } from "@/routes/RosterRoute";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const readProjectEidolonsMock = vi.fn<(path: string) => Promise<ProjectEidolon[]>>();
vi.mock("@/lib/eidolonRoster", () => ({
  readProjectEidolons: (path: string) => readProjectEidolonsMock(path),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ATLAS: ProjectEidolon = {
  name: "atlas",
  description: "Read-only codebase scout.",
  role: "Explorer/Scout",
  methodology: "ATLAS",
  methodologyVersion: "1.0",
  allowedTools: ["view_file", "list_dir", "search_text"],
  handoffs: ["spectra"],
  agentMdPath: "/proj/.eidolons/atlas/agent.md",
};

const SPECTRA: ProjectEidolon = {
  name: "spectra",
  description: "Decision architect.",
  role: "Planner",
  methodology: "SPECTRA",
  methodologyVersion: "2.0",
  allowedTools: ["view_file"],
  handoffs: ["apivr"],
  agentMdPath: "/proj/.eidolons/spectra/agent.md",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RosterRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readProjectEidolonsMock.mockResolvedValue([ATLAS, SPECTRA]);
  });

  afterEach(() => {
    // clearAllMocks, NOT restoreAllMocks (per the project test convention).
    vi.clearAllMocks();
  });

  it("renders the no-project empty state when projectPath is null", () => {
    render(<RosterRoute projectPath={null} onLaunchSession={vi.fn()} />);
    expect(screen.getByText("No project selected.")).toBeDefined();
    expect(readProjectEidolonsMock).not.toHaveBeenCalled();
  });

  it("renders the project Eidolons from the mocked roster", async () => {
    render(<RosterRoute projectPath="/proj" onLaunchSession={vi.fn()} />);

    // findBy* is act-aware and retries until the async roster resolves.
    expect(await screen.findByText("ATLAS")).toBeDefined();
    expect(screen.getByText("SPECTRA")).toBeDefined();
    expect(screen.getByText("Read-only codebase scout.")).toBeDefined();
    expect(screen.getByText("Project Eidolons")).toBeDefined();
  });

  it("renders a Launch button per row that invokes the handoff callback", async () => {
    const onLaunchSession = vi.fn();
    render(<RosterRoute projectPath="/proj" onLaunchSession={onLaunchSession} />);

    const launchAtlas = await screen.findByLabelText("Launch atlas as a session");
    expect(screen.getByLabelText("Launch spectra as a session")).toBeDefined();

    fireEvent.click(launchAtlas);
    expect(onLaunchSession).toHaveBeenCalledWith("atlas");
  });

  it("renders the empty-roster state when the project has no Eidolons", async () => {
    readProjectEidolonsMock.mockResolvedValue([]);
    render(<RosterRoute projectPath="/proj" onLaunchSession={vi.fn()} />);
    expect(await screen.findByText("No Eidolons in this project.")).toBeDefined();
  });
});
