// mcp.rs — Tauri commands for `eidolons mcp` (list, install, uninstall, cancel).
//
// Four commands are exposed:
//
//   mcp_list(project_path: String) → Result<Vec<McpListEntry>, String>
//     1. Locates the `eidolons` binary (PATH first, then ~/.eidolons/nexus/cli/eidolons).
//     2. Spawns `eidolons mcp list --json` with cwd = project_path.
//     3. Captures full stdout and parses as Vec<McpListEntry>.
//     4. Returns the parsed list to the TS caller.
//
//   mcp_install(project_path, name) → Result<(), String>
//     1. Locates the `eidolons` binary.
//     2. Spawns `eidolons mcp install <name>` in project_path cwd.
//     3. Streams stdout + stderr line-by-line as Tauri events:
//          mcp-stdout  { line: String, ts: String }
//          mcp-stderr  { line: String, ts: String }
//     4. On exit emits mcp-complete { exitCode: i32, action: String, name: String }.
//     5. Stores the Child handle in McpStoreState so mcp_cancel can reach it.
//
//   mcp_uninstall(project_path, name) → Result<(), String>
//     Same streaming pattern; spawns `eidolons mcp uninstall <name>`.
//     Emits through the same mcp-* events with action: "uninstall".
//
//   mcp_cancel() → Result<(), String>
//     Sends SIGKILL to the active child via child.kill().await.
//
// NOTE (v0.1 known gap): child.kill() on macOS sends SIGKILL, not SIGINT.
// A proper SIGINT path requires `nix::sys::signal::kill(pid, Signal::SIGINT)`.
// This is tracked as a v0.2 follow-up.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// Application-managed state holding the active MCP child process (if any).
/// Wrapped in Arc<Mutex<>> so it can be moved into spawned tokio tasks.
pub struct McpStoreState {
    pub child: Arc<Mutex<Option<Child>>>,
}

impl McpStoreState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for McpStoreState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// McpListEntry — mirrors the JSON shape of `eidolons mcp list --json`
// ---------------------------------------------------------------------------

/// One row from the `eidolons mcp list --json` output array.
///
/// Field notes (from live fixture):
///   - `installed`: empty string ("") when not installed, NOT null.
///   - `update`: "no" | "install" | "upgrade" | "downgrade"
///   - `kind`: "oci-image" | "binary"
///   - `scope`: "system" | "eidolon:<name>"
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct McpListEntry {
    pub name: String,
    pub scope: String,
    pub kind: String,
    pub installed: String,
    pub latest: String,
    pub update: String,
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
    action: String,
    name: String,
}

// ---------------------------------------------------------------------------
// Binary discovery (mirrors sync.rs / upgrade.rs pattern)
// ---------------------------------------------------------------------------

/// Locate the `eidolons` CLI binary.
///
/// Order:
///   1. `which eidolons` — honours the user's $PATH.
///   2. `~/.eidolons/nexus/cli/eidolons` — conventional install location.
///
/// Returns an error string if neither is found.
fn find_eidolons_binary() -> Result<PathBuf, String> {
    // 1. PATH lookup via `which`
    if let Ok(path) = which::which("eidolons") {
        return Ok(path);
    }

    // 2. Conventional fallback
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

    Err("eidolons CLI not found on PATH and not present at ~/.eidolons/nexus/cli/eidolons. \
         Run the curl-pipe installer: \
         curl -fsSL https://raw.githubusercontent.com/Rynaro/eidolons/main/cli/install.sh | bash"
        .to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Tauri command: run `eidolons mcp list --json` and return the parsed list.
///
/// One-shot: captures full stdout, parses as Vec<McpListEntry>, returns it.
/// Returns Err if the binary is not found, the process fails to spawn,
/// or stdout is not valid JSON array.
#[tauri::command]
pub async fn mcp_list(
    _state: State<'_, McpStoreState>,
    project_path: String,
) -> Result<Vec<McpListEntry>, String> {
    let binary = find_eidolons_binary()?;

    let project_dir = PathBuf::from(&project_path);
    if !project_dir.exists() {
        return Err(format!(
            "project path does not exist: {}",
            project_dir.display()
        ));
    }

    let mut cmd = Command::new(&binary);
    cmd.arg("mcp")
        .arg("list")
        .arg("--json")
        .current_dir(&project_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "failed to spawn eidolons at {}: {e}",
            binary.display()
        )
    })?;

    // Capture stdout fully.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;

    let mut stdout_buf = String::new();
    BufReader::new(stdout)
        .read_to_string(&mut stdout_buf)
        .await
        .map_err(|e| format!("failed to read stdout: {e}"))?;

    // Wait for the child to exit (JSON presence is the signal).
    let _ = child.wait().await;

    // Trim and parse.
    let raw = stdout_buf.trim();
    serde_json::from_str::<Vec<McpListEntry>>(raw).map_err(|e| {
        // Include the first 200 chars of stdout in the error for diagnostics.
        let head: String = raw.chars().take(200).collect();
        format!("mcp list returned non-JSON: ({e}): {head}")
    })
}

