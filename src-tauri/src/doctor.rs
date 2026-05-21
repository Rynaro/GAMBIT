// doctor.rs — Tauri commands for streaming `eidolons doctor` output.
//
// Two commands are exposed:
//
//   start_doctor(project_path: String) → Result<(), String>
//     1. Locates the `eidolons` binary via binary::find_eidolons() (bundled
//        extraction first, then PATH, then ~/.eidolons/nexus/cli/eidolons).
//     2. Spawns `eidolons doctor` with cwd = project_path.
//     3. Pipes stdout + stderr line-by-line as Tauri events:
//          doctor-stdout   { line: String, ts: String }  (one event per line)
//          doctor-stderr   { line: String, ts: String }
//     4. On exit emits doctor-complete { exit_code: i32 }.
//     5. Stores the Child handle in DoctorState so cancel_doctor can reach it.
//
//   cancel_doctor() → Result<(), String>
//     Sends SIGKILL to the child via child.kill().await.
//
// NOTE (v0.1 known gap): child.kill() on macOS sends SIGKILL, not SIGINT.
// A proper SIGINT path requires `nix::sys::signal::kill(pid, Signal::SIGINT)`.
// This is tracked as a v0.2 follow-up; the current behaviour terminates the
// subprocess but does not allow it to perform a clean shutdown.
//
// Parser note (GAP-03): `eidolons doctor` has no --json flag. The output is
// glyph-anchored stderr text. The TS-side parseDoctorStderr.ts converts it
// to structured DoctorCheck objects. The Rust side only streams the raw lines.

use crate::binary;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Application-managed state holding the active doctor child process (if any).
/// Wrapped in Arc<Mutex<>> so it can be moved into spawned tokio tasks.
pub struct DoctorState {
    pub child: Arc<Mutex<Option<Child>>>,
}

impl DoctorState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for DoctorState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinePayload {
    line: String,
    ts: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletePayload {
    exit_code: i32,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Tauri command: start `eidolons doctor` in project_path.
///
/// Streams stdout/stderr line-by-line as `doctor-stdout` / `doctor-stderr` events.
/// Emits `doctor-complete` on exit. Any previous child is killed first.
#[tauri::command]
pub async fn start_doctor(
    state: State<'_, DoctorState>,
    app: AppHandle,
    project_path: String,
) -> Result<(), String> {
    let binary = binary::find_eidolons(&app)?;

    let project_dir = PathBuf::from(&project_path);
    if !project_dir.exists() {
        return Err(format!(
            "project path does not exist: {}",
            project_dir.display()
        ));
    }

    // Kill any running child before starting a new one.
    {
        let mut guard = state.child.lock().await;
        if let Some(ref mut old_child) = *guard {
            let _ = old_child.kill().await;
        }
        *guard = None;
    }

    // Spawn `eidolons doctor`.
    let mut cmd = Command::new(&binary);
    cmd.arg("doctor")
        .current_dir(&project_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Prevent the child from inheriting the parent's terminal
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "failed to spawn eidolons at {}: {e}",
            binary.display()
        )
    })?;

    // Extract pipe handles before moving child into state.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;

    // Store the child handle so cancel_doctor can reach it.
    let child_arc = state.child.clone();
    {
        let mut guard = child_arc.lock().await;
        *guard = Some(child);
    }

    // Clone app handle for each task.
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let app_complete = app.clone();

    // Spawn stdout reader task.
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let payload = LinePayload {
                line,
                ts: chrono::Utc::now().to_rfc3339(),
            };
            let _ = app_stdout.emit("doctor-stdout", payload);
        }
    });

    // Spawn stderr reader task.
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let payload = LinePayload {
                line,
                ts: chrono::Utc::now().to_rfc3339(),
            };
            let _ = app_stderr.emit("doctor-stderr", payload);
        }
    });

    // Spawn wait task — awaits child exit, then emits doctor-complete.
    let child_arc_wait = state.child.clone();
    tokio::spawn(async move {
        // Wait for both pipe-reading tasks to drain first.
        let _ = tokio::join!(stdout_task, stderr_task);

        // Wait for the child to exit.
        let exit_code = {
            let mut guard = child_arc_wait.lock().await;
            if let Some(ref mut child) = *guard {
                match child.wait().await {
                    Ok(status) => status.code().unwrap_or(-1),
                    Err(_) => -1,
                }
            } else {
                // Child was cancelled between drain and wait — treat as cancelled.
                -2
            }
        };

        let payload = CompletePayload { exit_code };
        let _ = app_complete.emit("doctor-complete", payload);

        // Clear the child handle now that we're done.
        let mut guard = child_arc_wait.lock().await;
        *guard = None;
    });

    Ok(())
}

/// Tauri command: kill the running doctor child.
///
/// V0.1 KNOWN GAP: `child.kill()` sends SIGKILL on macOS, not SIGINT.
/// A proper SIGINT path requires `nix::sys::signal::kill(pid, SIGINT)`.
/// Tracked as a v0.2 follow-up.
#[tauri::command]
pub async fn cancel_doctor(state: State<'_, DoctorState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(ref mut child) = *guard {
        child
            .kill()
            .await
            .map_err(|e| format!("failed to kill doctor child: {e}"))?;
    }
    *guard = None;
    Ok(())
}
