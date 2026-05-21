---
thread_id: 37bb58c5-455d-4259-ab04-09b03f4c6838
from: apivr@3.1.2
to: idg@1.2.2
performative: PROPOSE
date: 2026-05-21T15:27:00Z
---

# APIVR-Δ Completion Report — Methodology Markdown Rendering

## What was implemented

Replaced the `<pre>` plain-text fallback in `MethodologyRoute.tsx` with a full markdown rendering stack:

- `react-markdown@9` + `remark-gfm@4` added to `package.json` dependencies.
- `src/lib/stripFrontMatter.ts` — pure function that strips YAML front-matter delimited by `---\n … \n---\n` before render. Handles CRLF line endings. Returns source unchanged if no valid front-matter is found.
- `src/components/MarkdownView.tsx` — wrapper around `<ReactMarkdown>` with custom component renderers for every markdown element:  headings (h1–h4, with `md-h2` bottom-border separator), paragraphs (max-width 72ch, 1.6 line-height), inline code (amber accent chip), fenced code blocks (monospaced, raised surface, horizontal scroll), blockquotes (3px accent-primary left border, muted italic), lists (list-style restored from global reset), GFM tables (monospaced cells, alternate row tint, scroll wrapper), links (open via `window.open` in Tauri 2 context), and `<hr>`.
- `src/components/MarkdownView.css` — all `.md-*` classes wired to GAMBIT design tokens exclusively; no hard-coded color values.
- `src/routes/MethodologyRoute.tsx` — `<pre className="methodology-pre">` replaced by `<article className="methodology-article"><MarkdownView source={content} /></article>`.

## Validation against the staged fixture

The ATLAS fixture at `.junction/threads/37bb58c5-455d-4259-ab04-09b03f4c6838/input/atlas-agent.fixture.md` contains:
- 12-line YAML front-matter (stripped by `stripFrontMatter`).
- H1 + 6 H2s + several H3s (all mapped to styled elements).
- Three fenced code blocks — two shell (`sh`), one plain.
- Two GFM tables (lines ~52 and ~72) — rendered with `md-table-wrapper` scroll guard.
- Ordered and unordered lists with bold-labeled items — list-style restored, strong maps to `--text-primary`.
- No blockquotes in ATLAS; other Eidolons (`apivr`, `spectra`) checked — APIVR uses none; SPECTRA uses a GFM `>` in its reasoning section.

## Tests

`tests/unit/stripFrontMatter.test.ts` — 5 cases: strips front-matter, no front-matter passthrough, lone `---` without closing passthrough, CRLF line endings, minimal single-field front-matter. All pass via `vitest run`.

Pre-existing failures in `parseAnsi.test.ts` and `useSync.test.ts` (9 tests) were present before this change and are unrelated.

## Open question

`pnpm-lock.yaml` was not updated (pnpm unavailable as a tool under APIVR constraints). Host must run `make install` (or `pnpm install` inside the Docker container) before `make typecheck` or `tauri build` to resolve `react-markdown` and `remark-gfm` from the registry. The lockfile update is a prerequisite for the CI type-check job.

---

Hand-off to IDG to chronicle the methodology markdown rendering alongside the three-verb core.
