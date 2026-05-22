// ToolUseChip.test.tsx — Vitest component tests for the live tool chip (S6).
//
// Coverage:
//   * a running chip (session-tool-start, no tool_result yet) shows a spinner
//     and an elapsed-time readout;
//   * the chip resolves to an ok/error outcome dot once a paired tool_result
//     is supplied — the spinner is gone;
//   * a subagent-tagged chip (parentToolUseId) renders the "subagent" marker;
//   * the existing collapsed/expand behaviour still works.
//
// Hermetic: no process, no Tauri — props only.

import { ToolUseChip } from "@/components/session/ToolUseChip";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("ToolUseChip", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a spinner + elapsed readout while running (no tool_result yet)", () => {
    const { container } = render(
      <ToolUseChip name="Read" input={{ file: "/a" }} running={true} startedAt={Date.now()} />,
    );
    expect(container.querySelector(".session-tool-spinner")).toBeTruthy();
    expect(container.querySelector(".session-tool-elapsed")).toBeTruthy();
    expect(container.querySelector(".session-tool")?.getAttribute("data-outcome")).toBe("running");
  });

  it("resolves to an ok outcome once a paired tool_result lands", () => {
    const { container } = render(
      <ToolUseChip
        name="Read"
        input={{ file: "/a" }}
        running={true}
        startedAt={Date.now()}
        result={{ text: "file contents", isError: false }}
      />,
    );
    // A landed result supersedes the running state — spinner gone, dot shown.
    expect(container.querySelector(".session-tool-spinner")).toBeNull();
    expect(container.querySelector(".session-tool")?.getAttribute("data-outcome")).toBe("ok");
    expect(container.querySelector('.session-tool-dot[data-outcome="ok"]')).toBeTruthy();
  });

  it("resolves to an error outcome when the tool_result reports an error", () => {
    const { container } = render(
      <ToolUseChip name="Bash" input="ls" result={{ text: "command failed", isError: true }} />,
    );
    expect(container.querySelector(".session-tool")?.getAttribute("data-outcome")).toBe("error");
  });

  it("tags self-routed subagent work with a subagent marker", () => {
    const { container } = render(
      <ToolUseChip name="Grep" input={{}} running={true} startedAt={Date.now()} subagent={true} />,
    );
    expect(screen.getByText("subagent")).toBeTruthy();
    expect(container.querySelector(".session-tool")?.getAttribute("data-subagent")).toBe("true");
  });

  it("keeps the collapsed/expand behaviour for a resolved result", () => {
    render(
      <ToolUseChip
        name="Read"
        input={{ file: "/a" }}
        result={{ text: "expandable body", isError: false }}
      />,
    );
    // Collapsed by default — the result body is not shown.
    expect(screen.queryByText("expandable body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /tool call: read/i }));
    expect(screen.getByText("expandable body")).toBeTruthy();
  });
});