/// Tauri command: start `eidolons mcp install <name>` in project_path.
///
/// Streams stdout/stderr line-by-line as `mcp-stdout` / `mcp-stderr` events.
/// Emits `mcp-complete` on exit with action="install". Any previous child is killed first.
#[tauri::command]
pub async fn mcp_install(
    state: State<'_, McpStoreState>,
    app: AppHandle,
    project_path: String,
    name: String,
) -> Result<(), String> {
    stream_mcp_op(state, app, project_path, name, "install").await
}

/// Tauri command: start `eidolons mcp uninstall <name>` in project_path.
///
/// Streams stdout/stderr line-by-line as `mcp-stdout` / `mcp-stderr` events.
/// Emits `mcp-complete` on exit with action="uninstall". Any previous child is killed first.
#[tauri::command]
pub async fn mcp_uninstall(
    state: State<'_, McpStoreState>,
    app: AppHandle,
    project_path: String,
    name: String,
) -> Result<(), String> {
    stream_mcp_op(state, app, project_path, name, "uninstall").await
}

/// Tauri command: kill the running mcp install/uninstall child.
///
/// V0.1 KNOWN GAP: `child.kill()` sends SIGKILL on macOS, not SIGINT.
/// A proper SIGINT path requires `nix::sys::signal::kill(pid, SIGINT)`.
/// Tracked as a v0.2 follow-up.
#[tauri::command]
pub async fn mcp_cancel(state: State<'_, McpStoreState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(ref mut child) = *guard {
        child
            .kill()
            .await
            .map_err(|e| format!("failed to kill mcp child: {e}"))?;
    }
    *guard = None;
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal streaming helper — shared by install + uninstall
// ---------------------------------------------------------------------------

async fn stream_mcp_op(
    state: State<'_, McpStoreState>,
    app: AppHandle,
    project_path: String,
    name: String,
    action: &str,
) -> Result<(), String> {
    let binary = find_eidolons_binary()?;

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

    // Build the command: `eidolons mcp install <name>` or `eidolons mcp uninstall <name>`.
    let mut cmd = Command::new(&binary);
    cmd.arg("mcp")
        .arg(action)
        .arg(&name)
        .current_dir(&project_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
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

    // Store the child handle so mcp_cancel can reach it.
    let child_arc = state.child.clone();
    {
        let mut guard = child_arc.lock().await;
        *guard = Some(child);
    }

    // Clone app handle for each task.
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let app_complete = app.clone();

    // Capture action + name as owned Strings for use in the wait task.
    let action_owned = action.to_string();
    let name_owned = name.clone();

    // Spawn stdout reader task.
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let payload = LinePayload {
                line,
                ts: chrono::Utc::now().to_rfc3339(),
            };
            let _ = app_stdout.emit("mcp-stdout", payload);
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
            let _ = app_stderr.emit("mcp-stderr", payload);
        }
    });

    // Spawn wait task — awaits child exit, then emits mcp-complete.
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

        let payload = CompletePayload {
            exit_code,
            action: action_owned,
            name: name_owned,
        };
        let _ = app_complete.emit("mcp-complete", payload);

        // Clear the child handle now that we're done.
        let mut guard = child_arc_wait.lock().await;
        *guard = None;
    });

    Ok(())
}
