// parseAnsi.ts — Thin wrapper around `anser` that converts an ANSI-escaped
// string into a flat list of styled tokens suitable for React rendering.
//
// Each token carries:
//   text  — the raw text content (may be empty for pure-escape runs)
//   class — CSS class string to apply (e.g. "ansi-red-fg ansi-bold")
//
// Designed to be stable (same input → same output), pure (no side-effects),
// and cheap to import in Vitest unit tests.

import Anser from "anser";

export interface AnsiToken {
  text: string;
  /** Space-separated CSS class string, or empty string for unstyled runs. */
  class: string;
}

/**
 * Parse `line` into an array of ANSI-styled tokens.
 *
 * Pass `escapeHtml: false` because GAMBIT renders tokens as text content
 * (React escapes the text itself); we do not want double-escaping.
 */
export function parseAnsi(line: string): AnsiToken[] {
  if (!line) return [{ text: "", class: "" }];

  // anser returns an array of objects with .content and .classes
  const spans = Anser.ansiToJson(line, { use_classes: true, remove_empty: false });

  return spans.map((span) => ({
    text: span.content,
    class: span.classes ?? "",
  }));
}
