// ToolUseChip.tsx — a compact chip for a `tool_use` content block.
//
// Shows the tool name + a one-line peek at its input, and — when a paired
// `tool_result` is supplied — an outcome dot (ok / error) and an expandable
// result body. The pairing is done by the caller (SessionsRoute) which has
// the whole transcript and can match `tool_use.id` ↔ `tool_result.toolUseId`.

import { useState } from "react";

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

export function ToolUseChip({ name, input, result }: ToolUseChipProps) {
  const [expanded, setExpanded] = useState(false);
  const peek = peekInput(input);
  const hasResult = Boolean(result);
  const toggleable = hasResult && Boolean(result?.text.trim());

  return (
    <div
      className="session-tool"
      data-outcome={result ? (result.isError ? "error" : "ok") : "pending"}
    >
      <button
        type="button"
        className="session-tool-chip"
        onClick={() => toggleable && setExpanded((prev) => !prev)}
        aria-expanded={toggleable ? expanded : undefined}
        aria-label={`Tool call: ${name}`}
      >
        <span className="session-tool-icon" aria-hidden="true">
          ⚙
        </span>
        <span className="session-tool-name">{name}</span>
        {peek && <span className="session-tool-peek">{peek}</span>}
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
        <pre className="session-tool-result" data-error={String(result.isError)}>
          {result.text}
        </pre>
      )}
    </div>
  );
}
