// estimateTokens.test.ts — Vitest unit tests for the heuristic prompt token
// estimate (story R5).
//
// `estimateTokens` is a DELIBERATE approximation for a "ballpark" composer
// label, not an exact tokenizer. The tests therefore assert behaviour, not
// exact counts: empty -> 0, the estimate scales with length, a known string
// lands in a sane range, and code-heavy / exotic text never throws.

import { estimateTokens } from "@/lib/estimateTokens";
import { describe, expect, it } from "vitest";

describe("estimateTokens", () => {
  describe("empty input", () => {
    it("returns 0 for an empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("returns 0 for whitespace-only text", () => {
      expect(estimateTokens("   ")).toBe(0);
      expect(estimateTokens("\n\t  \n")).toBe(0);
    });
  });

  describe("scaling", () => {
    it("scales with text length", () => {
      const short = estimateTokens("hello world");
      const long = estimateTokens("hello world ".repeat(100));
      expect(long).toBeGreaterThan(short);
    });

    it("returns a finite non-negative integer", () => {
      const n = estimateTokens("the quick brown fox jumps over the lazy dog");
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    });
  });

  describe("sane range", () => {
    it("estimates a known prose string within a ballpark range", () => {
      // 44 chars, 9 words -> chars/4 = 11, words*0.75 = 6.75 -> ceil(11) = 11.
      const text = "the quick brown fox jumps over the lazy dog";
      const n = estimateTokens(text);
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(20);
    });

    it("a single short word is at least one token", () => {
      expect(estimateTokens("hi")).toBeGreaterThanOrEqual(1);
    });

    it("the word floor lifts short, word-dense text above chars/4", () => {
      // 7 single-char words -> chars/4 ~ 3.25, words*0.75 = 5.25 -> ceil(5.25).
      expect(estimateTokens("a b c d e f g")).toBe(6);
    });
  });

  describe("robustness", () => {
    it("does not crash on code-heavy text", () => {
      const code = "const x = arr.map((v) => v * 2).filter(Boolean);\n}\n";
      expect(() => estimateTokens(code)).not.toThrow();
      expect(estimateTokens(code)).toBeGreaterThan(0);
    });

    it("does not crash on emoji or CJK text", () => {
      expect(() => estimateTokens("🚀✨ 你好世界")).not.toThrow();
      expect(estimateTokens("🚀✨ 你好世界")).toBeGreaterThan(0);
    });
  });
});
