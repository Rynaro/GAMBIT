// claudeModels.test.ts — Vitest unit tests for the host-side `claude` model +
// thinking-effort option tables (story R3).
//
// `MODEL_OPTIONS` / `EFFORT_OPTIONS` are the launch-time menu the
// SessionComposer renders. They must:
//   * expose the verified `--model` aliases (opus / sonnet / haiku / opusplan /
//     default, plus the `[1m]` variants), `default` first;
//   * expose all five verified `--effort` levels (low / medium / high / xhigh /
//     max) with friendly labels;
//   * carry stable defaults — `DEFAULT_MODEL` is `"default"`, `EFFORT_DEFAULT`
//     is `""` (let claude pick).

import { DEFAULT_MODEL, EFFORT_DEFAULT, EFFORT_OPTIONS, MODEL_OPTIONS } from "@/lib/claudeModels";
import { describe, expect, it } from "vitest";

describe("MODEL_OPTIONS", () => {
  it("exposes the verified --model aliases", () => {
    const values = MODEL_OPTIONS.map((m) => m.value);
    expect(values).toEqual([
      "default",
      "opus",
      "opus[1m]",
      "sonnet",
      "sonnet[1m]",
      "haiku",
      "opusplan",
    ]);
  });

  it("lists `default` first — the GAMBIT default", () => {
    expect(MODEL_OPTIONS[0].value).toBe("default");
    expect(DEFAULT_MODEL).toBe("default");
  });

  it("every option carries a non-empty display label", () => {
    for (const opt of MODEL_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
});

describe("EFFORT_OPTIONS", () => {
  it("exposes all five verified --effort levels", () => {
    const values = EFFORT_OPTIONS.map((e) => e.value);
    expect(values).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("maps the levels to friendly labels", () => {
    const labels = EFFORT_OPTIONS.map((e) => e.label);
    expect(labels).toEqual(["Light", "Normal", "Deep", "Very deep", "Max"]);
  });

  it("EFFORT_DEFAULT is the empty 'let claude pick' sentinel", () => {
    expect(EFFORT_DEFAULT).toBe("");
    // The sentinel is NOT a real `--effort` value.
    expect(EFFORT_OPTIONS.some((e) => e.value === EFFORT_DEFAULT)).toBe(false);
  });
});
