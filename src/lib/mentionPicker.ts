// mentionPicker.ts — pure helpers for the SessionComposer's `@`-file mention
// picker (story P9).
//
// Typing `@` in the composer should open a filtered dropdown of the project's
// files; picking one inserts an `@relative/path` token at the caret. All the
// non-React logic lives here so it is directly Vitest-testable: detecting the
// active `@token` at the caret, filtering the file list by its query, and
// computing the post-pick draft + caret position.
//
// An ACTIVE mention is an `@` that the caret currently sits inside the token
// of: the `@` is at a word boundary (start of text, or preceded by whitespace)
// and every character between it and the caret is a valid path character (no
// whitespace). Once the user types a space the token closes and the dropdown
// dismisses — `detectMention` returns `null`.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An active `@`-mention token under the caret.
 *
 * `start` is the index of the `@`; `query` is the text between the `@` and the
 * caret (empty right after typing the bare `@`). The composer filters the file
 * list by `query` and, on pick, splices the replacement over `[start, caret)`.
 */
export interface MentionContext {
  /** Index of the `@` character in the draft. */
  start: number;
  /** The query text between the `@` and the caret (no leading `@`). */
  query: string;
}

/** The result of applying a picked file path to the draft. */
export interface MentionInsertion {
  /** The new draft text with `@<path>` spliced in. */
  text: string;
  /** The caret position after the inserted token (just past the trailing space). */
  caret: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the active `@`-mention token the caret sits inside, or `null`.
 *
 * Scans backwards from `caret`: the token is active when an `@` is found whose
 * preceding character is a word boundary (start-of-text or whitespace) and
 * every character between the `@` and the caret is non-whitespace. Whitespace
 * before reaching an `@` means the caret is not in a mention — returns `null`.
 */
export function detectMention(draft: string, caret: number): MentionContext | null {
  // Clamp the caret defensively — a stale caret must never index out of range.
  const pos = Math.max(0, Math.min(caret, draft.length));
  for (let i = pos - 1; i >= 0; i--) {
    const ch = draft[i];
    // Whitespace before an `@` — the caret is not inside a mention token.
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      // The `@` must sit at a word boundary: start-of-text or after
      // whitespace. An `@` mid-word (e.g. an email) is not a mention.
      const prev = i > 0 ? draft[i - 1] : "";
      if (prev !== "" && !/\s/.test(prev)) return null;
      return { start: i, query: draft.slice(i + 1, pos) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filter `files` by a mention `query` (case-insensitive substring), capped at
 * `limit` entries.
 *
 * An empty query returns the head of the list unchanged. A non-empty query
 * keeps paths containing it; matches whose BASENAME starts with the query are
 * floated to the top (the most likely intent), then ordered by path length so
 * shallow, short paths come first.
 */
export function filterFiles(files: string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return files.slice(0, limit);

  const matched = files.filter((f) => f.toLowerCase().includes(q));
  matched.sort((a, b) => {
    const aBase = basename(a).toLowerCase();
    const bBase = basename(b).toLowerCase();
    const aPrefix = aBase.startsWith(q);
    const bPrefix = bBase.startsWith(q);
    if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
    return a.length - b.length;
  });
  return matched.slice(0, limit);
}

/** The trailing path segment of a forward-slashed relative path. */
function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/**
 * Splice an `@<path>` token into `draft`, replacing the active mention's
 * `[start, caret)` span, and append a trailing space so the next word is not
 * glued to the token.
 *
 * Returns the new draft text plus the caret position just past the inserted
 * token (after the trailing space) so the composer can re-place the cursor.
 */
export function applyMention(
  draft: string,
  mention: MentionContext,
  path: string,
  caret: number,
): MentionInsertion {
  const pos = Math.max(0, Math.min(caret, draft.length));
  const token = `@${path} `;
  const text = draft.slice(0, mention.start) + token + draft.slice(pos);
  return { text, caret: mention.start + token.length };
}
