---
thread_id: 90b29d6b-5058-4286-bd7d-d7bb076b98c7
from: apivr@3.1.2
to: idg@1.2.2
branch: feat/v0.2-bundled-cli
commits:
  - cb0d5e4
  - c01815e
date: 2026-05-21T00:00:00Z
---

## What was done

Closed FU1 for GAMBIT v0.2: bundled `eidolons` CLI extraction on first launch with SHA-256 verification, plus a consolidated binary discovery module and a Settings panel showing discovery status.

**Piece 1 — `src-tauri/src/binary.rs` (new)**
Shared `find_eidolons(&AppHandle)` with a three-level discovery chain: (1) bundled-extracted at `<app_data_dir>/cli/eidolons` resolved via Tauri 2's `app.path().app_data_dir()`, (2) `which::which("eidolons")` PATH lookup, (3) `$HOME/.eidolons/nexus/cli/eidolons` conventional fallback. Also exposes `probe_all()` which walks all three levels without short-circuiting, used by the Settings panel.

**Piece 2 — refactor `sync.rs`, `doctor.rs`, `upgrade.rs`, `mcp.rs`**
Deleted the four duplicated `find_eidolons_binary()` helpers. All call sites now call `binary::find_eidolons(&app)`. `check_upgrades` and `mcp_list` gained `app: AppHandle` in their Tauri command signature (Tauri injects it automatically; TS `invoke` callers are unaffected).

**Piece 3 — `src-tauri/src/extract.rs` (new)**
`extract_bundled_cli_if_present(&AppHandle)` — idempotent first-launch extractor. Reads `<resource_dir>/eidolons-cli.tar.gz` and `<resource_dir>/cli.pin.toml`, checks whether the target binary already exists with a matching SHA-256, and if not extracts via `flate2` + `tar`, verifies SHA, and `chmod +x`. On any error it logs a warning to stderr and returns `Ok(())` so the discovery chain falls through to PATH. Called from `lib.rs` setup() before vibrancy.

**Piece 4 — `binary_status` IPC + `SettingsRoute.tsx`**
New `binary_status` Tauri command returns a `BinaryStatus` struct with `resolvedPath`, `bundledExtracted`, `bundledPath`, `pathLookup`, `nexusFallbackExists`, `nexusFallbackPath`. SettingsRoute calls `invoke("binary_status")` on mount and renders a "CLI Binary" section with three discovery-source rows, colour-coded with `--status-ok` / `--text-muted` tokens.

**Piece 5 — `cli.pin.toml`**
Verified: version `1.3.0`, sha256 `PLACEHOLDER_FILL_AT_FIRST_RELEASE`. The extractor treats any placeholder value as a signal to skip the SHA check — the binary is extracted but not verified. This is the correct behaviour for v0.2 (no real tarball shipped yet). The placeholder note is preserved in the file comment.

**`Cargo.toml`** — added `flate2 = "1"`, `tar = "0.4"`, `sha2 = "0.10"`, `toml = "0.8"`.

## Files touched

**New:**
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/binary.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/extract.rs`

**Modified:**
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/lib.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/sync.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/doctor.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/upgrade.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/src/mcp.rs`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src-tauri/Cargo.toml`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/src/routes/SettingsRoute.tsx`

**Thread artefacts:**
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/.junction/threads/90b29d6b-5058-4286-bd7d-d7bb076b98c7/apivr-completion-report.md`
- `/Users/henrique/workspace/oss/agents/gambit-bundled-cli/.junction/threads/90b29d6b-5058-4286-bd7d-d7bb076b98c7/ecl-envelope.json`

## Failures and why

No blocking failures. One known pre-existing limitation carried as documented:

**No real tarball bundled for v0.2.** `cli.pin.toml` has `sha256 = "PLACEHOLDER_FILL_AT_FIRST_RELEASE"`. There is no `src-tauri/resources/eidolons-cli.tar.gz` present in the repository. The extractor gracefully handles this: when the tarball file is missing it returns `Ok(())` immediately (dev mode path); when the SHA is a placeholder it skips verification after extraction. The full bundling pipeline (`scripts/fetch-cli.sh` + GitHub Actions workflow to vendor the tarball pre-build) is explicitly scoped to v1.0 per the mission brief.

The `resources/` directory under `src-tauri/` is empty — Tauri will not include any bundled resources in the app package until the tarball is placed there and `tauri.conf.json` is updated to include it. This is intentional; the infrastructure is in place, the build-time glue is v1.0.

## Open questions for IDG

1. **`tauri.conf.json` resources array** — for the first real bundled release (v1.0), `src-tauri/tauri.conf.json` will need a `"resources": ["resources/eidolons-cli.tar.gz", "resources/cli.pin.toml"]` entry added. Worth noting in the changelog entry so the release engineer knows what to wire up.

2. **Linux/Windows discovery paths** — `app.path().app_data_dir()` resolves to `~/.local/share/dev.eidolons.gambit/` on Linux and `%APPDATA%\dev.eidolons.gambit\` on Windows. The discovery code is platform-aware via Tauri's path API but has only been exercised on macOS. Worth a note in the v1.0 cross-platform QA checklist.

Hand-off to IDG to chronicle the bundled-CLI infra alongside the v0.2 wave.
