// SessionList.test.tsx — Vitest tests for the Sessions rail filter (story P10).
//
// P10 adds a search input above the rail that narrows the rendered sessions by
// title / Eidolon name (case-insensitive substring). The tests exercise the
// pure `filterRail` helper directly and drive the rendered filter input.
//
// Hermetic: a hand-built `SessionSlice` map — no store, no Tauri, no process.

import { SessionList, filterRail } from "@/components/session/SessionList";
import type { SessionSlice } from "@/lib/useSessions";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a `SessionSlice` with a given title + Eidolon name. */
function makeSlice(uuid: string, title: string, eidolonName: string): SessionSlice {
  return {
    sessionId: uuid,
    status: "awaiting-input",
    transcript: [],
    sessionInfo: {
      sessionId: uuid,
      eidolonName,
      projectPath: "/proj",
      permissionMode: "default",
      status: "awaiting-input",
      createdAt: "2026-05-20T10:00:00+00:00",
      isCortex: false,
    },
    summary: {
      uuid,
      eidolonName,
      isCortex: false,
      title,
      projectPath: "/proj",
      status: "awaiting-input",
      model: null,
      createdAt: "2026-05-20T10:00:00+00:00",
      lastActiveAt: "2026-05-20T10:00:00+00:00",
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      cumulativeCostUsd: 0,
    },
    turn: 1,
    hydrated: false,
    live: { turn: 0, streamingText: "", toolCalls: {}, usage: null },
  };
}

const SESSIONS: Record<string, SessionSlice> = {
  a: makeSlice("a", "Refactor the auth module", "atlas"),
  b: makeSlice("b", "Write the changelog", "sage"),
  c: makeSlice("c", "Fix the build", "atlas"),
};

const noop = () => {};

describe("SessionList rail filter (P10)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("filterRail (pure helper)", () => {
    const rows = Object.values(SESSIONS);

    it("passes every row through for an empty query", () => {
      expect(filterRail(rows, "")).toHaveLength(3);
      expect(filterRail(rows, "   ")).toHaveLength(3);
    });

    it("narrows rows by a case-insensitive title substring", () => {
      const out = filterRail(rows, "AUTH");
      expect(out).toHaveLength(1);
      expect(out[0].sessionId).toBe("a");
    });

    it("also matches the Eidolon name", () => {
      const out = filterRail(rows, "atlas");
      expect(out.map((r) => r.sessionId).sort()).toEqual(["a", "c"]);
    });

    it("returns nothing when no row matches", () => {
      expect(filterRail(rows, "nonexistent")).toEqual([]);
    });
  });

  describe("rendered filter input", () => {
    it("narrows the visible rows as the user types", () => {
      render(
        <SessionList
          sessions={SESSIONS}
          activeSessionId={null}
          onSelect={noop}
          onNewSession={noop}
          onRemove={noop}
          onFork={noop}
        />,
      );

      // All three sessions render initially.
      expect(screen.getByText("Refactor the auth module")).toBeTruthy();
      expect(screen.getByText("Write the changelog")).toBeTruthy();
      expect(screen.getByText("Fix the build")).toBeTruthy();

      const input = screen.getByLabelText("Filter sessions by title or Eidolon");
      fireEvent.change(input, { target: { value: "changelog" } });

      // Only the matching row survives the filter.
      expect(screen.getByText("Write the changelog")).toBeTruthy();
      expect(screen.queryByText("Refactor the auth module")).toBeNull();
      expect(screen.queryByText("Fix the build")).toBeNull();
    });

    it("shows a no-match message when the filter matches nothing", () => {
      render(
        <SessionList
          sessions={SESSIONS}
          activeSessionId={null}
          onSelect={noop}
          onNewSession={noop}
          onRemove={noop}
          onFork={noop}
        />,
      );
      const input = screen.getByLabelText("Filter sessions by title or Eidolon");
      fireEvent.change(input, { target: { value: "zzz" } });
      expect(screen.getByText(/No sessions match/)).toBeTruthy();
    });
  });
});
