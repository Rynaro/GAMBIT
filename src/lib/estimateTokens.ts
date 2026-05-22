// estimateTokens.ts — host-side heuristic prompt token estimate (story R5).
//
// The composer wants to show the user, BEFORE sending, roughly how many tokens
// their draft text is. There is no tokenizer in the codebase (FINDING-018) and
// none is wanted: a real BPE library is a bundle dependency and is STILL only
// approximate for Claude (a different BPE than any bundled tokenizer ships).
//
// So this is a deliberate APPROXIMATION, and is labelled as such in the UI:
//
//   * Even Anthropic's own `count_tokens` API is documented as "an estimate"
//     and "may be different from the actual number of tokens used".
//   * The composer draft is only a FRACTION of the true request — the real
//     turn also carries the system prompt, prior transcript, tool definitions,
//     and tool results — so the gap between this number and the billed input
//     is structural, not a heuristic flaw.
//
// The heuristic is a blend of two cheap signals:
//   * chars / 4   — the well-known rule of thumb; lands within ~±10-20% for
//                   ordinary prose and code.
//   * words * 0.75 — a sub-word-per-word floor; keeps short, word-dense text
//                    (few characters, many tokens-per-char) from reading low.
// The estimate is the LARGER of the two — `chars/4` dominates for long /
// code-heavy text, the word floor dominates for short word lists. It is pure,
// dependency-free, synchronous, and cheap enough to run on every keystroke.

/**
 * Estimate the number of tokens in `text` with a fast, offline heuristic.
 *
 * Returns a blended `Math.ceil(Math.max(chars / 4, words * 0.75))`. Empty or
 * whitespace-only text returns `0`.
 *
 * This is a DELIBERATE approximation for a "ballpark" UI label, not an exact
 * count — see the file header. It never throws: any string (prose, code,
 * emoji, CJK) yields a finite non-negative integer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const chars = text.length;
  // Whitespace-delimited word count — `filter(Boolean)` drops the empty
  // segments a leading / trailing / repeated separator would otherwise add.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;

  return Math.ceil(Math.max(chars / 4, words * 0.75));
}
