// transcriptFind.ts — pure helpers for the DetailPane's in-transcript find
// (story P10).
//
// The Sessions route has no way to find text inside a long transcript. P10
// adds a ⌘/Ctrl+F find bar; this module is its non-React core: flatten the
// transcript into searchable text segments, then locate every case-insensitive
// match across them. Kept pure + dependency-free so it is directly
// Vitest-testable without rendering the transcript.
//
// A SEGMENT is one searchable piece of transcript text (an assistant text
// block, a user prompt, a stderr line, a tool name + input peek, a tool
// result). Each segment knows which `turn` it belongs to so the find bar can
// scroll the matching turn group into view. A MATCH is one occurrence of the
// query within a segment.

import type { ContentBlock, ParsedAssistant, ParsedUser } from "@/lib/session.types";
import type { TranscriptEntry } from "@/lib/useSession";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One searchable piece of transcript text. */
export interface FindSegment {
  /** The 1-based turn this text belongs to. */
  turn: number;
  /** A short label for the segment's origin (`prompt` / `assistant` / …). */
  kind: string;
  /** The plain searchable text. */
  text: string;
}

/** One occurrence of the find query within the transcript. */
export interface FindMatch {
  /** Index into the `FindSegment[]` the match was found in. */
  segmentIndex: number;
  /** The turn the match belongs to — drives scroll-to-turn navigation. */
  turn: number;
  /** Character offset of the match within the segment's text. */
  offset: number;
}

// ---------------------------------------------------------------------------
// Segment collection
// ---------------------------------------------------------------------------

/** Stringify a `tool_result` block's `content` (string or nested blocks). */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as ContentBlock;
        return typeof b?.text === "string" ? b.text : "";
      })
      .join("\n");
  }
  return "";
}

/**
 * Flatten a transcript into the searchable text segments the find bar scans.
 *
 * Covers, per turn: the human's prompt, assistant text + thinking blocks, tool
 * names + JSON input peeks, tool results, and stderr lines. `init` / `result`
 * / `streamEvent` entries carry no user-facing prose and are skipped.
 */
export function collectSearchText(transcript: TranscriptEntry[]): FindSegment[] {
  const segments: FindSegment[] = [];
  const push = (turn: number, kind: string, text: string) => {
    if (text && text.trim().length > 0) segments.push({ turn, kind, text });
  };

  for (const entry of transcript) {
    if (entry.source === "prompt") {
      push(entry.turn, "prompt", entry.line);
      continue;
    }
    if (entry.source === "stderr") {
      push(entry.turn, "stderr", entry.line);
      continue;
    }
    // `event` entries — switch on the stable lowercase `kind`.
    if (entry.kind === "assistant" && entry.parsed) {
      const blocks = (entry.parsed as ParsedAssistant).Assistant?.content ?? [];
      for (const block of blocks) {
        if (block.blockType === "text" && block.text) {
          push(entry.turn, "assistant", block.text);
        } else if (block.blockType === "thinking" && block.thinking) {
          push(entry.turn, "thinking", block.thinking);
        } else if (block.blockType === "tool_use") {
          const name = block.name ?? "tool";
          let peek = name;
          try {
            if (block.input !== undefined) peek = `${name} ${JSON.stringify(block.input)}`;
          } catch {
            // Unstringifiable input — the tool name alone is still searchable.
          }
          push(entry.turn, "tool", peek);
        }
      }
    } else if (entry.kind === "user" && entry.parsed) {
      const blocks = (entry.parsed as ParsedUser).User?.content ?? [];
      for (const block of blocks) {
        if (block.blockType === "tool_result") {
          push(entry.turn, "toolResult", toolResultText(block.content));
        }
      }
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Find every case-insensitive occurrence of `query` across `segments`.
 *
 * Matches are returned in transcript order (segment order, then offset within
 * a segment). An empty / whitespace-only query yields no matches. Overlapping
 * matches are not produced — the scan advances past each hit.
 */
export function findMatches(segments: FindSegment[], query: string): FindMatch[] {
  const q = query.toLowerCase();
  if (q.trim().length === 0) return [];

  const matches: FindMatch[] = [];
  segments.forEach((segment, segmentIndex) => {
    const haystack = segment.text.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(q, from);
      if (at === -1) break;
      matches.push({ segmentIndex, turn: segment.turn, offset: at });
      from = at + q.length;
    }
  });
  return matches;
}

/**
 * Convenience: collect + match in one call. Returns the searchable segments,
 * every match, and the distinct turns containing at least one match (for
 * highlighting whole turn groups).
 */
export function searchTranscript(
  transcript: TranscriptEntry[],
  query: string,
): { segments: FindSegment[]; matches: FindMatch[]; matchedTurns: Set<number> } {
  const segments = collectSearchText(transcript);
  const matches = findMatches(segments, query);
  const matchedTurns = new Set(matches.map((m) => m.turn));
  return { segments, matches, matchedTurns };
}
