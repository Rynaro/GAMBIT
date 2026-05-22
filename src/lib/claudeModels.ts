// claudeModels.ts — host-side `claude` model + thinking-effort option tables
// (story R3).
//
// `claude` has NO "list models" command — the alias set is hardcoded host-side
// (the aliases auto-update CLI-side, so a fixed list ages well). This module is
// that constant, the launch-time menu the SessionComposer renders, mirroring
// `contextWindow.ts`'s host-side-table style.
//
// `--model` accepts an alias (`opus` / `sonnet` / `haiku` / `opusplan` /
// `default`, plus the `[1m]` 1M-context variants) or a full model id. The
// special `default` value (and a session created with no model selected) lets
// `claude` apply its own default — the GAMBIT default below is `default`.
//
// `--effort` accepts `low` / `medium` / `high` / `xhigh` / `max`. Supported
// levels vary per model; an unsupported level auto-downgrades CLI-side, so
// GAMBIT offers all five and lets `claude` resolve. The friendly labels
// (Light / Normal / Deep / Very deep / Max) are the cozy-UI rendering.

// ---------------------------------------------------------------------------
// Model options
// ---------------------------------------------------------------------------

/** One selectable `--model` option: the wire `value` + a display `label`. */
export interface ModelOption {
  /** The value passed verbatim to `--model` (an alias, or `"default"`). */
  value: string;
  /** Human-readable label for the composer's model `<select>`. */
  label: string;
}

/**
 * The `--model` options offered in the composer, in display order.
 *
 * `default` is first — it is the GAMBIT default ({@link DEFAULT_MODEL}) and
 * sends NO explicit model so `claude` picks. The `[1m]` variants request the
 * 1M-context build of Opus / Sonnet.
 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  { value: "default", label: "Default (claude picks)" },
  { value: "opus", label: "Opus" },
  { value: "opus[1m]", label: "Opus (1M context)" },
  { value: "sonnet", label: "Sonnet" },
  { value: "sonnet[1m]", label: "Sonnet (1M context)" },
  { value: "haiku", label: "Haiku" },
  { value: "opusplan", label: "Opus Plan" },
];

/**
 * The default model `value` — `"default"` lets `claude` apply its own pick.
 * A session created with this value carries no `--model` flag.
 */
export const DEFAULT_MODEL = "default";

// ---------------------------------------------------------------------------
// Thinking-effort options
// ---------------------------------------------------------------------------

/** One selectable `--effort` level: the wire `value` + a display `label`. */
export interface EffortOption {
  /** The value passed verbatim to `--effort`. */
  value: string;
  /** Human-readable label for the composer's effort `<select>`. */
  label: string;
}

/**
 * The `--effort` options offered in the composer, in display order.
 *
 * Supported levels vary per model — an unsupported one auto-downgrades
 * CLI-side, so all five are offered and `claude` resolves the rest.
 */
export const EFFORT_OPTIONS: readonly EffortOption[] = [
  { value: "low", label: "Light" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "Deep" },
  { value: "xhigh", label: "Very deep" },
  { value: "max", label: "Max" },
];

/**
 * The composer's effort-select sentinel for "no explicit effort" — when this
 * is selected the session is created with no `--effort` flag and `claude`'s
 * own default applies. It is NOT a `--effort` value; the composer maps it to
 * an absent `thinkingEffort` in `StartSessionParams`.
 */
export const EFFORT_DEFAULT = "";
