# Root-cause report — GAMBIT Doctor 'Run checks' produces red badge with no rows

## reproduction

Branch `feat/v0.1-integration` HEAD (`73b0b78`), GAMBIT desktop app launched from Finder/Dock (macOS GUI), project picker pointed at `/Users/henrique/workspace/oss/agents/eidolons` (or any other valid Eidolons project). Navigate to the Doctor route, click **Run checks**.

Observed: the `Running checks…` empty-state with hex glyph (`DoctorDashboard.tsx:228-236`) flashes for ~1s, then disappears. The dashboard returns to the **"Doctor hasn't run yet"** empty-state branch (`DoctorRoute.tsx:164-213`) because `checks.length === 0`. The header shows `Last run: HH:MM:SS exit undefined` rendered in `var(--status-error)` red (`DoctorRoute.tsx:80-93`). No check rows render. No console errors surfaced to the user.

Expected: a populated check grid showing the ~30 real categorised checks from `eidolons doctor`, with a green "exit 0" badge when healthy.

The bug is independent of project content — even a fully-healthy Eidolons install (where `eidolons doctor` exits `0`) yields the red badge with empty rows. This is **deterministic, not flaky**.

## hypotheses

### H1. Parser format mismatch — CONFIRMED, HIGH

`gambit/src/lib/parseDoctorStderr.ts:71-72` — `CHECK_LINE_RE = /^\s*\[(\d+)\/(\d+)\]\s+(.+?)\s+([✓✗·!])\s*$/`. Requires `[N/M]` index prefix and glyph at line END. Real CLI emission per `eidolons/cli/src/doctor.sh:42-43`: `printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"` → produces `  ✓ check description` (glyph at START, no `[N/M]` badge). `parseDoctorStderr` returns `[]` on real text.

### H2. Stream channel mismatch (stdout vs stderr) — CONFIRMED, HIGH (independently sufficient)

`eidolons/cli/src/lib.sh:37-41` — `say/ok/info/warn/die` redirect to `>&2`; banner + summary go to stderr. `eidolons/cli/src/doctor.sh:42-43` — `pass()`/`err()` use bare `printf` → **stdout**. `eidolons/cli/src/ui/panel.sh:125-143` — `ui_section_out` writes category headings to **stdout**. `gambit/src/lib/useDoctor.ts:100-103` — the `doctor-stdout` listener is intentionally a **no-op** with comment "stdout from doctor is mostly section headers — ignore for check parsing." But the actual rows are on stdout — they are dropped on the floor.

### H3. `exit_code` snake/camel serde mismatch — CONFIRMED, HIGH (the red-badge mechanism)

`gambit/src-tauri/src/doctor.rs:69-73` — `#[serde(rename_all = "camelCase")] struct CompletePayload { exit_code: i32 }`. Rust emits JSON `{ "exitCode": 0 }`. `gambit/src/lib/useDoctor.ts:50-52, 117` — TypeScript reads `ev.payload.exit_code` which under the camelCase rename is `undefined`. `setExitCode(undefined)` runs at line 118. `gambit/src/routes/DoctorRoute.tsx:80` — `{doctor.exitCode !== null && (...)}`. `undefined !== null` is `true`, so the badge renders. `DoctorRoute.tsx:85-87` — `doctor.exitCode === 0 ? "var(--status-ok)" : "var(--status-error)"`. `undefined === 0` is `false` → **red**. `DoctorRoute.tsx:90` — `exit {doctor.exitCode}` → renders the string `exit undefined`. Same bug exists in `useSync.ts:55-57, 116` from commit `e317478`.

### H4–H7 — REJECTED

- H4 IPC shape: `start_doctor` snake_case params and `invoke("start_doctor", { projectPath })` are wired correctly per Tauri convention; sync proves the path works.
- H5 timing: `doctor.rs:204-228` explicitly `tokio::join!(stdout_task, stderr_task)` before `child.wait()`, so no drop window.
- H6 misclassification beyond the badge: downstream UX gap — when `state==="done" && checks.length===0`, no dashboard branch matches, render is silent — compounds the symptom but is not the root cause.
- H7 PATH/binary discovery: `doctor.rs:86-105` mirrors `sync.rs:82-103` correctly; the `~/.eidolons/nexus/cli/eidolons` fallback resolves; the child spawns. The fact that `exit undefined` appears proves `start_doctor` returned success.

