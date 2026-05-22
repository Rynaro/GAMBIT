// contextWindow.test.ts — Vitest unit tests for the model -> context-window
// resolver (story S5).
//
// `contextWindowFor` is the gauge's denominator. It must return:
//   * 1,000,000 for Opus 4.7 / Opus 4.6 / Sonnet 4.6 (and Mythos Preview),
//     across BOTH short-alias and full dated-id forms;
//   * 200,000 for Sonnet 4.5 and older;
//   * 200,000 (the conservative fallback) for a null / empty / garbage model.

import { WINDOW_LARGE, WINDOW_STANDARD, contextWindowFor } from "@/lib/contextWindow";
import { describe, expect, it } from "vitest";

describe("contextWindowFor", () => {
  describe("1M-window models", () => {
    it("resolves Opus 4.7 full and short id forms to 1M", () => {
      expect(contextWindowFor("claude-opus-4-7-20260219")).toBe(WINDOW_LARGE);
      expect(contextWindowFor("opus-4-7")).toBe(WINDOW_LARGE);
      expect(contextWindowFor("Opus 4.7")).toBe(WINDOW_LARGE);
    });

    it("resolves Opus 4.6 to 1M", () => {
      expect(contextWindowFor("claude-opus-4-6-20251015")).toBe(WINDOW_LARGE);
      expect(contextWindowFor("opus-4-6")).toBe(WINDOW_LARGE);
    });

    it("resolves Sonnet 4.6 to 1M", () => {
      expect(contextWindowFor("claude-sonnet-4-6-20260101")).toBe(WINDOW_LARGE);
      expect(contextWindowFor("sonnet-4-6")).toBe(WINDOW_LARGE);
      expect(contextWindowFor("Sonnet 4.6")).toBe(WINDOW_LARGE);
    });

    it("resolves the Mythos Preview build to 1M", () => {
      expect(contextWindowFor("claude-mythos-preview")).toBe(WINDOW_LARGE);
    });

    it("matches case-insensitively", () => {
      expect(contextWindowFor("CLAUDE-OPUS-4-7")).toBe(WINDOW_LARGE);
    });
  });

  describe("200K-window models", () => {
    it("resolves Sonnet 4.5 to 200K", () => {
      expect(contextWindowFor("claude-sonnet-4-5-20250929")).toBe(WINDOW_STANDARD);
      expect(contextWindowFor("sonnet-4-5")).toBe(WINDOW_STANDARD);
    });

    it("resolves older models to 200K", () => {
      expect(contextWindowFor("claude-3-5-sonnet-20241022")).toBe(WINDOW_STANDARD);
      expect(contextWindowFor("claude-opus-4-1-20250805")).toBe(WINDOW_STANDARD);
      expect(contextWindowFor("claude-3-opus-20240229")).toBe(WINDOW_STANDARD);
    });
  });

  describe("fallback", () => {
    it("falls back to 200K for null", () => {
      expect(contextWindowFor(null)).toBe(WINDOW_STANDARD);
    });

    it("falls back to 200K for an empty string", () => {
      expect(contextWindowFor("")).toBe(WINDOW_STANDARD);
    });

    it("falls back to 200K for a garbage / unrecognised model", () => {
      expect(contextWindowFor("not-a-model")).toBe(WINDOW_STANDARD);
      expect(contextWindowFor("gpt-4o")).toBe(WINDOW_STANDARD);
      // A bare alias with no version does NOT match a 1M token.
      expect(contextWindowFor("opus")).toBe(WINDOW_STANDARD);
      expect(contextWindowFor("sonnet")).toBe(WINDOW_STANDARD);
    });
  });

  it("exposes the two window constants", () => {
    expect(WINDOW_LARGE).toBe(1_000_000);
    expect(WINDOW_STANDARD).toBe(200_000);
  });
});
