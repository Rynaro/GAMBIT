// SessionsRoute.test.tsx — unit tests for the Sessions route.
//
// Story S3: `SessionsRoute` is a list<->detail shell — a persistent left rail
// (`SessionList` + a "New session" button) beside a detail pane, where the
// composer both CREATES a session (no session selected) and SENDS turns (a
// session selected). These tests pass a hand-built `useSessions` store stub so
// no process is spawned and no disk is touched; `readProjectEidolons` and the
// Tauri fs plugin are mocked.
//
// Coverage:
//   * no-project AND no-prior-session → the empty state
//   * the list<->detail shell renders the rail entries from `store.sessions`
//   * "New session" puts the composer into create mode
//   * the cwd-resolution §5 P0 gate:
//       - a composer-created session is started with a non-empty absolute
//         `project_path`
//       - with no project AND no prior session the create action is blocked
//   * `resolveCwd` §5 rule ordering (pure helper)
//   * a component-level smoke test of ResultCard

import { ResultCard } from "@/components/session/ResultCard";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import type { AuthStatus, SessionInfo } from "@/lib/session.types";
import type { SessionSlice, UseSessionsResult } from "@/lib/useSessions";
import { SessionsRoute, resolveCwd } from "@/routes/SessionsRoute";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// S4: the route now loads a Cortex-prepended roster via `readProjectRoster`.
// The mock keeps the real `CORTEX_*` constants so the composer + route agree.
const readProjectRosterMock = vi.fn<(path: string) => Promise<ProjectEidolon[]>>();
vi.mock("@/lib/eidolonRoster", () => ({
  readProjectRoster: (path: string) => readProjectRosterMock(path),
  CORTEX_EIDOLON_NAME: "@cortex",
  CORTEX_DISPLAY_NAME: "Cortex (default)",
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

/** The synthetic "Cortex (default)" roster entry (story S4) — available. */
const CORTEX: ProjectEidolon = {
  name: "@cortex",
  description: "Self-routing default.",
  role: "Routing cortex",
  methodology: "TRANCE",
  methodologyVersion: "",
  allowedTools: [],
  handoffs: [],
  agentMdPath: "/proj/.eidolons/cortex/EIDOLONS.md",
  isCortex: true,
  unavailable: false,
};

/** The Cortex entry for a project missing `.eidolons/cortex/EIDOLONS.md`. */
const CORTEX_UNAVAILABLE: ProjectEidolon = {
  ...CORTEX,
  description: "Cortex routing descriptor not found in this project.",
  unavailable: true,
};

/** The cortex routing descriptor's content — fed as `appendSystemPrompt`. */
const EIDOLONS_MD = "# EIDOLONS.md — Routing Cortex\nroute work to the project's Eidolons";

const LOGGED_IN: AuthStatus = { loggedIn: true, detail: "Logged in to claude." };

/** Build a `SessionSlice` for the rail / cwd-resolution fixtures. */
function makeSlice(
  uuid: string,
  partial: { title?: string; projectPath?: string; lastActiveAt?: string } = {},
): SessionSlice {
  const info: SessionInfo = {
    sessionId: uuid,
    eidolonName: "atlas",
    projectPath: partial.projectPath ?? "/proj",
    permissionMode: "default",
    status: "awaiting-input",
    createdAt: "2026-05-20T10:00:00+00:00",
    isCortex: false,
  };
  return {
    sessionId: uuid,
    status: "awaiting-input",
    transcript: [],
    sessionInfo: info,
    summary: {
      uuid,
      eidolonName: "atlas",
      isCortex: false,
      title: partial.title ?? `Session ${uuid}`,
      projectPath: partial.projectPath ?? "/proj",
      status: "awaiting-input",
      model: null,
      createdAt: "2026-05-20T10:00:00+00:00",
      lastActiveAt: partial.lastActiveAt ?? "2026-05-20T10:00:00+00:00",
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCostUsd: 0,
    },
    turn: 1,
    hydrated: false,
  };
}

/** Wait out the route's load-Eidolons + checkAuth microtask chain. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// resolveCwd — the §5 cwd-resolution helper (pure)
// ---------------------------------------------------------------------------

describe("resolveCwd (spec §5)", () => {
  it("rule 1 — uses the currently-selected project when non-null", () => {
    const r = resolveCwd("/selected/project", { a: makeSlice("a", { projectPath: "/other" }) });
    expect(r.path).toBe("/selected/project");
    expect(r.source).toBe("selected-project");
  });

  it("rule 2 — falls back to the most-recently-active session's project", () => {
    const sessions: Record<string, SessionSlice> = {
      old: makeSlice("old", {
        projectPath: "/proj/old",
        lastActiveAt: "2026-05-19T10:00:00+00:00",
      }),
      recent: makeSlice("recent", {
        projectPath: "/proj/recent",
        lastActiveAt: "2026-05-21T10:00:00+00:00",
      }),
    };
    const r = resolveCwd(null, sessions);
    expect(r.path).toBe("/proj/recent");
    expect(r.source).toBe("recent-session");
  });

  it("rule 3 — no project AND no prior session yields a null (blocked) path", () => {
    const r = resolveCwd(null, {});
    expect(r.path).toBeNull();
    expect(r.source).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// SessionsRoute — the list<->detail shell
// ---------------------------------------------------------------------------

describe("SessionsRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // S4: the roster is Cortex-prepended — entry[0] is "Cortex (default)".
    readProjectRosterMock.mockResolvedValue([CORTEX, ATLAS]);
    // `readTextFile` resolves both the cortex EIDOLONS.md descriptor and a
    // named Eidolon's agent.md by path — distinguish them per-call below.
    readTextFileMock.mockImplementation(async (path: string) =>
      path.endsWith("EIDOLONS.md") ? EIDOLONS_MD : "---\nname: atlas\n---\npersona",
    );
  });

  afterEach(() => {
    // clearAllMocks, NOT restoreAllMocks (per the project test convention).
    vi.clearAllMocks();
  });

  it("renders the no-project empty state with no project and no prior session", () => {
    render(<SessionsRoute projectPath={null} store={makeStore()} />);
    expect(screen.getByText("No project selected.")).toBeDefined();
  });

  it("renders the list<->detail shell with a New-session button when a project is set", async () => {
    render(<SessionsRoute projectPath="/proj" store={makeStore({ authStatus: LOGGED_IN })} />);
    await flush();
    expect(screen.getByLabelText("Start a new session")).toBeDefined();
    // No session selected → the composer is in create mode.
    expect(screen.getByLabelText("New session prompt")).toBeDefined();
  });

  it("renders the session list entries from a stubbed store.sessions", async () => {
    const store = makeStore({
      authStatus: LOGGED_IN,
      sessions: {
        s1: makeSlice("s1", { title: "Refactor the auth module" }),
        s2: makeSlice("s2", { title: "Write the changelog" }),
      },
    });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();
    expect(screen.getByText("Refactor the auth module")).toBeDefined();
    expect(screen.getByText("Write the changelog")).toBeDefined();
  });

  it("New session clears the active selection → the composer enters create mode", async () => {
    const store = makeStore({
      authStatus: LOGGED_IN,
      sessions: { s1: makeSlice("s1", { title: "Refactor the auth module" }) },
    });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();

    // Open the detail view by selecting the row.
    fireEvent.click(screen.getByLabelText("Open session Refactor the auth module"));
    expect(screen.queryByLabelText("New session prompt")).toBeNull();

    // "New session" returns to create mode.
    fireEvent.click(screen.getByLabelText("Start a new session"));
    expect(screen.getByLabelText("New session prompt")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // §5 P0 gate — the cwd-resolution mandate
  // -------------------------------------------------------------------------

  it("§5 P0: a composer-created session is started with a non-empty absolute project_path", async () => {
    const startMock = vi.fn(async () => "new-session-id");
    const store = makeStore({ authStatus: LOGGED_IN, start: startMock });
    render(<SessionsRoute projectPath="/abs/project" store={store} />);
    await flush();

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "do the thing" } });
    fireEvent.click(screen.getByLabelText("Start the session"));
    await flush();

    expect(startMock).toHaveBeenCalledTimes(1);
    const params = startMock.mock.calls[0][0] as { projectPath: string; firstPrompt: string };
    // The resolved cwd is pinned, absolute, and non-empty BEFORE turn 1.
    expect(params.projectPath).toBe("/abs/project");
    expect(params.projectPath.length).toBeGreaterThan(0);
    expect(params.projectPath.startsWith("/")).toBe(true);
    expect(params.firstPrompt).toBe("do the thing");
  });

  it("§5 P0: with no project AND no prior session the create action is blocked", async () => {
    // With NO project the route would show the empty state — to exercise the
    // shell's blocked composer we need the shell to render, so seed a prior
    // session that itself carries NO project_path (an old-index entry).
    const startMock = vi.fn(async () => null);
    const store = makeStore({
      authStatus: LOGGED_IN,
      start: startMock,
      sessions: { s1: makeSlice("s1", { projectPath: "" }) },
    });
    render(<SessionsRoute projectPath={null} store={store} />);
    await flush();

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "this should not start" } });

    // The Start button is disabled and the blocked affordance is shown.
    const startBtn = screen.getByLabelText("Start the session") as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(screen.getByText(/Select a project folder/)).toBeDefined();

    // Even forcing the click never creates a session.
    fireEvent.click(startBtn);
    await flush();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("a not-logged-in claude blocks the create action", async () => {
    const startMock = vi.fn(async () => null);
    const store = makeStore({
      authStatus: { loggedIn: false, detail: "no account" },
      start: startMock,
    });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "blocked by auth" } });
    const startBtn = screen.getByLabelText("Start the session") as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(screen.getByText("Not logged in to claude.")).toBeDefined();
  });

  it("runs the auth pre-flight when a project loads", async () => {
    const store = makeStore({ authStatus: LOGGED_IN });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();
    expect(store.checkAuth).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // S4 — cortex-default launch (TRANCE-lite)
  // -------------------------------------------------------------------------

  it("S4: the Eidolon picker defaults to the Cortex option", async () => {
    render(<SessionsRoute projectPath="/proj" store={makeStore({ authStatus: LOGGED_IN })} />);
    await flush();

    // Open the optional disclosure to reveal the picker.
    fireEvent.click(screen.getByLabelText("Toggle session options"));
    const select = screen.getByLabelText("Select an Eidolon to launch") as HTMLSelectElement;
    // The pre-selected value is the synthetic Cortex sentinel — zero-effort
    // type-and-send opens a cortex session with NO picker interaction.
    expect(select.value).toBe("@cortex");
    expect(screen.getByText("Cortex (default)")).toBeDefined();
  });

  it("S4: creating a default session calls start with isCortex:true + the EIDOLONS.md descriptor", async () => {
    const startMock = vi.fn(async () => "cortex-session-id");
    const store = makeStore({ authStatus: LOGGED_IN, start: startMock });
    render(<SessionsRoute projectPath="/abs/project" store={store} />);
    await flush();

    // No picker interaction — the default IS Cortex.
    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "do the thing" } });
    fireEvent.click(screen.getByLabelText("Start the session"));
    await flush();

    expect(startMock).toHaveBeenCalledTimes(1);
    const params = startMock.mock.calls[0][0] as {
      isCortex: boolean;
      appendSystemPrompt: string;
      eidolonName: string;
      allowedTools: string[];
    };
    expect(params.isCortex).toBe(true);
    // The cortex routing descriptor is the session's system prompt.
    expect(params.appendSystemPrompt).toBe(EIDOLONS_MD);
    // A cortex session carries no named-Eidolon identity.
    expect(params.eidolonName).toBe("");
    // Cortex routing is dynamic — no over-restricted allow-list.
    expect(params.allowedTools).toEqual([]);
  });

  it("S4: picking a named Eidolon yields isCortex:false with that Eidolon's agent.md", async () => {
    const startMock = vi.fn(async () => "atlas-session-id");
    const store = makeStore({ authStatus: LOGGED_IN, start: startMock });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();

    // Explicit opt-in override — pick ATLAS in the disclosure picker.
    fireEvent.click(screen.getByLabelText("Toggle session options"));
    const select = screen.getByLabelText("Select an Eidolon to launch") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "atlas" } });

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "scout the repo" } });
    fireEvent.click(screen.getByLabelText("Start the session"));
    await flush();

    expect(startMock).toHaveBeenCalledTimes(1);
    const params = startMock.mock.calls[0][0] as {
      isCortex: boolean;
      appendSystemPrompt: string;
      eidolonName: string;
      allowedTools: string[];
    };
    expect(params.isCortex).toBe(false);
    expect(params.eidolonName).toBe("atlas");
    // The named Eidolon's agent.md is the persona — NOT the cortex descriptor.
    expect(params.appendSystemPrompt).toBe("---\nname: atlas\n---\npersona");
    expect(params.appendSystemPrompt).not.toBe(EIDOLONS_MD);
    // A named Eidolon carries its own allowed-tools contract.
    expect(params.allowedTools).toEqual(ATLAS.allowedTools);
  });

  it("S4: a project missing .eidolons/cortex/EIDOLONS.md degrades gracefully — no crash, no session", async () => {
    // The roster's Cortex entry is flagged unavailable (descriptor absent).
    readProjectRosterMock.mockResolvedValue([CORTEX_UNAVAILABLE, ATLAS]);
    const startMock = vi.fn(async () => null);
    const store = makeStore({ authStatus: LOGGED_IN, start: startMock });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();

    // The route still renders — no crash.
    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "this cannot route" } });
    // Cortex stays the pre-selected default; the launch guard catches it.
    fireEvent.click(screen.getByLabelText("Start the session"));
    await flush();

    // No session is created with a missing cortex descriptor.
    expect(startMock).not.toHaveBeenCalled();
    // A clear note is surfaced instead of a crash.
    expect(screen.getByText(/Cannot start a Cortex session/)).toBeDefined();
  });

  it("S4: a missing-descriptor project can still launch a named Eidolon override", async () => {
    readProjectRosterMock.mockResolvedValue([CORTEX_UNAVAILABLE, ATLAS]);
    const startMock = vi.fn(async () => "atlas-session-id");
    const store = makeStore({ authStatus: LOGGED_IN, start: startMock });
    render(<SessionsRoute projectPath="/proj" store={store} />);
    await flush();

    // Override to ATLAS — a real Eidolon is unaffected by the missing cortex.
    fireEvent.click(screen.getByLabelText("Toggle session options"));
    const select = screen.getByLabelText("Select an Eidolon to launch") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "atlas" } });

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "scout anyway" } });
    fireEvent.click(screen.getByLabelText("Start the session"));
    await flush();

    expect(startMock).toHaveBeenCalledTimes(1);
    const params = startMock.mock.calls[0][0] as { isCortex: boolean; eidolonName: string };
    expect(params.isCortex).toBe(false);
    expect(params.eidolonName).toBe("atlas");
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
