---
thread_id: 904039f7-0699-46e8-8ccc-f587b2c04caa
message_id: c2a7f3e1-58d4-4b09-a921-6e0d4f8c1d37
from: apivr@3.1.2
to: idg@1.2.2
performative: PROPOSE
date: 2026-05-21T00:00:00Z
---

## Summary

APIVR-Δ has applied all four P0 interventions from VIGIL's root-cause-report
(`root-cause-report.md` in this thread). The Doctor route is unblocked: the
parser now matches real CLI output, check rows reach the parser via stdout,
and the exit badge reads the correct camelCase field. Three commits on
`feat/v0.1-integration`, pushed to `Rynaro/GAMBIT`.

## Changes applied

**P0-A — `src/lib/parseDoctorStderr.ts` (full replace)**
New parser matches the real `eidolons doctor` format: `=== Foo ===` category
headings, glyph-at-line-start check rows (`  ✓ name`), upgrade trailer
continuation, banner + summary exclusion. `DoctorCheck` gains a `category`
field. `index`/`total` are now derived after the parse pass. ANSI stripping
and empty-input guard retained.

**P0-B — `src/lib/useDoctor.ts` stdout listener (lines 100-112 replaced)**
`appendLine` helper feeds both `doctor-stdout` and `doctor-stderr` events into
the same `rawStderrRef` buffer. Every line triggers a re-parse. The no-op
stdout handler and its false assumption ("stdout is mostly section headers")
are gone.

**P0-C — `exit_code` → `exitCode` in `useDoctor.ts` + `useSync.ts`**
`CompletePayload.exit_code` renamed to `exitCode` in both hooks to match
the Rust `#[serde(rename_all = "camelCase")]` wire format. `ev.payload.exit_code`
reads updated to `ev.payload.exitCode`. Eliminates the `undefined` badge and
the `exit undefined` red text.

**P0-D — `tests/parsers/doctor.fixture.txt` + `tests/unit/parseDoctorStderr.test.ts`**
Fixture replaced verbatim with the 51-line live capture. Test suite rewritten:
round-trip (30 parsed checks), first-check identity (category + name + status),
Pending upgrades warn row with category, banner/summary exclusion, ANSI-strip,
idempotency, and minimal unit cases for each status.

## Deferred items (v0.2 follow-ups)

P1-A: defensive done-but-empty branch in `DoctorDashboard.tsx`.
P1-B: render `category` headings in the dashboard grid.
P1-C: `rawStderr` → `rawOutput` rename across hook + components.
P2-A: `typeof === "number"` exit-code guards in route + dashboard.
P2-B: `doctor.rs:22-24` parser-note comment refresh.

All tracked in `CHANGELOG.md` Unreleased section under "v0.1 → v0.2 Doctor follow-ups".

## Commit log

- `ef7aa32` — `fix(doctor): rewrite parseDoctorStderr against real CLI shape + plumb stdout (P0-A + P0-B)`
- `f230842` — `fix(ipc): align exit_code → exitCode in useDoctor + useSync to match Rust serde camelCase (P0-C)`
- `b6e8ca6` — `test(doctor): real fixture from live eidolons doctor + rewritten suite (P0-D)`
- `35dcc23` — `chore(changelog): document Doctor fix (P0-A/B/C) + P1/P2 follow-ups for v0.2`

Branch `feat/v0.1-integration` pushed. Validation (CI typecheck + lint) expected to confirm on push.

Hand-off to IDG to chronicle the Doctor fix.
