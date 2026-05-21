// upgrade.rs — Tauri commands for `eidolons upgrade` (check + apply).
//
// Three commands are exposed:
//
//   check_upgrades(project_path: String) → Result<UpgradePlan, String>
//     1. Locates the `eidolons` binary (PATH first, then ~/.eidolons/nexus/cli/eidolons).
//     2. Spawns `eidolons upgrade --check --json` with cwd = project_path.
//     3. Captures full stdout and parses it as UpgradePlan JSON.
//     4. Returns the parsed plan to the TS caller.
//
//   start_upgrade_apply(project_path: String) → Result<(), String>
//     1. Locates the `eidolons` binary.
//     2. Spawns `eidolons upgrade --yes` with cwd = project_path.
//     3. Pipes stdout + stderr line-by-line as Tauri events:
//          upgrade-stdout   { line: String, ts: String }
//          upgrade-stderr   { line: String, ts: String }
//     4. On exit emits upgrade-complete { exitCode: i32 }.
//     5. Stores the Child handle in UpgradeState so cancel_upgrade can reach it.
//
//   cancel_upgrade() → Result<(), String>
//     Sends SIGKILL to the child via child.kill().await.
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

/// Application-managed state holding the active upgrade child process (if any).
/// Wrapped in Arc<Mutex<>> so it can be moved into spawned tokio tasks.
pub struct UpgradeState {
    pub child: Arc<Mutex<Option<Child>>>,
}

impl UpgradeState {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for UpgradeState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// UpgradePlan — mirrors the JSON shape emitted by `eidolons upgrade --check --json`
// ---------------------------------------------------------------------------

/// The current nexus installation state.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NexusCurrent {
    pub tag: String,
    pub commit: String,
}

/// The latest available nexus tag.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NexusLatest {
    pub tag: String,
}

/// Nexus block from the upgrade check output.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NexusBlock {
    pub current: NexusCurrent,
    pub latest: NexusLatest,
    pub status: String,
}

/// Per-Eidolon member upgrade entry.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UpgradeMember {
    pub name: String,
    pub installed: String,
    pub latest: String,
    pub constraint: String,
    pub status: String,
}

/// Summary counters from the upgrade check output.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UpgradeSummary {
    pub nexus_upgrade_available: bool,
    pub member_upgrades_available: u32,
    pub member_upgrades_pinned_out: u32,
    pub members_not_installed: u32,
}

/// Top-level plan returned by `eidolons upgrade --check --json`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UpgradePlan {
    pub nexus: NexusBlock,
    pub members: Vec<UpgradeMember>,
    pub summary: UpgradeSummary,
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
// Binary discovery (mirrors sync.rs / doctor.rs)
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
    let fallback = home.join(".eidolons").join("nexus").join("cli").join("eidolons");
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

/// Tauri command: run `eidolons upgrade --check --json` and return the parsed plan.
///
/// One-shot: captures full stdout, parses as UpgradePlan JSON, returns it.
/// Returns Err if the binary is not found, the process fails to spawn,
/// or stdout is not valid UpgradePlan JSON.
#[tauri::command]
pub async fn check_upgrades(
    _state: State<'_, UpgradeState>,
    project_path: String,
) -> Result<UpgradePlan, String> {
    let binary = find_eidolons_binary()?;

    let project_dir = PathBuf::from(&project_path);
    if !project_dir.exists() {
        return Err(format!(
            "project path does not exist: {}",
            project_dir.display()
        ));
    }

    let mut cmd = Command::new(&binary);
    cmd.arg("upgrade")
        .arg("--check")
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

    // Wait for the child to exit (we don't gate on exit code — the JSON presence is the signal).
    let _ = child.wait().await;

    // Trim and parse.
    let raw = stdout_buf.trim();
    serde_json::from_str::<UpgradePlan>(raw).map_err(|e| {
        // Include the first 200 chars of stdout in the error for diagnostics.
        let head: String = raw.chars().take(200).collect();
        format!("upgrade --check returned non-JSON output ({e}): {head}")
    })
}

/// Tauri command: start `eidolons upgrade --yes` in project_path.
///
/// Streams stdout/stderr line-by-line as `upgrade-stdout` / `upgrade-stderr` events.
/// Emits `upgrade-complete` on exit. Any previous child is killed first.
#[tauri::command]
pub async fn start_upgrade_apply(
    state: State<'_, UpgradeState>,
    app: AppHandle,
    project_path: String,
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

    // Spawn `eidolons upgrade --yes`.
    let mut cmd = Command::new(&binary);
    cmd.arg("upgrade")
        .arg("--yes")
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

    // Store the child handle so cancel_upgrade can reach it.
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
            let _ = app_stdout.emit("upgrade-stdout", payload);
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
            let _ = app_stderr.emit("upgrade-stderr", payload);
        }
    });

    // Spawn wait task — awaits child exit, then emits upgrade-complete.
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
        let _ = app_complete.emit("upgrade-complete", payload);

        // Clear the child handle now that we're done.
        let mut guard = child_arc_wait.lock().await;
        *guard = None;
    });

    Ok(())
}

/// Tauri command: start `eidolons upgrade --system --yes` in project_path.
///
/// Upgrades only the nexus at $EIDOLONS_HOME/nexus (not member Eidolons).
/// Streams stdout/stderr line-by-line as `upgrade-stdout` / `upgrade-stderr` events.
/// Emits `upgrade-complete` on exit. Uses the same UpgradeState mutex so
/// cancel_upgrade can reach it. Same event names as start_upgrade_apply so
/// the React hook's single listener pair covers both.
#[tauri::command]
pub async fn start_nexus_upgrade(
    state: State<'_, UpgradeState>,
    app: AppHandle,
    project_path: String,
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

    // Spawn `eidolons upgrade --system --yes`.
    let mut cmd = Command::new(&binary);
    cmd.arg("upgrade")
        .arg("--system")
        .arg("--yes")
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

    // Store the child handle so cancel_upgrade can reach it.
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
            let _ = app_stdout.emit("upgrade-stdout", payload);
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
            let _ = app_stderr.emit("upgrade-stderr", payload);
        }
    });

    // Spawn wait task — awaits child exit, then emits upgrade-complete.
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
        let _ = app_complete.emit("upgrade-complete", payload);

        // Clear the child handle now that we're done.
        let mut guard = child_arc_wait.lock().await;
        *guard = None;
    });

    Ok(())
}

/// Tauri command: kill the running upgrade apply child.
///
/// V0.1 KNOWN GAP: `child.kill()` sends SIGKILL on macOS, not SIGINT.
/// A proper SIGINT path requires `nix::sys::signal::kill(pid, SIGINT)`.
/// Tracked as a v0.2 follow-up.
#[tauri::command]
pub async fn cancel_upgrade(state: State<'_, UpgradeState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(ref mut child) = *guard {
        child
            .kill()
            .await
            .map_err(|e| format!("failed to kill upgrade child: {e}"))?;
    }
    *guard = None;
    Ok(())
}
