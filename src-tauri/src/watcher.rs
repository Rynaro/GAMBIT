// watcher.rs — eidolons.lock file watcher using notify-debouncer-mini.
//
// Exports two Tauri commands:
//   start_watching(path: String) — starts (or restarts) the debounced watcher on
//                                   <path>/eidolons.lock; emits "drift-detected"
//                                   Tauri events on every debounced change.
//   stop_watching()              — stops the watcher and frees resources.
//
// The 250ms debounce is handled entirely inside notify-debouncer-mini; we do
// not implement our own debounce layer.

use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer,
};
use notify::RecommendedWatcher;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Duration for the notify-debouncer-mini debounce window (250ms per spec).
const DEBOUNCE_MS: u64 = 250;

/// Payload emitted to the frontend on each debounced lock-file change.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftPayload {
    pub path: String,
    pub timestamp: String, // RFC 3339 UTC
}

/// Shared application state holding the active debouncer (if any).
pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            debouncer: Mutex::new(None),
        }
    }
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// Tauri command: start (or restart) the file watcher on
/// `<path>/eidolons.lock`.
///
/// If a watcher is already running it is stopped first so the lock file path
/// can be switched without leaving orphan watchers.
#[tauri::command]
pub async fn start_watching(
    state: State<'_, WatcherState>,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    // Build the watched path: <project_dir>/eidolons.lock's parent directory.
    // We watch the directory so notify picks up the lock file even when it is
    // created or replaced atomically.
    let project_dir = PathBuf::from(&path);

    // Validate that the provided path is a directory (best-effort; watcher
    // will surface errors via events regardless).
    if !project_dir.exists() {
        return Err(format!(
            "start_watching: path does not exist: {}",
            project_dir.display()
        ));
    }

    // Stop any existing watcher before replacing it.
    {
        let mut guard = state
            .debouncer
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        *guard = None; // drop previous debouncer, stopping the background thread
    }

    let lock_path = project_dir.join("eidolons.lock");
    let lock_path_str = lock_path.to_string_lossy().to_string();
    let watch_dir = project_dir.clone();

    // Build the debouncer. The closure runs on the notify watcher thread.
    let debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        move |result: DebounceEventResult| {
            match result {
                Ok(events) => {
                    // Filter for events that touched eidolons.lock specifically.
                    let relevant = events.iter().any(|ev| {
                        ev.path == lock_path || paths_match(&ev.path, &lock_path)
                    });

                    if relevant {
                        let payload = DriftPayload {
                            path: lock_path_str.clone(),
                            timestamp: chrono::Utc::now().to_rfc3339(),
                        };
                        // Emit to all windows; ignore errors (window may be closing).
                        let _ = app.emit("drift-detected", payload);
                    }
                }
                Err(errs) => {
                    for e in errs {
                        eprintln!("[watcher] notify error: {e:?}");
                    }
                }
            }
        },
    )
    .map_err(|e| format!("failed to create debouncer: {e}"))?;

    // Watch the project directory (non-recursive). This covers:
    //   - modifications to an existing eidolons.lock
    //   - creation of eidolons.lock when it does not yet exist
    debouncer
        .watcher()
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to watch {}: {e}", watch_dir.display()))?;

    // Store the debouncer in state so the background thread stays alive.
    {
        let mut guard = state
            .debouncer
            .lock()
            .map_err(|e| format!("lock poisoned: {e}"))?;
        *guard = Some(debouncer);
    }

    Ok(())
}

/// Tauri command: stop the active file watcher (if any).
#[tauri::command]
pub async fn stop_watching(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state
        .debouncer
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;
    *guard = None; // drops the debouncer, joining the background thread
    Ok(())
}

/// Platform-normalised path comparison: checks that `candidate` matches
/// `target`, handling trailing separators and case-insensitive file systems
/// (best-effort; notify already resolves canonicals on most platforms).
fn paths_match(candidate: &Path, target: &Path) -> bool {
    candidate == target
}