### Stance

H1 + H2 + H3 are simultaneous, independent, and all required to fix the user-visible symptom. Any one alone produces "no rows" or "wrong badge"; all three together produce exactly the observed flash-then-red-no-rows.

## interventions

### P0-A — Rewrite `parseDoctorStderr.ts` to match real format

**File:** `gambit/src/lib/parseDoctorStderr.ts` — full file replacement.

Drop-in shape:

```ts
export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  index: number;
  total: number;
  category: string;
  name: string;
  status: CheckStatus;
  message: string;
}

const BANNER_RE   = /^[▸>]\s+eidolons doctor\b/;
const SECTION_RE  = /^===\s+(.+?)\s+===\s*$/;
const SUMMARY_OK_RE   = /^[✓]\s+All checks passed\.?\s*$/;
const SUMMARY_FAIL_RE = /^[!⚠]\s+\d+ issue/;
const CHECK_ROW_RE = /^\s{2,}([✓✗·!])\s+(.+?)\s*$/;
const UPGRADE_TRAILER_RE = /^\s{2,}·\s+Run `eidolons upgrade`/;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function glyphToStatus(g: string): CheckStatus {
  if (g === "✓") return "pass";
  if (g === "✗") return "fail";
  return "warn";
}

export function parseDoctorStderr(raw: string): DoctorCheck[] {
  if (!raw || !raw.trim()) return [];
  const checks: DoctorCheck[] = [];
  let currentCategory = "";
  let current: DoctorCheck | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = stripAnsi(rawLine);

    if (BANNER_RE.test(line) || SUMMARY_OK_RE.test(line) || SUMMARY_FAIL_RE.test(line)) continue;

    const section = line.match(SECTION_RE);
    if (section) {
      if (current) { checks.push(current); current = null; }
      currentCategory = section[1].trim();
      continue;
    }

    if (UPGRADE_TRAILER_RE.test(line)) {
      if (current) {
        current.message = current.message ? `${current.message}\n${line.trim()}` : line.trim();
      }
      continue;
    }

    const row = line.match(CHECK_ROW_RE);
    if (row) {
      if (current) checks.push(current);
      const [, glyph, name] = row;
      current = {
        index: checks.length + 1,
        total: 0,
        category: currentCategory,
        name: name.trim(),
        status: glyphToStatus(glyph),
        message: "",
      };
      continue;
    }

    if (current && /^\s{2,}\S/.test(line)) {
      current.message = current.message ? `${current.message}\n${line.trim()}` : line.trim();
    }
  }

  if (current) checks.push(current);
  const total = checks.length;
  for (const c of checks) c.total = total;
  return checks;
}
```

The `DoctorCheck.index/total` legacy fields stay (DoctorDashboard reads them); they're now derived after parsing. A new `category` field is added for future use.

### P0-B — Plumb stdout into the parser

**File:** `gambit/src/lib/useDoctor.ts:100-112`. Replace the no-op stdout listener with a real accumulator, and merge both streams into one buffer:

```ts
const appendLine = (text: string) => {
  rawStderrRef.current = rawStderrRef.current ? `${rawStderrRef.current}\n${text}` : text;
  setRawStderr(rawStderrRef.current);
  setChecks(parseDoctorStderr(rawStderrRef.current));
};

const unlistenStdout = await listen<LinePayload>("doctor-stdout", (ev) => {
  appendLine(ev.payload.line);
});

const unlistenStderr = await listen<LinePayload>("doctor-stderr", (ev) => {
  appendLine(ev.payload.line);
});
```

P1-C tracks the `rawStderr` → `rawOutput` rename (lying name post-fix). Land the critical-path with the old name; rename in a follow-up.

### P0-C — Fix `exit_code` field reads (camelCase wire format)

