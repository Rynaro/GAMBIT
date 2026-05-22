// binary.rs — Shared eidolons binary discovery.
//
// All Rust modules that need to spawn `eidolons` call `find_eidolons(&app)`
// from this module.  The discovery chain has three levels:
//
//   1. Bundled-extracted  — <app_data_dir>/cli/eidolons
//      Populated by extract::extract_bundled_cli_if_present() on first launch.
//      On macOS the data dir is ~/Library/Application Support/dev.eidolons.gambit/
//      Tauri 2 API reference: tauri::Manager::path().app_data_dir()
//      https://docs.rs/tauri/2/tauri/trait.Manager.html#method.path
//
//   2. PATH lookup — which::which("eidolons")
//      Honours the user's $PATH; covers standard nexus curl-pipe installs.
//
//   3. Conventional fallback — $HOME/.eidolons/nexus/cli/eidolons
//      Hard-coded nexus install location for when $PATH is not wired.
//
// Returns Err only when all three levels fail.  Callers should surface the
// message via their own Err propagation (already the pattern in sync/doctor/
// upgrade/mcp).

use std::path::PathBuf;
use serde::Serialize;
use tauri::Manager;

/// Locate the `eidolons` CLI binary to spawn.
///
/// Discovery order:
///   1. Bundled-extracted: `<app_data_dir>/cli/eidolons`
///      (`app_data_dir` is resolved via Tauri 2's `app.path().app_data_dir()`).
///      On macOS this resolves to
///      `~/Library/Application Support/dev.eidolons.gambit/`.
///   2. PATH lookup via `which::which("eidolons")`.
///   3. Fallback to `$HOME/.eidolons/nexus/cli/eidolons`.
///
/// Returns an error string if all three levels fail.
pub fn find_eidolons(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // --- Level 1: bundled-extracted binary ---
    // Tauri 2 resolves the app-specific data directory via the path API.
    // On macOS: ~/Library/Application Support/<bundle-id>/
    // Ref: https://docs.rs/tauri/2/tauri/trait.Manager.html
    if let Ok(data_dir) = app.path().app_data_dir() {
        let bundled = data_dir.join("cli").join("eidolons");
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // --- Level 2: PATH lookup ---
    if let Ok(path) = which::which("eidolons") {
        return Ok(path);
    }

    // --- Level 3: conventional fallback ---
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "$HOME is not set; cannot resolve fallback eidolons path".to_string())?;
    let fallback = home
        .join(".eidolons")
        .join("nexus")
        .join("cli")
        .join("eidolons");
    if fallback.exists() {
        return Ok(fallback);
    }

    Err(
        "eidolons CLI not found (bundled, PATH, ~/.eidolons/nexus/cli/eidolons). \
         Run the curl-pipe installer: \
         curl -fsSL https://raw.githubusercontent.com/Rynaro/eidolons/main/cli/install.sh | bash"
            .to_string(),
    )
}

/// Resolve an arbitrary host tool (e.g. `"claude"`, `"sh"`) to a runnable path.
///
/// Unlike `find_eidolons`, this is host-agnostic — it makes no assumption
/// about a bundled-extracted copy or a nexus fallback location. Discovery
/// order:
///   1. Caller-supplied `override_path`, if `Some` and it exists on disk.
///   2. PATH lookup via `which::which(name)`.
///
/// Returns an error string if neither level resolves. Used by S4
/// (`session.rs`) to launch a host tool with piped stdio.
///
/// `_app` is accepted for signature parity with `find_eidolons` and to
/// leave room for an app-data-dir discovery level later; it is currently
/// unused.
#[allow(dead_code)] // wired up by S4 (session.rs)
pub fn find_host_tool(
    _app: &tauri::AppHandle,
    name: &str,
    override_path: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    resolve_host_tool(name, override_path)
}

/// `AppHandle`-free core of `find_host_tool`.
///
/// Split out so it can be unit-tested without constructing a Tauri app.
/// Discovery order matches `find_host_tool`'s doc-comment:
///   1. Caller-supplied `override_path`, if `Some` and it exists on disk.
///   2. PATH lookup via `which::which(name)`.
#[allow(dead_code)] // wired up by S4 (session.rs)
fn resolve_host_tool(
    name: &str,
    override_path: Option<&std::path::Path>,
) -> Result<PathBuf, String> {
    // --- Level 1: caller-supplied override ---
    if let Some(p) = override_path {
        if p.exists() {
            return Ok(p.to_path_buf());
        }
        return Err(format!(
            "host tool override path does not exist: {}",
            p.display()
        ));
    }

    // --- Level 2: PATH lookup ---
    if let Ok(path) = which::which(name) {
        return Ok(path);
    }

    Err(format!(
        "host tool '{name}' not found on PATH; \
         supply an explicit override path or install it"
    ))
}

