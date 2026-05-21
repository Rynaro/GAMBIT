// parseDoctorStderr.ts — Pure parser for `eidolons doctor` stderr output.
//
// The doctor CLI (cli/src/doctor.sh) emits glyph-anchored lines on stderr:
//
//   ==> Doctor — 9 checks
//   [1/9] eidolons.lock present              ✓
//   [2/9] install manifests valid            ✓
//   [3/9] host wiring complete               ✗
//         → CLAUDE.md missing eidolon:spectra block
//   [4/9] integrity (verified/legacy/missing) ·
//         → 1 member in legacy-warning state
//   ...
//   ==> 1 ERROR, 1 WARN
//
// Glyph mapping:
//   ✓  (U+2713 CHECK MARK)      → "pass"
//   ✗  (U+2717 BALLOT X)        → "fail"
//   ·  (U+00B7 MIDDLE DOT)      → "warn"
//   !  (ASCII !)                 → "warn"  (used by some UID-pin warn lines)
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
  /** 1-based check index. */
  index: number;
  /** Total number of checks in this run (from the [N/M] badge). */
  total: number;
  /** Human-readable check name (trimmed). */
  name: string;
  /** Parsed status from the glyph at end of the check line. */
  status: CheckStatus;
  /** Verbatim continuation lines (the → indented detail body). May be empty. */
  message: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Strip ANSI escape sequences from a string. */
function stripAnsi(raw: string): string {
  // ESC [ ... m sequences + ESC [ ... non-m sequences
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * Regex that matches a check-header line.
 *
 * Groups:
 *   1 — index   (numeric)
 *   2 — total   (numeric)
 *   3 — name    (rest of line up to the glyph; trimmed)
 *   4 — glyph   (✓ | ✗ | · | !)
 *
 * The glyph is optional on the header line (some multi-line checks emit the
 * glyph on an indented continuation line, though the current doctor.sh
 * implementation always emits it on the header).
 */
const CHECK_LINE_RE =
  /^\s*\[(\d+)\/(\d+)\]\s+(.+?)\s+([✓✗·!])\s*$/;

/**
 * Regex that matches a check-header line that ends without a glyph —
 * used as a fallback when the status glyph is absent on the header.
 */
const CHECK_LINE_NO_GLYPH_RE = /^\s*\[(\d+)\/(\d+)\]\s+(.+?)\s*$/;

/** Regex for an indented continuation/detail line (→ …). */
const DETAIL_LINE_RE = /^\s+[→>]\s+(.*)$/;

/** Map the four recognised glyphs to DoctorCheck status values. */
function glyphToStatus(glyph: string): CheckStatus {
  if (glyph === "✓") return "pass"; // ✓
  if (glyph === "✗") return "fail"; // ✗
  if (glyph === "·" || glyph === "!") return "warn"; // · or !
  return "warn"; // safe default
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse raw `eidolons doctor` stderr text into a structured array of checks.
 *
 * Returns an empty array for empty / whitespace-only input.
 * Is idempotent: calling it twice with the same input produces the same output.
 */
export function parseDoctorStderr(raw: string): DoctorCheck[] {
  if (!raw || !raw.trim()) return [];

  const checks: DoctorCheck[] = [];
  let current: DoctorCheck | null = null;

  for (const rawLine of raw.split("\n")) {
    const line = stripAnsi(rawLine);

    // Try to match a check-header line (with glyph at end).
    const headerMatch = line.match(CHECK_LINE_RE);
    if (headerMatch) {
      // Push the previous check (if any) before starting a new one.
      if (current) checks.push(current);

      const [, idxStr, totalStr, nameRaw, glyph] = headerMatch;
      current = {
        index: parseInt(idxStr, 10),
        total: parseInt(totalStr, 10),
        name: nameRaw.trim(),
        status: glyphToStatus(glyph),
        message: "",
      };
      continue;
    }

    // Try to match a check-header line WITHOUT a glyph (multi-line form).
    const noGlyphMatch = line.match(CHECK_LINE_NO_GLYPH_RE);
    if (noGlyphMatch) {
      if (current) checks.push(current);
      const [, idxStr, totalStr, nameRaw] = noGlyphMatch;
      // Default to "warn" when no glyph found yet; detail lines may carry it.
      current = {
        index: parseInt(idxStr, 10),
        total: parseInt(totalStr, 10),
        name: nameRaw.trim(),
        status: "warn",
        message: "",
      };
      continue;
    }

    // Detail continuation lines (→ …) or plain indented lines.
    if (current) {
      const detailMatch = line.match(DETAIL_LINE_RE);
      if (detailMatch) {
        const detail = detailMatch[1].trim();

        // Check if the detail line itself carries a terminal glyph (rare but possible).
        const terminalGlyph = detail.match(/([✓✗·!])\s*$/);
        if (terminalGlyph && current.status === "warn" && current.message === "") {
          // Override the default "warn" status from the header-without-glyph path.
          current.status = glyphToStatus(terminalGlyph[1]);
        }

        current.message = current.message
          ? `${current.message}\n${detail}`
          : detail;
        continue;
      }

      // Generic indented line (no → prefix) — append to message.
      if (/^\s{2,}/.test(line) && line.trim().length > 0) {
        const trimmed = line.trim();
        // Skip summary lines like "==> N ERROR(S), M WARN(S)".
        if (/^==>/.test(trimmed)) continue;
        current.message = current.message
          ? `${current.message}\n${trimmed}`
          : trimmed;
      }
    }
  }

  // Flush the last open check.
  if (current) checks.push(current);

  return checks;
}
