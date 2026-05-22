// ContextGauge.test.tsx — Vitest component tests for the context-temperature
// gauge (story S5).
//
// Coverage:
//   * a slice with a completed `result` turn → the bar reflects
//       (inputTokens + cacheReadInputTokens + cacheCreationInputTokens) / window
//     and the cumulative cost shows as an "est." figure;
//   * no completed turn → the neutral empty state, no crash;
//   * `deriveGaugeReading` temperature math (the pure helper);
//   * a `compact_boundary`-shaped event never crashes the gauge.
//
// Hermetic: a hand-built `SessionSlice` — no process, no disk, no Tauri.

import { ContextGauge, deriveGaugeReading } from "@/components/session/ContextGauge";
import type { ParsedInit, ParsedResult, Usage } from "@/lib/session.types";
import type { TranscriptEntry } from "@/lib/useSession";
import type { SessionSlice } from "@/lib/useSessions";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A `system/init` transcript entry carrying a model id. */
function initEntry(model: string, turn = 1): TranscriptEntry {
  const parsed: ParsedInit = { Init: { sessionId: "s1", model, tools: [] } };
  return { source: "event", turn, kind: "init", parsed, line: "{}", ts: "2026-05-22T10:00:00Z" };
}

/** A terminal `result` transcript entry carrying usage + cost. */
function resultEntry(usage: Usage, costUsd: number, turn = 1): TranscriptEntry {
  const parsed: ParsedResult = {
    Result: {
      subtype: "success",
      sessionId: "s1",
      isError: false,
      totalCostUsd: costUsd,
      usage,
    },
  };
  return { source: "event", turn, kind: "result", parsed, line: "{}", ts: "2026-05-22T10:01:00Z" };
}

/** Build a `SessionSlice` around a transcript. */
function makeSlice(transcript: TranscriptEntry[]): SessionSlice {
  return {
    sessionId: "s1",
    status: "awaiting-input",
    transcript,
    sessionInfo: null,
    summary: null,
    turn: transcript.length,
    hydrated: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ContextGauge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the neutral empty state when no turn has completed", () => {
    render(<ContextGauge slice={makeSlice([initEntry("claude-opus-4-7")])} />);
    const gauge = screen.getByRole("group", { name: /context usage/i });
    expect(gauge.getAttribute("data-empty")).toBe("true");
    expect(screen.getByText(/no turn yet/i)).toBeTruthy();
  });

  it("renders the empty state for a null slice without crashing", () => {
    render(<ContextGauge slice={null} />);
    expect(screen.getByText(/no turn yet/i)).toBeTruthy();
  });

  it("reflects (input + cacheRead + cacheCreation) / window on the bar", () => {
    // 100k + 50k + 50k = 200k input-side over a 1M Opus 4.7 window → 20%.
    const usage: Usage = {
      inputTokens: 100_000,
      outputTokens: 5_000,
      cacheReadInputTokens: 50_000,
      cacheCreationInputTokens: 50_000,
    };
    render(
      <ContextGauge
        slice={makeSlice([initEntry("claude-opus-4-7"), resultEntry(usage, 0.0123)])}
      />,
    );
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("20");
  });

  it("labels the cumulative cost as an estimate", () => {
    const usage: Usage = { inputTokens: 1_000, outputTokens: 100 };
    render(<ContextGauge slice={makeSlice([initEntry("sonnet-4-5"), resultEntry(usage, 0.5)])} />);
    expect(screen.getByText(/~\$0\.5000 est\./)).toBeTruthy();
  });

  it("does not crash on a compact_boundary-shaped event", () => {
    const usage: Usage = { inputTokens: 10_000, outputTokens: 100 };
    const compact: TranscriptEntry = {
      source: "event",
      turn: 1,
      kind: "unknown",
      parsed: { Unknown: { raw: '{"type":"system","subtype":"compact_boundary"}' } },
      line: '{"type":"system","subtype":"compact_boundary"}',
      ts: "2026-05-22T10:02:00Z",
    };
    render(
      <ContextGauge
        slice={makeSlice([initEntry("claude-opus-4-7"), resultEntry(usage, 0.01), compact])}
      />,
    );
    expect(screen.getByText(/compacted/i)).toBeTruthy();
  });
});

describe("deriveGaugeReading", () => {
  it("returns the empty reading for a null slice", () => {
    const r = deriveGaugeReading(null);
    expect(r.hasTurn).toBe(false);
    expect(r.temperature).toBe(0);
  });

  it("computes temperature from the LATEST result turn, not a cumulative sum", () => {
    // Two turns: the second is the live reading — 300k / 1M = 0.3.
    const t1 = resultEntry({ inputTokens: 500_000 }, 0.1, 1);
    const t2 = resultEntry({ inputTokens: 300_000 }, 0.1, 2);
    const r = deriveGaugeReading(makeSlice([initEntry("opus-4-7"), t1, t2]));
    expect(r.temperature).toBeCloseTo(0.3, 5);
    expect(r.latestInputTokens).toBe(300_000);
  });

  it("clamps temperature to 1 when the window overflows", () => {
    const r = deriveGaugeReading(
      makeSlice([initEntry("sonnet-4-5"), resultEntry({ inputTokens: 999_999_999 }, 0, 1)]),
    );
    expect(r.temperature).toBe(1);
  });

  it("sums cumulative tokens + cost across every result turn", () => {
    const t1 = resultEntry({ inputTokens: 1_000, outputTokens: 200 }, 0.02, 1);
    const t2 = resultEntry({ inputTokens: 2_000, outputTokens: 300 }, 0.03, 2);
    const r = deriveGaugeReading(makeSlice([initEntry("opus-4-7"), t1, t2]));
    // input-side(1000) + output(200) + input-side(2000) + output(300) = 3500.
    expect(r.cumulativeTokens).toBe(3_500);
    expect(r.cumulativeCostUsd).toBeCloseTo(0.05, 5);
  });
});
