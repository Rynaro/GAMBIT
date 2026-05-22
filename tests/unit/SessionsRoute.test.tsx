// SessionsRoute.test.tsx — unit tests for the Sessions route.
//
// Story S2: the route no longer owns session state — it consumes the
// `useSessions` store as a prop. These tests pass a hand-built store stub so
// no process is spawned and no disk is touched; `readProjectEidolons` and the
// Tauri fs plugin are still mocked.
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
import type { UseSessionsResult } from "@/lib/useSessions";
import { SessionsRoute } from "@/routes/SessionsRoute";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

/** A mutable `useSessions` store stub the tests reshape per-case. */
function makeStore(overrides: Partial<UseSessionsResult> = {}): UseSessionsResult {
  return {
    sessions: {},
    rehydrating: false,
    authStatus: null,
    pendingEidolon: null,
    setPendingEidolon: vi.fn(),
    start: vi.fn(async () => null),
    sendTurn: vi.fn(),
    cancel: vi.fn(),
    reopen: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    checkAuth: vi.fn(),
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
    readProjectEidolonsMock.mockResolvedValue([ATLAS]);
    readTextFileMock.mockResolvedValue("---\nname: atlas\n---\npersona");
  });

  afterEach(() => {
    // clearAllMocks, NOT restoreAllMocks (per the project test convention).
    vi.clearAllMocks();
  });

  it("renders the no-project empty state when projectPath is null", () => {
    render(<SessionsRoute projectPath={null} store={makeStore()} />);
    expect(screen.getByText("No project selected.")).toBeDefined();
  });

  it("renders the pre-launch panel with the mocked Eidolon list", async () => {
    render(<SessionsRoute projectPath="/proj" store={makeStore()} />);

    // The Eidolon picker shows the mocked member once the async roster resolves.
    expect(await screen.findByText(/atlas — Explorer\/Scout/)).toBeDefined();

    expect(screen.getByLabelText("Select an Eidolon to launch")).toBeDefined();
    expect(screen.getByLabelText("Select the permission mode")).toBeDefined();
    expect(screen.getByLabelText("First prompt for the session")).toBeDefined();
  });

  it("R1: surfaces the allow-list and the headless-abort warning", async () => {
    render(<SessionsRoute projectPath="/proj" store={makeStore()} />);

    expect(await screen.findByText("view_file")).toBeDefined();
    expect(screen.getByText("search_text")).toBeDefined();
    expect(screen.getByText(/outside this allow-list aborts the run/)).toBeDefined();
  });

  it("R2: a not-logged-in claude disables the Launch button", async () => {
    const authStatus: AuthStatus = { loggedIn: false, detail: "no account" };
    render(<SessionsRoute projectPath="/proj" store={makeStore({ authStatus })} />);
    await flush();

    const launch = screen.getByLabelText("Launch the Eidolon session") as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(screen.getByText("Not logged in to claude.")).toBeDefined();
  });

  it("R2: runs the auth pre-flight when a project loads", async () => {
    const store = makeStore();
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();
    expect(store.checkAuth).toHaveBeenCalled();
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
