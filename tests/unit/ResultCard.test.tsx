// ResultCard.test.tsx — Vitest component tests for the terminal result card.
//
// Coverage (story S0 — surface claude-code permission denials):
//   * a non-empty `permissionDenials` renders the warning notice listing the
//     distinct denied tool names;
//   * an empty `permissionDenials` renders nothing extra — the normal card is
//     unchanged (no regression).
//
// Hermetic: a plain render of the component — no process, no disk, no Tauri.

import { ResultCard } from "@/components/session/ResultCard";
import type { PermissionDenial } from "@/lib/session.types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/** A `PermissionDenial` fixture. */
function denial(toolName: string, id: string): PermissionDenial {
  return { toolName, toolUseId: id, toolInput: {} };
}

describe("ResultCard — permission-denial notice (S0)", () => {
  it("renders the denial notice with the distinct denied tool names", () => {
    render(
      <ResultCard
        subtype="success"
        isError={false}
        totalCostUsd={0.01}
        numTurns={2}
        durationMs={3000}
        permissionDenials={[
          denial("Write", "toolu_1"),
          denial("Bash", "toolu_2"),
          denial("Write", "toolu_3"),
        ]}
      />,
    );

    const alert = screen.getByRole("alert");
    // The count is the raw denial count (3), not the distinct-tool count.
    expect(alert.textContent).toContain("3 tool calls were denied");
    // Distinct tool names listed, first-seen order, no duplicate "Write".
    expect(alert.textContent).toContain("Write, Bash");
    // The hint points at the composer's permission-mode option.
    expect(alert.textContent).toContain("permission mode");
  });

  it("singularises the count for a single denial", () => {
    render(
      <ResultCard
        subtype="success"
        isError={false}
        totalCostUsd={null}
        numTurns={null}
        durationMs={null}
        permissionDenials={[denial("Write", "toolu_1")]}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("1 tool call was denied");
  });

  it("renders nothing extra when permissionDenials is empty", () => {
    render(
      <ResultCard
        subtype="success"
        isError={false}
        totalCostUsd={0.01}
        numTurns={2}
        durationMs={3000}
        permissionDenials={[]}
      />,
    );
    // The only `role` on the card is the `status` wrapper — no `alert`.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).not.toContain("denied");
  });

  it("renders nothing extra when permissionDenials is omitted", () => {
    render(
      <ResultCard
        subtype="success"
        isError={false}
        totalCostUsd={null}
        numTurns={null}
        durationMs={null}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
