// HighlightedText.tsx — render plain text with the transcript-find query
// highlighted (story P10).
//
// The in-transcript find bar highlights matches in the visible transcript. For
// the plain-text surfaces the route fully controls — the user-prompt bubble
// and stderr lines — this component wraps each case-insensitive occurrence of
// the active query in a `<mark>` so the matches are visible. Assistant text is
// markdown-rendered elsewhere; the find bar still counts + scrolls to it, but
// only these plain surfaces get the inline `<mark>`.

import { Fragment } from "react";

interface HighlightedTextProps {
  /** The plain text to render. */
  text: string;
  /** The active find query — empty disables highlighting (plain text). */
  query: string;
}

/** Split `text` into highlighted / plain runs around `query` occurrences. */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const q = query.trim();
  if (q.length === 0) return <>{text}</>;

  const haystack = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      parts.push({ text: text.slice(from), match: false });
      break;
    }
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }

  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional runs of a stable string
          <mark key={i} className="session-find-hit">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional runs of a stable string
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
