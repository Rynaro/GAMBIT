// contextWindow.ts — host-side model -> context-window-size table (story S5).
//
// The `ContextGauge` needs a denominator for its temperature reading:
//   temperature = latest-turn input-side tokens / context_window(model)
// Nothing in the codebase carries a context-window capacity (FINDING-008) —
// claude's `system/init` event gives a model id but never a window size — so
// the size is a HOST-SIDE CONSTANT keyed off the model.
//
// The `model` string from `system/init` is permissive: it may be a short alias
// (`"sonnet"`, `"opus"`) or a full dated id (`"claude-opus-4-7-20260219"`).
// `contextWindowFor` matches case-insensitively on the distinguishing tokens
// rather than against an exhaustive id list, so a newer dated build of a known
// model still resolves, and an unrecognised / null model falls back safely.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The large 1M context window — Opus 4.7 / 4.6 and Sonnet 4.6. */
export const WINDOW_LARGE = 1_000_000;

/** The standard 200K context window — Sonnet 4.5 and older, and the fallback. */
export const WINDOW_STANDARD = 200_000;

/**
 * Distinguishing model tokens that map to the 1M window.
 *
 * Matched as case-insensitive substrings against a NORMALISED model id (dots
 * and spaces collapsed to dashes), so both `"opus-4-7"` and `"opus 4.7"` hit
 * `opus-4-7`.
 * The bare `"mythos"` token covers the Mythos Preview build.
 */
const LARGE_WINDOW_TOKENS = ["opus-4-7", "opus-4-6", "sonnet-4-6", "mythos"];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the context-window size (in tokens) for a model id.
 *
 * Returns {@link WINDOW_LARGE} (1,000,000) for Opus 4.7 / Opus 4.6 / Sonnet 4.6
 * (and the Mythos Preview), and {@link WINDOW_STANDARD} (200,000) for Sonnet 4.5
 * and older. An unrecognised, empty, or `null` model falls back to
 * {@link WINDOW_STANDARD} — the conservative choice (a smaller denominator
 * reads HOTTER, so the gauge never lulls the user into a false sense of room).
 *
 * Matching is permissive: a `.`-, `-`-, or space-separated version is
 * normalised to dashes and the distinguishing token is searched as a
 * case-insensitive substring, so `"opus"` alone does NOT match (no version)
 * but `"claude-opus-4-7-20260219"`, `"Opus 4.7"`, and `"opus-4-7"` all do.
 */
export function contextWindowFor(model: string | null): number {
  if (!model) return WINDOW_STANDARD;

  // Normalise: lowercase, and collapse version dots / spaces to `-` so a
  // single token set matches `opus-4-7`, `opus 4.7`, and `opus.4.7` alike.
  const normalised = model.toLowerCase().replace(/[.\s]+/g, "-");

  for (const token of LARGE_WINDOW_TOKENS) {
    if (normalised.includes(token)) return WINDOW_LARGE;
  }

  return WINDOW_STANDARD;
}
