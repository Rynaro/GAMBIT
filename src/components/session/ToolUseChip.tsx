// ToolUseChip.tsx — a compact chip for a `tool_use` content block.
//
// Shows the tool name + a one-line peek at its input, and — when a paired
// `tool_result` is supplied — an outcome dot (ok / error) and an expandable
// result body. The pairing is done by the caller (SessionsRoute) which has
// the whole transcript and can match `tool_use.id` ↔ `tool_result.toolUseId`.
//
// Story S6 — live "running" state: while a turn streams, a tool call appears
// from the ephemeral `session-tool-start` event BEFORE any `tool_result`. In
// that window the chip shows a spinner + a live elapsed-time readout; it
// resolves to the ok/error dot once the paired `tool_result` lands. A tool
// call carrying a `parentToolUseId` is self-routed-subagent work — the caller
// renders it nested/indented (see SessionsRoute), and the chip itself flags it
// with a subagent tag.

import { CopyButton } from "@/components/session/CopyButton";
import { useEffect, useState } from "react";

interface ToolUseChipProps {
  /** Tool name from the `tool_use` block ("tool" when absent). */
  name: string;
  /** Raw tool input — shape varies per tool; peeked into a one-liner. */
  input: unknown;
  /** Paired `tool_result` content, when one was found. */
  result?: {
    /** Stringified result content. */
    text: string;
    /** Whether the tool_result reported an error. */
    isError: boolean;
  };
  /**
   * Live-state props (story S6). `running` is `true` while the tool call is
   * in flight — a `session-tool-start` was seen but no `tool_result` yet.
   * `startedAt` (epoch-ms) drives the elapsed-time readout; `subagent` tags
   * self-routed (parentToolUseId-carrying) work.
   */
  running?: boolean;
  startedAt?: number;
  subagent?: boolean;
  /**
   * P3 bulk-collapse signal — a route-level "expand all / collapse all" pulse.
   * Each pulse (a fresh `nonce`) syncs the chip's `expanded` default to
   * `value`; the user can still toggle the chip individually afterwards. When
   * absent the chip simply keeps its own local state. See {@link ExpandSignal}.
   */
  expandSignal?: ExpandSignal;
}

/**
 * A transcript-level bulk expand/collapse pulse (P3).
 *
 * `value` is the desired expanded state; `nonce` makes every pulse distinct so
 * a `useEffect` re-fires even when the same `value` is requested twice (e.g.
 * "collapse all" after the user hand-expanded one chip). It is a *default*
 * sync, not a lock — per-chip toggling stays live between pulses.
 */
export interface ExpandSignal {
  /** The desired expanded state to sync every chip / block to. */
  value: boolean;
  /** A monotonically-increasing pulse id — distinguishes repeat requests. */
  nonce: number;
}

/** Collapse an arbitrary tool-input value into a short single-line peek. */
function peekInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/** Format an elapsed-ms span compactly: 840 -> "0.8s", 12400 -> "12.4s". */
function fmtElapsed(ms: number): string {
  if (ms < 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * A live elapsed-time readout — ticks once per second while `running`, then
 * freezes at the final span when the tool resolves.
 */
function ElapsedReadout({ startedAt, running }: { startedAt: number; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Frozen once resolved; ticking while running.
  const elapsed = running ? now - startedAt : Math.max(0, now - startedAt);
  return (
    <span className="session-tool-elapsed" aria-hidden="true">
      {fmtElapsed(elapsed)}
    </span>
  );
}

export function ToolUseChip({
  name,
  input,
  result,
  running = false,
  startedAt,
  subagent = false,
  expandSignal,
}: ToolUseChipProps) {
  const [expanded, setExpanded] = useState(false);
  const peek = peekInput(input);
  const hasResult = Boolean(result);
  const hasResultBody = hasResult && Boolean(result?.text.trim());
  // R2: the input peek is gated behind expand — a collapsed chip is a bare
  // name + outcome dot. The chip is toggleable whenever expanding would reveal
  // *something*: either the input peek OR a non-empty result body.
  const toggleable = hasResultBody || Boolean(peek);
  // The chip is "live" while a tool-start was seen and no result has landed.
  const isRunning = running && !hasResult;
  const outcome = result ? (result.isError ? "error" : "ok") : isRunning ? "running" : "pending";

  // P3: a bulk expand/collapse pulse syncs this chip's `expanded` default.
  // It runs only on a fresh `nonce`, so per-chip toggling between pulses is
  // never clobbered. `toggleable` gates it — a chip with nothing to reveal
  // stays collapsed regardless of the signal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce is the intended trigger; value/toggleable are read, not depended on
  useEffect(() => {
    if (!expandSignal) return;
    setExpanded(expandSignal.value && toggleable);
  }, [expandSignal?.nonce]);

  return (
    <div className="session-tool" data-outcome={outcome} data-subagent={String(subagent)}>
      <button
        type="button"
        className="session-tool-chip"
        onClick={() => toggleable && setExpanded((prev) => !prev)}
        aria-expanded={toggleable ? expanded : undefined}
        aria-label={`Tool call: ${name}${isRunning ? " (running)" : ""}`}
      >
        {isRunning ? (
          <span className="session-tool-spinner" aria-hidden="true" />
        ) : (
          <span className="session-tool-icon" aria-hidden="true">
            ⚙
          </span>
        )}
        <span className="session-tool-name">{name}</span>
        {subagent && (
          <span className="session-tool-subagent-tag" title="Self-routed subagent work">
            subagent
          </span>
        )}
        {/* R2: the input peek is revealed only once the chip is expanded —
            a collapsed chip stays a bare name + outcome dot. */}
        {expanded && peek && <span className="session-tool-peek">{peek}</span>}
        {isRunning && typeof startedAt === "number" && (
          <ElapsedReadout startedAt={startedAt} running={true} />
        )}
        {hasResult && (
          <span
            className="session-tool-dot"
            data-outcome={result?.isError ? "error" : "ok"}
            aria-hidden="true"
          />
        )}
        {toggleable && (
          <span
            className="session-tool-chevron"
            data-expanded={String(expanded)}
            aria-hidden="true"
          >
            ›
          </span>
        )}
      </button>

      {expanded && result && (
        <div className="session-tool-result-wrap">
          {/* P5: hover copy affordance on the tool-result body. */}
          <CopyButton
            value={result.text}
            label={`Copy ${name} result`}
            className="session-copy-btn--overlay"
          />
          <pre className="session-tool-result" data-error={String(result.isError)}>
            {result.text}
          </pre>
        </div>
      )}
    </div>
  );
}
