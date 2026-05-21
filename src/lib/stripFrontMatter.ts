/**
 * stripFrontMatter.ts — strip YAML front-matter from a markdown string.
 *
 * Front-matter is defined as a YAML block delimited by `---` at the very
 * beginning of the document and closed by a second `---` on its own line.
 * The closing delimiter plus its trailing newline is removed; everything
 * before the first non-front-matter content is also removed.
 *
 * Rules:
 *  - Source must start with `---\n` (or `---\r\n`).
 *  - There must be a closing `---` on its own line before any non-empty body.
 *  - If no valid front-matter is found, the source is returned unchanged.
 *  - CRLF (\r\n) line endings are handled.
 */

export function stripFrontMatter(source: string): string {
  // Normalise CRLF so the regex works uniformly, then restore isn't needed
  // because the caller doesn't care about the line-ending style.
  const normalised = source.replace(/\r\n/g, "\n");
  const stripped = normalised.replace(/^---\n[\s\S]*?\n---\n?/, "");
  // Guard: if nothing was stripped (replace matched nothing) return original.
  if (stripped === normalised) return source;
  return stripped;
}
