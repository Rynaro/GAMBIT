// SessionsRoute.test.tsx — unit tests for the Sessions route.
//
// Hermetic: `useSession`, `readProjectEidolons`, and the Tauri fs plugin are
// all mocked so no process is spawned and no disk is touched.
//
// Coverage:
//   * no-project empty state
//   * pre-launch panel rendering with a mocked Eidolon list
//   * R2 — the not-logged-in auth gate disables Launch
//   * R1 — the allow-list + headless-abort warning is surfaced
//   * a component-level smoke test of ResultCard

import { ResultCard } from "@/components/session/ResultCard";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import type { AuthStatus } from "@/lib/session.types";
import type { UseSessionResult } from "@/lib/useSession";
import { SessionsRoute } from "@/routes/SessionsRoute";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// A mutable session stub the tests reshape per-case.
let sessionStub: UseSessionResult;

vi.mock("@/lib/useSession", () => ({
  useSession: () => sessionStub,
}));

const readProjectEidolonsMock = vi.fn<(path: string) => Promise<ProjectEidolon[]>>();
vi.mock("@/lib/eidolonRoster", () => ({
  readProjectEidolons: (path: string) => readProjectEidolonsMock(path),
}));

const readTextFileMock = vi.fn<(path: string) => Promise<string>>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (path: string) => readTextFileMock(path),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<UseSessionResult> = {}): UseSessionResult {
  return {
    status: "idle",
    transcript: [],
    sessionInfo: null,
    authStatus: null,
    start: vi.fn(),
    sendTurn: vi.fn(),
    cancel: vi.fn(),
    checkAuth: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

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

/** Wait out the route's load-Eidolons + checkAuth microtask chain. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionsRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStub = makeSession();
    readProjectEidolonsMock.mockResolvedValue([ATLAS]);
    readTextFileMock.mockResolvedValue("---\nname: atlas\n---\npersona");
  });

  afterEach(() => {
    // clearAllMocks, NOT restoreAllMocks (per the project test convention).
    vi.clearAllMocks();
  });

  it("renders the no-project empty state when projectPath is null", () => {
    render(<SessionsRoute projectPath={null} />);
    expect(screen.getByText("No project selected.")).toBeDefined();
  });

  it("renders the pre-launch panel with the mocked Eidolon list", async () => {
    render(<SessionsRoute projectPath="/proj" />);

    // The Eidolon picker shows the mocked member once the async roster resolves.
    // findByText is act-aware and retries — unlike a bare microtask flush.
    expect(await screen.findByText(/atlas — Explorer\/Scout/)).toBeDefined();

    // The picker, permission-mode select, and first-prompt textarea exist.
    expect(screen.getByLabelText("Select an Eidolon to launch")).toBeDefined();
    expect(screen.getByLabelText("Select the permission mode")).toBeDefined();
    expect(screen.getByLabelText("First prompt for the session")).toBeDefined();
  });

  it("R1: surfaces the allow-list and the headless-abort warning", async () => {
    render(<SessionsRoute projectPath="/proj" />);

    // The allow-list renders once the roster loads and the first Eidolon
    // auto-selects; findByText waits for that async settle.
    expect(await screen.findByText("view_file")).toBeDefined();
    expect(screen.getByText("search_text")).toBeDefined();
    // The headless-abort warning is present.
    expect(screen.getByText(/outside this allow-list aborts the run/)).toBeDefined();
  });

  it("R2: a not-logged-in claude disables the Launch button", async () => {
    const authStatus: AuthStatus = { loggedIn: false, detail: "no account" };
    sessionStub = makeSession({ authStatus });

    render(<SessionsRoute projectPath="/proj" />);
    await flush();

    const launch = screen.getByLabelText("Launch the Eidolon session") as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(screen.getByText("Not logged in to claude.")).toBeDefined();
  });

  it("R2: runs the auth pre-flight when a project loads", async () => {
    render(<SessionsRoute projectPath="/proj" />);
    await flush();
    expect(sessionStub.checkAuth).toHaveBeenCalled();
  });
});

describe("ResultCard", () => {
  it("renders cost, turns, and duration for a successful turn", () => {
    render(
      <ResultCard
        subtype="success"
        isError={false}
        totalCostUsd={0.0123}
        numTurns={3}
        durationMs={4200}
      />,
    );
    expect(screen.getByText("Turn complete")).toBeDefined();
    expect(screen.getByText("$0.0123")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("4.2s")).toBeDefined();
  });

  it("renders the error variant when the turn failed", () => {
    render(
      <ResultCard
        subtype="error_max_turns"
        isError={true}
        totalCostUsd={null}
        numTurns={null}
        durationMs={null}
      />,
    );
    expect(screen.getByText("Turn ended with an error")).toBeDefined();
    expect(screen.getByText("error_max_turns")).toBeDefined();
  });
});
