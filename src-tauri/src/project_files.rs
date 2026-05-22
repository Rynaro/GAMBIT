// project_files.rs — a one-shot Tauri command listing a project's files.
//
// Story P9 — the SessionComposer's `@`-file mention picker needs the project's
// file paths so typing `@` opens a filtered file dropdown. There is no
// streaming and no events here: this is a single synchronous walk, mirroring
// the `claude_auth_status` one-shot pre-flight shape (resolve → do work →
// return a typed `Result`).
//
// The walk runs over the OS filesystem with plain `std::fs` — the Tauri `fs`
// plugin capability scopes only the JS-side plugin, not Rust-side `std::fs`, so
// no capability change is needed. It returns RELATIVE paths (forward-slashed)
// so the composer can insert a clean `@relative/path` token regardless of host.
//
// Noise control — directories that are large, generated, or VCS metadata are
// skipped wholesale (`.git`, `node_modules`, `target`, `dist`, `.pnpm-store`,
// `src-tauri/target`, and any dot-prefixed directory). The result is also
// hard-capped at `MAX_FILES` entries so a pathologically large repo cannot hang
// the UI: the walk simply stops once the cap is reached.

use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Upper bound on the number of file paths returned. A few thousand entries is
/// plenty for the composer's filtered dropdown, and the cap keeps a huge repo
/// from hanging the walk / flooding the IPC boundary.
const MAX_FILES: usize = 4000;

/// Directory names skipped wholesale during the walk — large, generated, or
/// VCS-metadata directories that would only add noise to the file picker. Any
/// directory whose name additionally starts with `.` is skipped too (see
/// [`is_noise_dir`]).
const NOISE_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".pnpm-store",
];

// ---------------------------------------------------------------------------
// Pure helpers — unit-tested below.
// ---------------------------------------------------------------------------

/// Whether a directory `name` should be skipped during the walk.
///
/// True for an explicit [`NOISE_DIRS`] entry OR any dot-prefixed directory
/// (`.cache`, `.venv`, `.idea`, …). Kept pure so the skip policy is directly
/// unit-testable without touching the filesystem.
fn is_noise_dir(name: &str) -> bool {
    name.starts_with('.') || NOISE_DIRS.contains(&name)
}

/// Recursively collect the relative file paths under `dir` into `out`.
///
/// `root` is the project root the returned paths are made relative to; `dir` is
/// the directory currently being walked. Paths are forward-slashed so the
/// composer inserts a host-independent `@relative/path` token. The walk stops
/// early once `out` reaches [`MAX_FILES`] — a bounded, never-hangs guarantee.
///
/// `src-tauri/target` is covered by the bare `target` entry in [`NOISE_DIRS`]
/// (the walk skips a `target` directory at any depth). Unreadable directories
/// are silently skipped — a permission error on one subtree must not fail the
/// whole listing.
fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
    if out.len() >= MAX_FILES {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        // An unreadable directory is skipped, not fatal.
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            if is_noise_dir(&name) {
                continue;
            }
            walk(root, &path, out);
        } else if file_type.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                // Forward-slash the path so the inserted token is the same on
                // every host (Windows back-slashes would otherwise leak in).
                let rel = rel.to_string_lossy().replace('\\', "/");
                if !rel.is_empty() {
                    out.push(rel);
                }
            }
        }
    }
}

/// Walk `root` and return its relative file paths, sorted, capped at
/// [`MAX_FILES`]. The pure core of [`list_project_files`] — testable without
/// Tauri.
fn collect_project_files(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Tauri command: list a project's files as relative paths for the composer's
/// `@`-mention file picker (story P9).
///
/// A one-shot (no events): validates `project_path` exists and is a directory,
/// walks it with `std::fs` skipping the noise directories, and returns the
/// relative, forward-slashed file paths sorted alphabetically and capped at
/// [`MAX_FILES`].
///
/// `Err` is reserved for a genuinely unusable path (missing, or not a
/// directory) so the composer can surface a clean reason; a readable-but-empty
/// project simply returns an empty `Vec`.
#[tauri::command]
pub async fn list_project_files(project_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&project_path);
    if !root.exists() {
        return Err(format!("project path does not exist: {project_path}"));
    }
    if !root.is_dir() {
        return Err(format!("project path is not a directory: {project_path}"));
    }
    Ok(collect_project_files(root))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Hermetic: a temp directory tree is built under `std::env::temp_dir()`, the
// pure `collect_project_files` / `is_noise_dir` seams are exercised, and the
// tree is removed. No Tauri app, no `claude`.

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Build a unique temp project root for one test, returning its path.
    fn temp_root(tag: &str) -> PathBuf {
        let mut root = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        root.push(format!("gambit-pf-{tag}-{nanos}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn is_noise_dir_flags_generated_and_dot_dirs() {
        assert!(is_noise_dir(".git"));
        assert!(is_noise_dir("node_modules"));
        assert!(is_noise_dir("target"));
        assert!(is_noise_dir("dist"));
        assert!(is_noise_dir(".pnpm-store"));
        // Any dot-prefixed directory is noise.
        assert!(is_noise_dir(".cache"));
        assert!(is_noise_dir(".venv"));
        // Ordinary source directories are kept.
        assert!(!is_noise_dir("src"));
        assert!(!is_noise_dir("components"));
        assert!(!is_noise_dir("src-tauri"));
    }

    #[test]
    fn walk_skips_noise_dirs_and_returns_relative_paths() {
        let root = temp_root("skip");

        // Real source files.
        fs::create_dir_all(root.join("src/components")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("src/components/App.tsx"), "export {}").unwrap();
        fs::write(root.join("README.md"), "# project").unwrap();

        // Noise directories that must NOT be walked.
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "module.exports={}").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "[core]").unwrap();
        fs::create_dir_all(root.join("target/debug")).unwrap();
        fs::write(root.join("target/debug/app"), "binary").unwrap();
        fs::create_dir_all(root.join("src-tauri/target")).unwrap();
        fs::write(root.join("src-tauri/target/app"), "binary").unwrap();
        fs::write(root.join("src-tauri/lib.rs"), "// lib").unwrap();

        let files = collect_project_files(&root);

        // Relative paths, forward-slashed, sorted.
        assert_eq!(
            files,
            vec![
                "README.md".to_string(),
                "src-tauri/lib.rs".to_string(),
                "src/components/App.tsx".to_string(),
                "src/main.rs".to_string(),
            ]
        );

        // No noise-directory file leaked in.
        assert!(files.iter().all(|f| !f.contains("node_modules")));
        assert!(files.iter().all(|f| !f.starts_with(".git")));
        assert!(files.iter().all(|f| !f.contains("target/")));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collect_handles_empty_project() {
        let root = temp_root("empty");
        let files = collect_project_files(&root);
        assert!(files.is_empty(), "an empty project yields no files");
        fs::remove_dir_all(&root).ok();
    }
}
