// ContextGauge.tsx — always-visible context-temperature gauge (story S5).
//
// Per-turn token/cost data already arrives end-to-end on the `result` event
// (FINDING-007) and the serving model on `system/init`, but nothing shows the
// user how FULL the context window is — so a multi-turn session drifts toward
// exhaustion-driven hallucination with no warning. This gauge mounts in the
// session detail header and answers, always-visible, "how hot is the context
// RIGHT NOW".
//
// Two readings, derived purely from the session slice:
//
//   * Temperature bar — the LATEST completed turn's input-side token count
//       (inputTokens + cacheReadInputTokens + cacheCreationInputTokens)
//     over `contextWindowFor(model)`. This is a SNAPSHOT, not a cumulative
//     sum: it is how full the window was on the most recent turn. Because it
//     reads the latest turn, a `compact_boundary` re-baselines the gauge on
//     its own — the next `result` after a compaction naturally reports a
//     smaller input-side count (see `compactBoundarySeen`).
//
//   * Cumulative figures — total tokens + estimated cost across the WHOLE
//     session, summed from every `result` event (or read from the record's
//     `cumulativeUsage` / `cumulativeCostUsd` when present). The cost is a
//     client-side estimate, not billing-authoritative, and is labelled "est.".
//
// Story S7 — live mid-turn updates: the same `stream_event` parser pass that
// feeds S6 also extracts incremental `usage` from `message_start` /
// `message_delta`, surfaced on the slice's EPHEMERAL `live.usage`. When a
// live figure is present AND belongs to a turn newer than the latest `result`,
// the bar PREVIEWS it — so the gauge moves mid-turn. The authoritative
// `result` usage re-baselines the bar at turn end (the store clears `live` on
// `session-turn-complete`), so there is no double-counting: the live figure is
// strictly a preview the `result` supersedes.
//
// With no completed turn AND no live usage the gauge renders a neutral empty
// state.

import { contextWindowFor } from "@/lib/contextWindow";
import type { ParsedInit, ParsedResult, Usage } from "@/lib/session.types";
import type { TranscriptEntry } from "@/lib/useSession";
import type { SessionSlice } from "@/lib/useSessions";
import { useMemo } from "react";
import "./ContextGauge.css";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Input-side token count of a turn — the "how full is the window" number. */
function inputSideTokens(usage: Usage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.cacheReadInputTokens ?? 0) +
    (usage.cacheCreationInputTokens ?? 0)
  );
}

/** Map a 0..1 temperature to an existing status tone (no new colors). */
function temperatureTone(temperature: number): string {
  if (temperature >= 0.85) return "error";
  if (temperature >= 0.6) return "warn";
  return "ok";
}

/** Format a token count compactly: 1234 -> "1.2k", 1_200_000 -> "1.2M". */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Whether the transcript carries a `compact_boundary` marker AFTER the latest
 * `result` — best-effort, since claude-code's `compact_boundary` field names
 * are [UNVERIFIED] (spec GAP-1).
 *
 * Detection is deliberately loose: a `system`/`compact_boundary` shaped event
 * OR any `unknown`-kind entry whose raw JSON merely CONTAINS the string
 * `compact_boundary`. This never throws on an unrecognised shape — the worst
 * case is it returns `false` and the gauge relies on its always-correct
 * fallback (the next `result` re-baselines the bar downward on its own).
 */
function compactBoundarySeen(transcript: TranscriptEntry[]): boolean {
  for (const entry of transcript) {
    if (entry.source !== "event") continue;
    const kind = entry.kind ?? "";
    if (kind === "compact_boundary" || kind === "compactBoundary") return true;
    // An unmodelled line lands as `unknown` — sniff its raw JSON text.
    if (kind === "unknown" && entry.line.includes("compact_boundary")) return true;
  }
  return false;
}

/** The reading the gauge renders — derived once per transcript change. */
interface GaugeReading {
  /** `true` once at least one turn has completed (a `result` was seen). */
  hasTurn: boolean;
  /** Serving model id from `system/init`, or `null` if not yet seen. */
  model: string | null;
  /** Context-window denominator for `model`. */
  window: number;
  /** Latest turn's input-side token count (the bar's numerator). */
  latestInputTokens: number;
  /** Latest turn's input-side count over the window, clamped to 0..1. */
  temperature: number;
  /** Cumulative tokens (input + output, cache included) across the session. */
  cumulativeTokens: number;
  /** Cumulative estimated cost in USD across the session. */
  cumulativeCostUsd: number;
  /** `true` if a `compact_boundary` marker followed the latest result. */
  compacted: boolean;
}

/**
 * Derive the gauge reading from a session slice.
 *
 * The latest `result` event drives the temperature bar; the cumulative figures
 * prefer the persisted record totals (`summary.cumulative*`) and fall back to
 * summing the transcript's `result` events when the record is summary-only or
 * not yet flushed.
 */