**Files:** `gambit/src/lib/useDoctor.ts:50-52, 117` AND `gambit/src/lib/useSync.ts:55-57, 116`.

```ts
// useDoctor.ts line 51 — was: exit_code: number;
interface CompletePayload {
  exitCode: number;
}

// useDoctor.ts line 117 — was: const code = ev.payload.exit_code;
const code = ev.payload.exitCode;
```

Identical change in `useSync.ts:56` and `:116`. Sync's red badge is masked by the streaming log but it's the same bug — land both.

### P0-D — Replace test fixture with verbatim real output

**Files:**
- `gambit/tests/parsers/doctor.fixture.txt` — overwrite with the real-output capture from the diagnose-prompt (or fresh `eidolons doctor 2>&1` capture, with $HOME path elided).
- `gambit/tests/unit/parseDoctorStderr.test.ts` — rewrite assertions against the new fixture:
  - `parseDoctorStderr(fixture).length === N` (N = count of glyph rows in capture).
  - `result[0]` is `{ category: "Manifest + lock", name: "eidolons.yaml present", status: "pass" }`.
  - At least one `warn` row from "Pending upgrades" carries non-empty category.
  - Idempotency: parse-then-parse-the-stringified-output equals the original.
  - ANSI-strip: wrap a glyph in `\x1b[32m...\x1b[0m`, parse identical to unwrapped.

### P1-A — Defensive "done-but-empty" branch in DoctorDashboard

`gambit/src/components/DoctorDashboard.tsx:150-238`. Add a render branch for `state === "done" && checks.length === 0` showing "Doctor ran but produced no parseable output" + "View raw" promotion. Today this branch is silent; surface future regressions.

### P1-B — Render `category` headings in dashboard

`DoctorDashboard.tsx:196-204` (the check grid map). Group by `check.category`, emit a `<h3>` between groups. Also drop the now-meaningless `[i/n]` badge from `CheckRow:85-87` — the real CLI doesn't index checks; show the glyph instead.

### P1-C — Rename `rawStderr` → `rawOutput`

Files: `useDoctor.ts`, `DoctorDashboard.tsx`, `DoctorRoute.tsx`. Naming-truth fix; combined stream is no longer "stderr only" post-P0-B.

### P2-A — Defensive guard on `exit undefined` rendering paths

`DoctorRoute.tsx:80`: change `{doctor.exitCode !== null && (...)}` to `{typeof doctor.exitCode === "number" && (...)}`. Apply the same guard in `DoctorDashboard.tsx:177` and `LogPane.tsx:124`. Belt-and-braces after P0-C.

### P2-B — Source-of-truth comment in `doctor.rs`

`doctor.rs:22-24` — update the "Parser note (GAP-03)" comment. Doctor output is glyph-anchored **stdout** with banner/summary on stderr; the existing comment claims stderr only.

## blame_target

APIVR-Δ. Three independent bugs shipped together in `729924b` (Rust spawn) and `e188e9a` (React parser + hook + dashboard), with vacuously-green 10/10 tests:

1. Parser regex `parseDoctorStderr.ts:71` written against an imagined CLI format (`[N/M] name glyph`) — a shape that does not exist in `eidolons/cli/src/doctor.sh` or `panel.sh`. The fabricated fixture at `tests/parsers/doctor.fixture.txt` perpetuated the fiction.
2. `useDoctor.ts:100-103` deliberately discards stdout with an unverified assumption that "stdout is mostly section headers". The actual check rows are on stdout via bare `printf` (no `>&2`).
3. `exit_code` field: Rust `#[serde(rename_all = "camelCase")]` in `doctor.rs:69` silently renames to `exitCode`; TypeScript reads `exit_code` and gets `undefined`. The Rust source comment at `doctor.rs:11` documents the wire schema as `{ exit_code: i32 }` — the rename happens AFTER the comment. The same bug propagated to `useSync.ts:56, 116` from copy-paste.

Re-issue with the explicit instruction to **capture `eidolons doctor` output verbatim before writing the parser**, and to **`console.log(ev.payload)` once** to diff the wire JSON against the TS interface. Both would have caught the bugs on first manual test.
