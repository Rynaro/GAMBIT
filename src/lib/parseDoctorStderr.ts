// parseDoctorStderr.ts — Pure parser for `eidolons doctor` combined output.
//
// The doctor CLI emits:
//   - Category headings on stdout:  === Foo Bar ===
//   - Check rows on stdout:         "  ✓ check name" or "  · check name" or "  ✗ check name"
//   - Banner on stderr:             "▸ eidolons doctor — checking ..."
//   - Summary on stderr:            "✓ All checks passed." or "! N issue(s)"
//
// Glyph mapping (glyph at START of row, after 2+ spaces):
//   ✓  (U+2713 CHECK MARK)      → "pass"
//   ✗  (U+2717 BALLOT X)        → "fail"
//   ·  (U+00B7 MIDDLE DOT)      → "warn"
//   !  (ASCII !)                 → "warn"
//
// Note on ANSI: the CLI wraps glyphs in ANSI color codes. The ANSI escape
// sequences are stripped before glyph matching so the parser remains
// independent of terminal colour settings.
//
// Idempotency guarantee: parsing the same text twice returns an equal array.
// The parser is pure (no side effects) and stateless.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  /** 1-based check index (derived after parse — not from CLI output). */
  index: number;
  /** Total number of checks in this run (derived after parse). */
  total: number;
  /** Category heading this check belongs to (from === Foo === lines). */
  category: string;
  /** Human-readable check name (trimmed). */
  name: string;
  /** Parsed status from the glyph at start of the check line. */
  status: CheckStatus;
  /** Verbatim continuation lines (indented detail body). May be empty. */
  message: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const BANNER_RE       = /^[▸>]\s+eidolons doctor\b/;
const SECTION_RE      = /^===\s+(.+?)\s+===\s*$/;
const SUMMARY_OK_RE   = /^[✓]\s+All checks passed\.?\s*$/;
const SUMMARY_FAIL_RE = /^[!⚠]\s+\d+ issue/;
const CHECK_ROW_RE    = /^\s{2,}([✓✗·!])\s+(.+?)\s*$/;
const UPGRADE_TRAILER_RE = /^\s{2,}[·!]\s+Run `eidolons upgrade`/;

/** Strip ANSI escape sequences from a string. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Map the four recognised glyphs to DoctorCheck status values. */
function glyphToStatus(g: string): CheckStatus {
  if (g === "✓") return "pass";
  if (g === "✗") return "fail";
  return "warn"; // · or !
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw `eidolons doctor` combined output (stdout + stderr merged) into a
 * structured array of checks.
 *
 * Returns an empty array for empty / whitespace-only input.
 * Is idempotent: calling it twice with the same input produces the same output.
 */
export function parseDoctorStderr(raw: string): DoctorCheck[] {
  if (!raw || !raw.trim()) return [];
  const checks: DoctorCheck[] = [];
  let currentCategory = "";
  let current: DoctorCheck | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = stripAnsi(rawLine);

    // Skip banner + summary lines (they are informational, not check rows).
    if (BANNER_RE.test(line) || SUMMARY_OK_RE.test(line) || SUMMARY_FAIL_RE.test(line)) continue;

    // Category section heading: === Foo Bar ===
    const section = line.match(SECTION_RE);
    if (section) {
      if (current) { checks.push(current); current = null; }
      currentCategory = section[1].trim();
      continue;
    }

    // Upgrade trailer line (  · Run `eidolons upgrade` to apply.)
    // Attach as message continuation to the previous check if present.
    if (UPGRADE_TRAILER_RE.test(line)) {
      if (current) {
        current.message = current.message
          ? `${current.message}\n${line.trim()}`
          : line.trim();
      }
      continue;
    }

    // Check row: "  ✓ check name" (glyph at start after leading whitespace).
    const row = line.match(CHECK_ROW_RE);
    if (row) {
      if (current) checks.push(current);
      const [, glyph, name] = row;
      current = {
        index: checks.length + 1, // placeholder; corrected below
        total: 0,                  // placeholder; corrected below
        category: currentCategory,
        name: name.trim(),
        status: glyphToStatus(glyph),
        message: "",
      };
      continue;
    }

    // Indented continuation / detail line (no glyph at start).
    if (current && /^\s{2,}\S/.test(line)) {
      current.message = current.message
        ? `${current.message}\n${line.trim()}`
        : line.trim();
    }
  }

  // Flush the last open check.
  if (current) checks.push(current);

  // Back-fill index + total now that we know the final count.
  const total = checks.length;
  for (let i = 0; i < checks.length; i++) {
    checks[i].index = i + 1;
    checks[i].total = total;
  }

  return checks;
}