export function deriveGaugeReading(slice: SessionSlice | null): GaugeReading {
  const empty: GaugeReading = {
    hasTurn: false,
    model: null,
    window: contextWindowFor(null),
    latestInputTokens: 0,
    temperature: 0,
    cumulativeTokens: 0,
    cumulativeCostUsd: 0,
    compacted: false,
  };
  if (!slice) return empty;

  const transcript = slice.transcript;

  // Model — the latest `init`-kind entry (a session re-init is rare but the
  // freshest one wins).
  let model: string | null = null;
  for (const entry of transcript) {
    if (entry.source === "event" && entry.kind === "init" && entry.parsed) {
      model = (entry.parsed as ParsedInit).Init?.model ?? model;
    }
  }

  // Walk every `result` entry: the LAST one drives the bar; all of them sum
  // into the transcript-derived cumulative fallback.
  let latestUsage: Usage | null = null;
  let latestResultTurn = 0;
  let summedInput = 0;
  let summedOutput = 0;
  let summedCost = 0;
  for (const entry of transcript) {
    if (entry.source !== "event" || entry.kind !== "result" || !entry.parsed) continue;
    const result = (entry.parsed as ParsedResult).Result;
    if (!result) continue;
    latestUsage = result.usage ?? {};
    latestResultTurn = entry.turn;
    const u = result.usage ?? {};
    summedInput +=
      (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
    summedOutput += u.outputTokens ?? 0;
    summedCost += result.totalCostUsd ?? 0;
  }

  // Story S7 — live mid-turn preview: an ephemeral `live.usage` from a turn
  // NEWER than the latest finalised `result` drives the bar instead, so the
  // gauge advances mid-turn. The `result` re-baselines once the turn ends.
  const liveUsage = slice.live.usage;
  const liveIsAhead = liveUsage != null && slice.live.turn > latestResultTurn;
  if (liveIsAhead) {
    latestUsage = {
      inputTokens: liveUsage.inputTokens ?? undefined,
      outputTokens: liveUsage.outputTokens ?? undefined,
      cacheReadInputTokens: liveUsage.cacheReadInputTokens ?? undefined,
      cacheCreationInputTokens: liveUsage.cacheCreationInputTokens ?? undefined,
    };
  }

  if (!latestUsage) {
    // No completed turn AND no live usage — neutral empty gauge, keep model.
    return { ...empty, model };
  }

  const window = contextWindowFor(model);
  const latestInputTokens = inputSideTokens(latestUsage);
  const temperature = window > 0 ? Math.min(1, Math.max(0, latestInputTokens / window)) : 0;

  // Cumulative figures — prefer the persisted record totals (authoritative
  // across app restarts), fall back to the transcript sum for a live session
  // whose record has not flushed yet.
  const record = slice.summary;
  const cumulativeInput = record?.cumulativeInputTokens ?? 0;
  const cumulativeOutput = record?.cumulativeOutputTokens ?? 0;
  const recordTokens = cumulativeInput + cumulativeOutput;
  const recordCost = record?.cumulativeCostUsd ?? 0;

  const cumulativeTokens = recordTokens > 0 ? recordTokens : summedInput + summedOutput;
  const cumulativeCostUsd = recordCost > 0 ? recordCost : summedCost;

  return {
    hasTurn: true,
    model,
    window,
    latestInputTokens,
    temperature,
    cumulativeTokens,
    cumulativeCostUsd,
    compacted: compactBoundarySeen(transcript),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContextGaugeProps {
  /** The session slice the gauge reads its inputs from; `null` renders empty. */
  slice: SessionSlice | null;
}

/**
 * Always-visible context-temperature gauge for the session detail header.
 *
 * Recomputes on each transcript change (i.e. when a new `result` lands) — no
 * polling. Renders a neutral empty state until the first turn completes.
 */
export function ContextGauge({ slice }: ContextGaugeProps) {
  const reading = useMemo(() => deriveGaugeReading(slice), [slice]);

  if (!reading.hasTurn) {
    return (
      <div className="context-gauge" data-empty="true" role="group" aria-label="Context usage">
        <div className="context-gauge-head">
          <span className="context-gauge-label">Context</span>
          <span className="context-gauge-empty-note">no turn yet</span>
        </div>
        <div className="context-gauge-bar" data-tone="ok" aria-hidden="true">
          <div className="context-gauge-fill" style={{ width: "0%" }} />
        </div>
      </div>
    );
  }

  const tone = temperatureTone(reading.temperature);
  const pct = Math.round(reading.temperature * 100);
  const costLabel = `~$${reading.cumulativeCostUsd.toFixed(4)} est.`;

  return (
    <div
      className="context-gauge"
      data-tone={tone}
      role="group"
      aria-label={`Context usage ${pct}%`}
    >
      <div className="context-gauge-head">
        <span className="context-gauge-label">Context</span>
        <span className="context-gauge-pct" data-tone={tone}>
          {pct}%
        </span>
        {reading.compacted && (
          <span className="context-gauge-compact" title="Context was compacted">
            compacted
          </span>
        )}
      </div>

      <div
        className="context-gauge-bar"
        data-tone={tone}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="context-gauge-fill" data-tone={tone} style={{ width: `${pct}%` }} />
      </div>

      <div className="context-gauge-meta">
        <span className="context-gauge-meta-item">
          <span className="context-gauge-meta-key">window</span>
          <span className="context-gauge-meta-val">
            {fmtTokens(reading.latestInputTokens)} / {fmtTokens(reading.window)}
          </span>
        </span>
        <span className="context-gauge-meta-item">
          <span className="context-gauge-meta-key">session</span>
          <span className="context-gauge-meta-val">{fmtTokens(reading.cumulativeTokens)} tok</span>
        </span>
        <span className="context-gauge-meta-item">
          <span className="context-gauge-meta-key">cost</span>
          <span className="context-gauge-meta-val">{costLabel}</span>
        </span>
      </div>
    </div>
  );
}
