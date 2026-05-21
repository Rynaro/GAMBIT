// extract.rs — First-launch extraction of the bundled eidolons CLI tarball.
//
// Called from lib.rs setup() before the vibrancy block.  Idempotent: a
// second call is a no-op when the binary already exists and its SHA-256
// matches the pin declared in cli.pin.toml.
//
// Resources layout inside the Tauri bundle:
//   <resource_dir>/eidolons-cli.tar.gz   — the bundled tarball
//   <resource_dir>/cli.pin.toml          — version + expected SHA-256
//
// Tauri 2 resource dir:
//   app.path().resource_dir()
//   https://docs.rs/tauri/2/tauri/trait.Manager.html#method.path
//
// Target layout after extraction:
//   <app_data_dir>/cli/eidolons          — the executable
//
// On macOS app_data_dir is:
//   ~/Library/Application Support/dev.eidolons.gambit/
//
// On extraction failure the function logs a warning to stderr and returns
// Ok(()) so that the binary discovery chain falls through to PATH /
// ~/.eidolons/nexus/cli/eidolons.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, Read};
use std::path::Path;
use tauri::Manager;

// ---------------------------------------------------------------------------
// cli.pin.toml shape
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct CliPin {
    #[serde(rename = "eidolons-cli")]
    eidolons_cli: CliPinEntry,
}

#[derive(Debug, serde::Deserialize)]
struct CliPinEntry {
    version: String,
    sha256: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Run on Tauri setup().  Idempotent.
///
/// Steps:
///   1. Resolve bundled tarball: `<resource_dir>/eidolons-cli.tar.gz`.
///      If missing → Ok(()) (dev mode; no bundle present).
///   2. Resolve `<resource_dir>/cli.pin.toml`; parse version + sha256.
///   3. Resolve target: `<app_data_dir>/cli/eidolons`.
///   4. If target exists AND its sha256 matches pin → Ok(()) (already extracted).
///   5. Extract tarball to `<app_data_dir>/cli/`; verify SHA-256; chmod +x.
///   6. On any error: log warn to stderr, return Ok(()) so PATH fallback runs.
pub fn extract_bundled_cli_if_present(app: &tauri::AppHandle) -> Result<(), String> {
    // --- Step 1: locate tarball ---
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[bundled-cli] warn: could not resolve resource_dir: {e}");
            return Ok(());
        }
    };

    let tarball = resource_dir.join("eidolons-cli.tar.gz");
    if !tarball.exists() {
        // Dev mode or no bundle shipped — silently skip.
        return Ok(());
    }

    // --- Step 2: parse cli.pin.toml ---
    let pin_path = resource_dir.join("cli.pin.toml");
    let pin = match parse_pin(&pin_path) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[bundled-cli] warn: failed to parse cli.pin.toml: {e}");
            return Ok(());
        }
    };

    // Skip SHA check when placeholder is still in place (dev/pre-release).
    let sha_is_placeholder = pin.sha256.is_empty()
        || pin.sha256 == "PLACEHOLDER_FILL_AT_FIRST_RELEASE"
        || pin.sha256 == "<unbundled>";

    // --- Step 3: resolve target path ---
    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[bundled-cli] warn: could not resolve app_data_dir: {e}");
            return Ok(());
        }
    };
    let cli_dir = app_data_dir.join("cli");
    let target = cli_dir.join("eidolons");

    // --- Step 4: idempotency check ---
    if target.exists() && !sha_is_placeholder {
        match sha256_of_file(&target) {
            Ok(actual) if actual == pin.sha256 => {
                // Already extracted and verified — nothing to do.
                return Ok(());
            }
            Ok(actual) => {
                eprintln!(
                    "[bundled-cli] SHA mismatch on existing binary \
                     (expected {}, got {}); re-extracting.",
                    pin.sha256, actual
                );
            }
            Err(e) => {
                eprintln!("[bundled-cli] warn: could not hash existing binary: {e}; re-extracting.");
            }
        }
    }

    eprintln!(
        "[bundled-cli] extracting eidolons CLI v{} to {}",
        pin.version,
        cli_dir.display()
    );

    // --- Step 5: extract ---
    if let Err(e) = do_extract(&tarball, &cli_dir) {
        eprintln!("[bundled-cli] warn: extraction failed: {e}; falling through to PATH.");
        return Ok(());
    }

    // --- Step 5b: verify SHA-256 after extraction ---
    if !sha_is_placeholder {
        match sha256_of_file(&target) {
            Ok(actual) if actual == pin.sha256 => {
                eprintln!("[bundled-cli] SHA-256 verified OK.");
            }
            Ok(actual) => {
                eprintln!(
                    "[bundled-cli] warn: post-extraction SHA mismatch \
                     (expected {}, got {}); binary may be corrupt.",
                    pin.sha256, actual
                );
                // Remove the bad binary so next launch retries.
                let _ = fs::remove_file(&target);
                return Ok(());
            }
            Err(e) => {
                eprintln!("[bundled-cli] warn: could not verify extracted binary: {e}");
            }
        }
    }

    // --- Step 5c: chmod +x ---
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&target, fs::Permissions::from_mode(0o755)) {
            eprintln!("[bundled-cli] warn: chmod +x failed: {e}");
        }
    }

    eprintln!(
        "[bundled-cli] eidolons CLI v{} ready at {}",
        pin.version,
        target.display()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse `cli.pin.toml` and return the pin entry.
fn parse_pin(path: &Path) -> Result<CliPinEntry, String> {
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let parsed: CliPin = toml::from_str(&contents)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(parsed.eidolons_cli)
}

/// Compute the hex-encoded SHA-256 of a file.
fn sha256_of_file(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Extract `tarball` (gzip-compressed tar) into `dest_dir`, creating it if
/// necessary.  The tarball is expected to contain files at the top level
/// (or one strip-components-1 directory); we extract everything flat into
/// `dest_dir`.
fn do_extract(tarball: &Path, dest_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("create_dir_all {}: {e}", dest_dir.display()))?;

    let file = fs::File::open(tarball)
        .map_err(|e| format!("open {}: {e}", tarball.display()))?;
    let gz = flate2::read::GzDecoder::new(BufReader::new(file));
    let mut archive = tar::Archive::new(gz);

    archive
        .unpack(dest_dir)
        .map_err(|e| format!("unpack to {}: {e}", dest_dir.display()))?;

    Ok(())
}
