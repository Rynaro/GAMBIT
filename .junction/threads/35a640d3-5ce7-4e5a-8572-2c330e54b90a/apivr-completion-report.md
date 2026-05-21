---
thread_id: 35a640d3-5ce7-4e5a-8572-2c330e54b90a
from: apivr@3.1.2
to: idg@1.2.2
performative: PROPOSE
ts: 2026-05-21T00:00:00Z
---

## Delta

Four files changed, one file created:

- `package.json` — added `"rehype-highlight": "^7"` to `dependencies`.
- `src/components/MarkdownView.tsx` — imported `rehypeHighlight`; wired `rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}` into `<ReactMarkdown>`.
- `src/components/MarkdownView.css` — appended `.hljs` token theme (14 rule-groups covering keywords/built-ins, strings/attrs, numbers/literals, comments, function titles, symbols/meta/tags, variables, types, deletions, sections/bullets) scoped under `.markdown-view .md-code-block`. All colors reference existing design tokens; no raw color values.
- `CHANGELOG.md` — Unreleased > Added entry for rehype-highlight.
- `tests/unit/markdownView.test.tsx` — new smoke test: renders `<MarkdownView source="```rust\nfn main() {}\n```" />` and asserts `container.innerHTML` contains `language-rust` and `hljs`.

## Verify

Host validation steps:

1. Open GAMBIT, navigate Methodology → pick any Eidolon with fenced code blocks (e.g. atlas — `atlas-sample.md` has Bash + shell blocks).
2. Confirm keyword tokens render in purple (accent-primary), string tokens in mint (status-ok), numbers/function names in amber (accent-secondary-amber), comments in muted-grey italic.
3. Run `vitest run tests/unit/markdownView.test.tsx` — expect 1 passing test.
4. Run `tsc --noEmit` — no new type errors.

## Reflection

- `detect: true` on `rehypeHighlight` auto-detects language for unlabelled fences; `ignoreMissing: true` prevents crashes on unknown lang tags. Both are safe defaults.
- The `.hljs` theme is scoped to `.markdown-view .md-code-block` — no global bleed, fully overridable.
- Light-mode: design tokens already swap via CSS variables; no extra overrides needed.
- One open question: `rehype-highlight` bundles all highlight.js grammars by default (~180 KB raw). If bundle size becomes a concern, switch to `rehype-highlight`'s `languages` option to register only `{rust, bash, typescript, json, yaml, diff}` explicitly (saves ~120 KB).

## Hand-off

Hand-off to IDG to chronicle alongside parallel siblings (hooks-lift + nexus-upgrade).
