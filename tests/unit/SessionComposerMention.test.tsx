// SessionComposerMention.test.tsx — Vitest tests for the SessionComposer's
// @-file mention dropdown (story P9).
//
// Typing `@` opens a filtered file dropdown; picking a file inserts an
// `@relative/path` token into the draft. These tests mock the
// `list_project_files` invoke so no process / disk is touched, and drive the
// composer's textarea directly.
//
// Hermetic: `@tauri-apps/api/core` `invoke` is a `vi.fn()`.

import { SessionComposer } from "@/components/session/SessionComposer";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// composerPrefs touches localStorage — keep it deterministic + offline.
vi.mock("@/lib/composerPrefs", () => ({
  getEnterToSend: () => false,
  setEnterToSend: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_FILES = ["src/main.ts", "src/components/App.tsx", "README.md"];

/** Default `SessionComposer` props — overridable per test. */
function composerProps(overrides: Record<string, unknown> = {}) {
  return {
    mode: "create" as const,
    canSend: false,
    turnRunning: false,
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onCreate: vi.fn(),
    createReady: true,
    cwdBlockedReason: "",
    resolvedProjectPath: "/proj",
    eidolons: [],
    eidolonsLoaded: true,
    selectedEidolon: "",
    onSelectEidolon: vi.fn(),
    permissionModes: ["default"],
    permissionMode: "default",
    onSelectPermissionMode: vi.fn(),
    model: "default",
    onSelectModel: vi.fn(),
    thinkingEffort: "",
    onSelectThinkingEffort: vi.fn(),
    projectPath: "/proj",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionComposer @-mention picker (P9)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the file dropdown when an @ is typed", async () => {
    invokeMock.mockResolvedValue(PROJECT_FILES);
    render(<SessionComposer {...composerProps()} />);

    const textarea = screen.getByLabelText("New session prompt");
    fireEvent.change(textarea, { target: { value: "see @" } });

    // The lazy fetch fires once with the project path.
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_project_files", { projectPath: "/proj" });
    });
    // The dropdown lists the project files.
    await waitFor(() => {
      expect(screen.getByLabelText("Project files")).toBeTruthy();
    });
    expect(screen.getByText("src/main.ts")).toBeTruthy();
  });

  it("filters the dropdown by the query typed after @", async () => {
    invokeMock.mockResolvedValue(PROJECT_FILES);
    render(<SessionComposer {...composerProps()} />);

    const textarea = screen.getByLabelText("New session prompt");
    // Open the picker, then narrow it.
    fireEvent.change(textarea, { target: { value: "@" } });
    await waitFor(() => screen.getByLabelText("Project files"));
    fireEvent.change(textarea, { target: { value: "@readme" } });

    await waitFor(() => {
      expect(screen.getByText("README.md")).toBeTruthy();
    });
    expect(screen.queryByText("src/main.ts")).toBeNull();
  });

  it("picking a file inserts an @path token into the draft", async () => {
    invokeMock.mockResolvedValue(PROJECT_FILES);
    render(<SessionComposer {...composerProps()} />);

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "look at @main" } });
    await waitFor(() => screen.getByText("src/main.ts"));

    // Click the matching row — `onMouseDown` drives the pick.
    fireEvent.mouseDown(screen.getByText("src/main.ts"));

    await waitFor(() => {
      expect(textarea.value).toBe("look at @src/main.ts ");
    });
    // The dropdown closes after the pick.
    expect(screen.queryByLabelText("Project files")).toBeNull();
  });

  it("Escape dismisses the dropdown without inserting", async () => {
    invokeMock.mockResolvedValue(PROJECT_FILES);
    render(<SessionComposer {...composerProps()} />);

    const textarea = screen.getByLabelText("New session prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@src" } });
    await waitFor(() => screen.getByLabelText("Project files"));

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByLabelText("Project files")).toBeNull();
    // The draft text is untouched.
    expect(textarea.value).toBe("@src");
  });

  it("does not fetch the file list when there is no project path", () => {
    render(<SessionComposer {...composerProps({ projectPath: null })} />);
    const textarea = screen.getByLabelText("New session prompt");
    fireEvent.change(textarea, { target: { value: "@" } });
    // No project → no fetch, no dropdown.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Project files")).toBeNull();
  });
});