/// Probe all three discovery levels and return a status snapshot.
///
/// Used by the `binary_status` IPC command so the Settings panel can
/// display which discovery source is active without actually spawning anything.
pub struct BinaryProbe {
    /// Path returned by the bundled-extracted check (level 1), if it exists.
    pub bundled_path: Option<PathBuf>,
    /// Whether the bundled binary file actually exists on disk.
    pub bundled_extracted: bool,
    /// Path found via PATH lookup (level 2), if present.
    pub path_lookup: Option<PathBuf>,
    /// Whether the conventional nexus fallback exists (level 3).
    pub nexus_fallback_exists: bool,
    /// The nexus fallback path (whether or not it exists).
    pub nexus_fallback_path: Option<PathBuf>,
}

/// Probe all three discovery levels without short-circuiting.
///
/// Unlike `find_eidolons` this always checks all three levels, so the
/// Settings panel can show the full picture.
pub fn probe_all(app: &tauri::AppHandle) -> BinaryProbe {
    // Level 1 — bundled extraction dir
    let (bundled_path, bundled_extracted) = if let Ok(data_dir) = app.path().app_data_dir() {
        let p = data_dir.join("cli").join("eidolons");
        let exists = p.exists();
        (Some(p), exists)
    } else {
        (None, false)
    };

    // Level 2 — PATH
    let path_lookup = which::which("eidolons").ok();

    // Level 3 — conventional fallback
    let (nexus_fallback_path, nexus_fallback_exists) =
        if let Ok(home) = std::env::var("HOME").map(PathBuf::from) {
            let p = home
                .join(".eidolons")
                .join("nexus")
                .join("cli")
                .join("eidolons");
            let exists = p.exists();
            (Some(p), exists)
        } else {
            (None, false)
        };

    BinaryProbe {
        bundled_path,
        bundled_extracted,
        path_lookup,
        nexus_fallback_exists,
        nexus_fallback_path,
    }
}

// ---------------------------------------------------------------------------
// binary_status IPC command — moved out of lib.rs to dodge the Tauri 2
// duplicate-macro pitfall when #[tauri::command] lives next to
// tauri::generate_handler! in the same module.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub resolved_path: Option<String>,
    pub bundled_extracted: bool,
    pub bundled_path: Option<String>,
    pub path_lookup: Option<String>,
    pub nexus_fallback_exists: bool,
    pub nexus_fallback_path: Option<String>,
}

#[tauri::command]
pub fn binary_status(app: tauri::AppHandle) -> BinaryStatus {
    let probe = probe_all(&app);
    let resolved_path = find_eidolons(&app)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    BinaryStatus {
        resolved_path,
        bundled_extracted: probe.bundled_extracted,
        bundled_path: probe.bundled_path.map(|p| p.to_string_lossy().into_owned()),
        path_lookup: probe.path_lookup.map(|p| p.to_string_lossy().into_owned()),
        nexus_fallback_exists: probe.nexus_fallback_exists,
        nexus_fallback_path: probe.nexus_fallback_path.map(|p| p.to_string_lossy().into_owned()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// `find_host_tool` takes an `AppHandle` purely for signature parity; its
// real logic lives in the `AppHandle`-free `resolve_host_tool` core, which
// is what these tests exercise. Kept hermetic: PATH-only, no network, no
// fixtures. (First Rust tests in the repo — establishes the pattern.)

#[cfg(test)]
mod tests {
    use super::resolve_host_tool;
    use std::path::Path;

    /// A binary guaranteed to be on PATH on Unix resolves to an existing path.
    #[test]
    #[cfg(unix)]
    fn resolves_known_path_binary() {
        let resolved = resolve_host_tool("sh", None)
            .expect("`sh` should resolve on any unix PATH");
        assert!(
            resolved.exists(),
            "resolved path should exist on disk: {}",
            resolved.display()
        );
    }

    /// A guaranteed-absent tool name returns an Err mentioning the name.
    #[test]
    fn absent_tool_returns_err() {
        let name = "gambit-definitely-not-a-real-tool-zzz";
        let err = resolve_host_tool(name, None)
            .expect_err("a nonexistent tool must not resolve");
        assert!(
            err.contains(name),
            "error should name the missing tool, got: {err}"
        );
    }

    /// An explicit override path that exists is returned verbatim, bypassing PATH.
    #[test]
    fn override_path_that_exists_is_returned() {
        // The test source file itself is a guaranteed-present path.
        let here = Path::new(file!());
        if !here.exists() {
            // `file!()` is workspace-relative; skip if cwd makes it unresolvable.
            return;
        }
        let resolved = resolve_host_tool("irrelevant-name", Some(here))
            .expect("an existing override path should resolve");
        assert_eq!(resolved, here);
    }

    /// An override path that does not exist is an Err, even for a real tool name.
    #[test]
    fn override_path_that_is_missing_returns_err() {
        let missing = Path::new("/nonexistent/gambit/host/tool/zzz");
        let err = resolve_host_tool("sh", Some(missing))
            .expect_err("a missing override path must not resolve");
        assert!(
            err.contains("override path does not exist"),
            "error should explain the missing override, got: {err}"
        );
    }
}
