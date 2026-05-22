// ThinkingBlock.tsx — a collapsible `thinking` content block.
//
// The Eidolon's reasoning is secondary to its visible reply, so this stays
// collapsed by default — a quiet affordance the user can open on demand.

import type { ExpandSignal } from "@/components/session/ToolUseChip";
import { useEffect, useState } from "react";

interface ThinkingBlockProps {
  /** The reasoning payload from the `thinking` block. */
  thinking: string;
  /**
   * P3 bulk-collapse signal — a route-level "expand all / collapse all" pulse.
   * Each pulse syncs this block's `expanded` default to `value`; the user can
   * still toggle it individually afterwards. See {@link ExpandSignal}.
   */
  expandSignal?: ExpandSignal;
}

export function ThinkingBlock({ thinking, expandSignal }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  // P3: a bulk expand/collapse pulse syncs this block's `expanded` default.
  // It runs only on a fresh `nonce`, so per-block toggling between pulses is
  // never clobbered.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce is the intended trigger; value is read, not depended on
  useEffect(() => {
    if (!expandSignal) return;
    setExpanded(expandSignal.value);
  }, [expandSignal?.nonce]);

  return (
    <div className="session-thinking" data-expanded={String(expanded)}>
      <button
        type="button"
        className="session-thinking-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label="Reasoning"
      >
        <span
          className="session-thinking-chevron"
          data-expanded={String(expanded)}
          aria-hidden="true"
        >
          ›
        </span>
        <span className="session-thinking-icon" aria-hidden="true">
          ✦
        </span>
        <span className="session-thinking-label">Reasoning</span>
      </button>
      {expanded && <pre className="session-thinking-body">{thinking}</pre>}
    </div>
  );
}
