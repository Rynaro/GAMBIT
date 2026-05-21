// spawn_core.rs — Host-agnostic subprocess-spawn helper.
//
// GAMBIT v0.2 carries five copy-pasted subprocess-spawn bodies
// (sync.rs, doctor.rs, upgrade.rs ×2, mcp.rs::stream_mcp_op). Each one
// repeats the same mechanical idiom:
//
//   1. Build a `tokio::process::Command` with stdout + stderr piped and
//      `.kill_on_drop(true)` so the child never outlives the GUI.
//   2. Spawn it, surfacing a uniform "failed to spawn <bin>: <e>" error.
//   3. Take the stdout / stderr pipe handles before the `Child` is moved
//      into shared state.
//   4. Drain each pipe with a `BufReader::new(...).lines()` loop running
//      on its own tokio task.
//
// This module factors ONLY that mechanical commonality and nothing else.
// It is deliberately host-agnostic: no NDJSON parsing, no UUID, no session
// registry, no stdin wiring — those belong to S4 (`session.rs`). The five
// v0.2 verbs are intentionally NOT retrofitted onto this helper here; that
// retrofit is deferred.
//
// `stream_mcp_op` in mcp.rs is the closest existing factored seed and the
// pattern this module generalises.

#![allow(dead_code)] // wired up by S4 (session.rs)

use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::task::JoinHandle;

/// A spawned child together with its captured stdout/stderr pipe handles.
///
/// The pipe handles are `take()`-n out of the `Child` at spawn time so the
/// caller can move `child` into shared state (an `Arc<Mutex<Option<Child>>>`,
/// per the v0.2 pattern) while still owning the readers.
pub struct SpawnedChild {
    /// The live child process. Move this into shared state so a cancel
    /// path can reach it; `.kill_on_drop(true)` is already set.
    pub child: Child,
    /// Captured stdout pipe — feed to `read_lines`.
    pub stdout: ChildStdout,
    /// Captured stderr pipe — feed to `read_lines`.
    pub stderr: ChildStderr,
}

/// Build a `tokio::process::Command` for `bin` with both stdout and stderr
/// piped and `kill_on_drop` enabled.
///
/// This is the host-agnostic core of the v0.2 spawn idiom: it sets up the
/// stdio + kill-on-drop policy but adds no arguments and no working
/// directory — callers chain `.arg(...)` / `.current_dir(...)` themselves,
/// exactly as the inline v0.2 bodies do.
///
/// `bin` is typically the `PathBuf` returned by
/// `binary::find_host_tool` / `binary::find_eidolons`.
pub fn piped_command(bin: &Path) -> Command {
    let mut cmd = Command::new(bin);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // Prevent the child from outliving the GUI process.
        .kill_on_drop(true);
    cmd
}

/// Spawn `cmd` and take its stdout/stderr pipe handles.
///
/// `cmd` should have been built via [`piped_command`] (or otherwise have
/// both pipes set to `Stdio::piped()`). On success the returned
/// [`SpawnedChild`] owns the live `Child` plus both readers.
///
/// `bin` is used only to render a uniform spawn-failure message matching
/// the v0.2 wording ("failed to spawn <path>: <e>").
pub fn spawn_piped(mut cmd: Command, bin: &Path) -> Result<SpawnedChild, String> {
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", bin.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr".to_string())?;

    Ok(SpawnedChild {
        child,
        stdout,
        stderr,
    })
}

/// Spawn a tokio task that drains `pipe` line-by-line, invoking `on_line`
/// for every line read.
///
/// This is the reusable form of the `BufReader::new(...).lines()` loop that
/// currently lives inline in all five v0.2 verbs. It is generic over the
/// pipe type so the one factory serves both `ChildStdout` and `ChildStderr`.
///
/// `on_line` is the only host-specific seam — callers decide whether to emit
/// a Tauri event, parse the line, buffer it, etc. The task ends cleanly when
/// the pipe reaches EOF (the child closed it / exited).
///
/// The returned [`JoinHandle`] can be `tokio::join!`-ed before awaiting the
/// child's exit, mirroring the v0.2 drain-then-wait ordering.
pub fn read_lines<R, F>(pipe: R, mut on_line: F) -> JoinHandle<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    F: FnMut(String) + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            on_line(line);
        }
    })
}
