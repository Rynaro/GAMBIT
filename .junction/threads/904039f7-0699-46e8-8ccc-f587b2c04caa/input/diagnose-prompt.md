# Diagnose: GAMBIT Doctor "Run checks" flashes red with no checks

## Symptom

User clicks **Run checks** in the Doctor route. Briefly some UI flashes ("running" state with a spinner), then everything disappears and the last-run badge settles **red** (status_error). No check rows render. No console errors reported to the user.

Confirmed on `feat/v0.1-integration` HEAD post-blank-pane-fix (latest pushed commits include `9b53529`, `a79f29f`, `47559aa`, `73b0b78`). The blank-pane regression from the prior VIGIL pass is resolved — picking a project now updates the main pane correctly. This is a separate, independent issue surfaced once Doctor actually became reachable.

## Ground truth (gathered by the parent before this brief)

### Real `eidolons doctor` output (captured live with `eidolons doctor 2>&1`)

```
▸ eidolons doctor — checking /Users/henrique/workspace/oss/agents/eidolons


=== Manifest + lock ===
  ✓ eidolons.yaml present
  ✓ eidolons.lock present

=== Installed members ===
  ✓ atlas installed with valid manifest
  ✓ spectra installed with valid manifest
  ✓ apivr installed with valid manifest
  ✓ idg installed with valid manifest
  ✓ forge installed with valid manifest
  ✓ vigil installed with valid manifest

=== Host wiring ===
  ✓ claude-code wired (.claude/agents/*.md present)

=== Dispatch freshness ===
  ✓ CLAUDE.md clean (no stale pointers)

=== Release integrity ===
  ✓ atlas@1.5.2 release integrity verified
  ... (six total) ...

=== Cache hygiene ===
  ✓ atlas@1.5.2 cache fresh
  ... (six total) ...

=== MCP servers ===
  ✓ junction: healthy

=== MCP catalogue drift ===
  ✓ All installed MCPs at catalogue stable

=== Pending upgrades ===
  ·  atlas          1.5.2  →  1.5.3  (within ^1.5.0)
  ·  spectra        4.3.2  →  4.3.3  (within ^4.3.0)
  ... (six total) ...
  ·  Run `eidolons upgrade` to apply.

✓ All checks passed.
```

**Exit code:** `0` (when the system is healthy).

### Format discrepancy versus the parser

`gambit/src/lib/parseDoctorStderr.ts` expects:

```
[N/M] check-name <glyph>
      → message body
```

— with `[N/M]` index prefix, glyph at line END, optional indented `→` continuation. This does NOT match reality. The real format has:

- A leading `▸` banner line with the project path.
- Category headings as `=== Foo ===` blank-line-separated groups.
- Each check is a single indented line: two-space indent + glyph + space + check description.
- For "warn"-style entries (pending upgrades), the glyph is `·` followed by two spaces and a table-formatted row.
- A trailing `✓ All checks passed.` or analogous failure rollup.

### PATH issue (likely secondary or compounding)

macOS GUI apps started by the launcher inherit `/usr/bin:/bin:/usr/sbin:/sbin` only — they do **not** see the user shell's PATH unless explicitly propagated. The user's `eidolons` binary lives at `/Users/henrique/.local/bin/eidolons` (verified via `which`); a test of `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin which eidolons` returns empty.

`~/.eidolons/nexus/cli/eidolons` exists (verified) — the documented Rust fallback path.

Look at `gambit/src-tauri/src/doctor.rs` (and the sibling `sync.rs` which has the same structural pattern) for how the `eidolons` binary is located. Likely flow:
1. `which::which("eidolons")` — returns Err in a Tauri-spawned process because PATH is minimal.
2. Fallback to `~/.eidolons/nexus/cli/eidolons` — should succeed since the file exists.
3. Spawn that path.

If step 2 is wired correctly, doctor SHOULD run. If the fallback is missing or path-resolved wrong, doctor never spawns and the IPC chain emits a failure event immediately.

## Possible failure modes (ranked)

H1. **Parser returns empty array** because the real output doesn't match the regex/predicates → checks array is `[]` → DoctorDashboard renders nothing → state machine flips running → done with empty checks; UI shows the red badge because some logic interprets "0 checks parsed" as failure.

H2. **PATH lookup fails AND fallback isn't reached** because the Rust code only checks `which::which("eidolons")` without the `~/.eidolons/nexus/cli/eidolons` fallback. start_doctor returns an error, useDoctor sees `doctor-error` or `doctor-complete` with non-zero exit, sets state to "failed" → red badge.

H3. **The Rust spawns doctor but stderr/stdout streams are not captured correctly** — output goes to a void, parser sees nothing, checks empty. Combined with non-zero exit interpretation → red badge.

H4. **The Doctor button calls `start_doctor` but the IPC payload uses the wrong shape** (e.g. snake_case vs camelCase mismatch) → Rust rejects the invoke → instant failure → red badge.

H5. **A timing issue:** Doctor process exits faster than the stream readers can drain stdout/stderr; `tokio::join!` finishes but the buffered lines were never emitted as events → the parser never sees them; useDoctor.complete fires with no checks.

H6. **Doctor checks ARE parsed correctly but a status-derivation bug** in useDoctor or DoctorDashboard misinterprets `running → done(0)` as "failed" — e.g. comparing exit_code to a wrong sentinel, or status pill colour map indexed wrong.

H7. **Doctor exits with non-zero because of a real check failure in the picked project's environment** (e.g. the user picked a non-eidolons folder, or the eidolons CLI isn't compatible with this project's lock version). Less likely given the user reports "elements appear briefly" — implying the process did start.

## Key files to inspect

- `gambit/src/lib/parseDoctorStderr.ts` — the parser (compare with reality).
- `gambit/src-tauri/src/doctor.rs` — spawn + stream + emit.
- `gambit/src-tauri/src/sync.rs` — structurally identical, useful as a reference for what "correct" looks like (sync streaming works per user confirmation).
- `gambit/src/lib/useDoctor.ts` — state machine + event subscriptions.
- `gambit/src/components/DoctorDashboard.tsx` — render path; check how "failed" colour is derived.
- `gambit/src/routes/DoctorRoute.tsx` — wires the hook + dashboard.
- `gambit/tests/parsers/doctor.fixture.txt` — what the test thinks doctor outputs (likely misaligned with reality).
- `gambit/tests/unit/parseDoctorStderr.test.ts` — current tests (probably 10/10 green against the wrong format).

## Authority

Read-only. Use `git log`, `git show`, `rg`. No write tool. Emit a root-cause-report.md (verbatim in your reply between `===REPORT-START===` / `===REPORT-END===` sentinels) with the four contract-required H2 sections — `reproduction`, `hypotheses`, `interventions`, `blame_target`. Evidence anchor required.

Recommend the new parser format + the PATH-fallback fix together if both prove necessary. The new fixture text should be either captured verbatim from the live output above, or generated by mocking the structure exactly.
