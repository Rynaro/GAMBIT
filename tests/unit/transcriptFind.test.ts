// transcriptFind.test.ts — Vitest unit tests for the in-transcript find
// helpers (story P10).
//
// `transcriptFind.ts` is the pure core of the DetailPane's ⌘F find bar: it
// flattens a transcript into searchable text segments and locates every
// case-insensitive match. The tests build `TranscriptEntry` fixtures directly
// — no React, no Tauri.

import { collectSearchText, findMatches, searchTranscript } from "@/lib/transcriptFind";
import type { TranscriptEntry } from "@/lib/useSession";
import { afterEach, describe, expect, it, vi } from "vitest";

const TS = "2026-05-22T00:00:00Z";

/** A `prompt` transcript entry — the human's typed turn prompt. */
function prompt(turn: number, text: string): TranscriptEntry {
  return { source: "prompt", turn, line: text, ts: TS };
}

/** An assistant `event` entry carrying a single text block. */
function assistant(turn: number, text: string): TranscriptEntry {
  return {
    source: "event",
    turn,
    kind: "assistant",
    line: "",
    ts: TS,
    parsed: { Assistant: { content: [{ blockType: "text", text }] } },
  };
}

/** A stderr diagnostics entry. */
function stderr(turn: number, text: string): TranscriptEntry {
  return { source: "stderr", turn, line: text, ts: TS };
}

describe("transcriptFind", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("collectSearchText", () => {
    it("flattens prompts, assistant text, and stderr into segments", () => {
      const transcript = [
        prompt(1, "refactor the auth module"),
        assistant(1, "Done — I updated the login flow."),
        stderr(1, "warning: deprecated API"),
      ];
      const segments = collectSearchText(transcript);
      expect(segments).toHaveLength(3);
      expect(segments.map((s) => s.kind)).toEqual(["prompt", "assistant", "stderr"]);
      expect(segments[0].turn).toBe(1);
    });

    it("collects tool_use peeks from assistant blocks", () => {
      const entry: TranscriptEntry = {
        source: "event",
        turn: 2,
        kind: "assistant",
        line: "",
        ts: TS,
        parsed: {
          Assistant: {
            content: [{ blockType: "tool_use", name: "Read", input: { file: "a.ts" } }],
          },
        },
      };
      const segments = collectSearchText([entry]);
      expect(segments).toHaveLength(1);
      expect(segments[0].kind).toBe("tool");
      expect(segments[0].text).toContain("Read");
      expect(segments[0].text).toContain("a.ts");
    });

    it("skips entries with no user-facing prose", () => {
      const init: TranscriptEntry = {
        source: "event",
        turn: 1,
        kind: "init",
        line: "{}",
        ts: TS,
      };
      expect(collectSearchText([init])).toEqual([]);
    });
  });

  describe("findMatches", () => {
    it("returns no matches for an empty query", () => {
      const segments = collectSearchText([prompt(1, "hello world")]);
      expect(findMatches(segments, "")).toEqual([]);
      expect(findMatches(segments, "   ")).toEqual([]);
    });

    it("finds case-insensitive matches and counts them", () => {
      const segments = collectSearchText([
        prompt(1, "the auth module"),
        assistant(1, "Auth is hard. The auth flow works."),
      ]);
      const matches = findMatches(segments, "AUTH");
      // "auth" appears once in the prompt and twice in the assistant text.
      expect(matches).toHaveLength(3);
      expect(matches[0].turn).toBe(1);
    });

    it("steps multiple occurrences within one segment", () => {
      const segments = collectSearchText([prompt(1, "aaa")]);
      // "aa" → non-overlapping: one match (the scan advances past each hit).
      expect(findMatches(segments, "aa")).toHaveLength(1);
    });
  });

  describe("searchTranscript", () => {
    it("returns segments, matches, and the matched turn set", () => {
      const transcript = [
        prompt(1, "fix the bug"),
        assistant(1, "fixed it"),
        prompt(2, "now write tests"),
      ];
      const result = searchTranscript(transcript, "fix");
      expect(result.matches).toHaveLength(2);
      expect(result.matchedTurns.has(1)).toBe(true);
      expect(result.matchedTurns.has(2)).toBe(false);
    });

    it("yields an empty matched-turn set for a no-hit query", () => {
      const result = searchTranscript([prompt(1, "hello")], "zzz");
      expect(result.matches).toEqual([]);
      expect(result.matchedTurns.size).toBe(0);
    });
  });
});
