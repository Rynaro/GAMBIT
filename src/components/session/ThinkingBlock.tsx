// ThinkingBlock.tsx — a collapsible `thinking` content block.
//
// The Eidolon's reasoning is secondary to its visible reply, so this stays
// collapsed by default — a quiet affordance the user can open on demand.

import { useState } from "react";

interface ThinkingBlockProps {
  /** The reasoning payload from the `thinking` block. */
  thinking: string;
}

export function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

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
