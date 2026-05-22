// mentionPicker.test.ts — Vitest unit tests for the @-file mention picker
// helpers (story P9).
//
// `mentionPicker.ts` is the pure core of the SessionComposer's `@`-mention
// dropdown: detecting the active `@token` at the caret, filtering the project
// file list by its query, and splicing the picked path into the draft. The
// tests exercise each seam directly — no React, no Tauri.

import { applyMention, detectMention, filterFiles } from "@/lib/mentionPicker";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("mentionPicker", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("detectMention", () => {
    it("detects a bare @ at the caret with an empty query", () => {
      const ctx = detectMention("hello @", 7);
      expect(ctx).toEqual({ start: 6, query: "" });
    });

    it("captures the query typed after the @", () => {
      const ctx = detectMention("see @src/main", 13);
      expect(ctx).toEqual({ start: 4, query: "src/main" });
    });

    it("detects an @ at the very start of the draft", () => {
      const ctx = detectMention("@App", 4);
      expect(ctx).toEqual({ start: 0, query: "App" });
    });

    it("returns null when the caret is not inside a mention", () => {
      expect(detectMention("plain text", 5)).toBeNull();
    });

    it("returns null once a space closes the token", () => {
      // The caret is after the space — the `@token` is no longer active.
      expect(detectMention("@src/main and", 13)).toBeNull();
    });

    it("does not treat a mid-word @ (an email) as a mention", () => {
      expect(detectMention("mail me@host", 12)).toBeNull();
    });

    it("clamps an out-of-range caret", () => {
      const ctx = detectMention("@file", 999);
      expect(ctx).toEqual({ start: 0, query: "file" });
    });
  });

  describe("filterFiles", () => {
    const files = [
      "src/main.ts",
      "src/components/App.tsx",
      "src/lib/mentionPicker.ts",
      "README.md",
      "package.json",
    ];

    it("returns the head of the list for an empty query", () => {
      expect(filterFiles(files, "")).toEqual(files);
    });

    it("filters by a case-insensitive substring", () => {
      const out = filterFiles(files, "APP");
      expect(out).toEqual(["src/components/App.tsx"]);
    });

    it("floats basename-prefix matches to the top", () => {
      // "main" is the basename prefix of `src/main.ts` — it leads.
      const out = filterFiles(["src/domain.ts", "src/main.ts"], "main");
      expect(out[0]).toBe("src/main.ts");
    });

    it("respects the result limit", () => {
      const many = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
      expect(filterFiles(many, "file", 10)).toHaveLength(10);
    });

    it("returns nothing when no path matches", () => {
      expect(filterFiles(files, "nonexistent")).toEqual([]);
    });
  });

  describe("applyMention", () => {
    it("splices @path into the draft at the mention span", () => {
      const draft = "see @ma";
      const mention = detectMention(draft, 7);
      expect(mention).not.toBeNull();
      const result = applyMention(draft, mention!, "src/main.ts", 7);
      expect(result.text).toBe("see @src/main.ts ");
      // The caret lands just past the inserted token + trailing space.
      expect(result.caret).toBe(result.text.length);
    });

    it("keeps text after the caret intact", () => {
      const draft = "@ap and more";
      // Caret sits right after "@ap" (index 3).
      const mention = detectMention(draft, 3);
      const result = applyMention(draft, mention!, "src/App.tsx", 3);
      expect(result.text).toBe("@src/App.tsx  and more");
    });
  });
});
