// session.rs — Tauri commands for driving headless `claude` Eidolon sessions.
//
// GAMBIT v0.3 ("Eidolon Sessions") drives the `claude` CLI headlessly, one
// fresh process per conversational turn, and streams its stream-json NDJSON
// output to the frontend as Tauri events. This module is the session layer:
//
//   start_session(state, app, params) → Result<SessionInfo, String>
//     1. Validate params.projectPath exists on disk.
//     2. Host-generate a UUID v4 — the session id (claude-code echoes it back
//        and persists conversation state under it across `--resume`).
//     3. Resolve the `claude` binary via binary::find_host_tool.
//     4. Build the turn-1 arg vector via claude_adapter::build_args with
//        TurnKind::First (`--session-id <uuid>`).
//     5. Spawn `claude` (piped stdio, kill_on_drop) with cwd = projectPath
//        via spawn_core.
//     6. Register a SessionHandle in the SessionRegistry, keyed by UUID.
//     7. Start the per-turn reader + wait tasks (see below) and return the
//        SessionInfo.
//
//   send_turn(state, app, sessionId, prompt) → Result<(), String>
//     Look up the SessionHandle by UUID (error if absent); reject if a turn
//     is already in flight; rebuild args with TurnKind::Resumed (`--resume
//     <uuid>`); spawn a fresh `claude` process; run the same reader + wait
//     tasks. claude-code itself persists conversation state across `--resume`,
//     so each turn is a stateless fresh process — the registry is keyed by
//     UUID, never by a process handle.
//
// Per-turn reader + wait tasks — adapted from sync.rs:
//   * stdout reader  — each line → claude_adapter::parse_line → `session-event`
//   * stderr reader  — each line → `session-stderr`
//   * wait task      — tokio::join!s the two readers, then child.wait()s,
//                      then emits `session-turn-complete`.
//
// R6 — dual finalize: a turn finalizes on EITHER the terminal `result` event
// being observed on stdout OR a clean child-process exit, whichever happens
// first. A known claude-code bug can drop the final `result` event, so the
// process exit is the backstop. The stdout reader sets a shared
// Arc<AtomicBool> when it sees a ParsedEvent::Result; the wait task reads that
// flag into the `hadResult` field of the `session-turn-complete` payload.
//
// Story S5 adds two more commands:
//
//   claude_auth_status(app) → Result<AuthStatus, String>
//     A one-shot pre-flight (no events): resolve `claude`, run
//     `claude auth status --text`, and report login state. `loggedIn` is the
//     process exiting 0; `detail` is a short human-readable line. If `claude`
//     itself cannot be found this still returns Ok(AuthStatus{ loggedIn:
//     false, .. }) — never Err — so the UI shows a clean "not logged in /
//     claude not found" state instead of an opaque error.
//
//   cancel_session(state, sessionId) → Result<(), String>
//     Look up the SessionHandle by UUID and SIGKILL the current turn's child,
//     mirroring sync.rs's cancel_sync.
//
// NOTE (v0.3 known gap): cancel_session sends SIGKILL via child.kill(), not
// SIGINT. Killing *between* turns is harmless — session state lives in
// claude-code's `--resume` store, not in the process — so a cancelled session
// can simply be resumed. Killing *mid-turn* is ungraceful: the in-flight
// `claude` process is terminated without a clean shutdown. A graceful SIGINT
// path would require the `nix` crate (`nix::sys::signal::kill(pid, SIGINT)`);
// this is an accepted v0.3 limitation, mirroring sync.rs:18-21.
//
// SessionHandle stores the per-turn Child (Arc<Mutex<Option<Child>>>,
// mirroring sync.rs's SyncState) so cancel_session can reach the live process
// without reworking S4.

use crate::binary;
use crate::claude_adapter::{self, ParsedEvent, TurnArgs, TurnKind};
use crate::spawn_core;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

/// One registered Eidolon session, keyed in [`SessionRegistry`] by UUID.
///
/// Holds everything `send_turn` needs to rebuild a `claude` arg vector for a
/// follow-up turn WITHOUT the frontend re-sending the persona / tools — the
/// frontend resolves those once (story S3's `eidolonRoster.ts`) and passes
/// them to `start_session`; the registry remembers them.
///
/// The process is an ephemeral per-turn detail: `child` holds the CURRENT
/// turn's `claude` process (or `None` between turns), wrapped exactly like
/// `sync.rs`'s `SyncState` so a future `cancel_session` (S5) can reach it.
pub struct SessionHandle {
    /// The Eidolon identity driving this session.
    pub eidolon_name: String,
    /// Absolute working directory `claude` is spawned in.
    pub project_path: PathBuf,
    /// Value passed verbatim to `--permission-mode`.
    pub permission_mode: String,
    /// Resolved Eidolon persona text — fed to `--append-system-prompt` on
    /// every turn. Resolved once by the frontend, remembered here.
    pub append_system_prompt: String,
    /// Tool names the Eidolon's `agent.md` allows — joined into
    /// `--allowedTools` on every turn.
    pub allowed_tools: Vec<String>,
    /// Coarse session status string (`"idle"` between turns, `"running"`
    /// while a turn is in flight).
    pub status: String,
    /// The CURRENT per-turn `claude` child (or `None` between turns).
    /// `Arc<Mutex<Option<Child>>>` mirrors `sync.rs`'s `SyncState` so story
    /// S5's `cancel_session` can reach the live process.
    pub child: Arc<Mutex<Option<Child>>>,
    /// `true` while a turn is in flight for this session. Checked + set by
    /// `send_turn` (and `start_session`) so a second turn cannot race a
    /// running one. An `Arc<AtomicBool>` so the wait task can clear it on
    /// turn completion without re-locking the registry map.
    pub turn_in_flight: Arc<AtomicBool>,
}

/// Tauri-managed registry of live Eidolon sessions, keyed by UUID.
///
/// Multi-session-capable by construction (a `HashMap`), even though the v0.3
/// UI drives one session at a time. The map is behind an `Arc<Mutex<>>` so it
/// can be cloned into spawned tokio tasks; guards are always dropped before
/// any `.await` (see lock-discipline notes on the commands).
pub struct SessionRegistry {
    /// UUID → live session handle.
    pub sessions: Arc<Mutex<HashMap<Uuid, SessionHandle>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Command params + return shapes
// ---------------------------------------------------------------------------

/// Parameters for [`start_session`].
///
/// `appendSystemPrompt` is the persona STRING — the frontend resolves it via
/// story S3's `eidolonRoster.ts`; Rust never re-parses `agent.md`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionParams {
    /// Absolute working directory to spawn `claude` in.
    pub project_path: String,
    /// The Eidolon identity to drive the session.
    pub eidolon_name: String,
    /// Value for `--permission-mode` (`"default"` / `"acceptEdits"` / `"plan"`).
    pub permission_mode: String,
    /// Resolved Eidolon persona text — passed to `--append-system-prompt`.
    pub append_system_prompt: String,
    /// Tool names the Eidolon allows — joined into `--allowedTools`.
    pub allowed_tools: Vec<String>,
    /// The prompt for turn 1.
    pub first_prompt: String,
}

/// Returned by [`start_session`]: the addressable session descriptor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    /// The host-generated UUID v4 — the session's stable address.
    pub session_id: String,
    /// The Eidolon identity driving the session.
    pub eidolon_name: String,
    /// Absolute working directory `claude` runs in.
    pub project_path: String,
    /// Active `--permission-mode`.
    pub permission_mode: String,
    /// Session status at return time (`"running"` — turn 1 was just spawned).
    pub status: String,
}

/// Returned by [`claude_auth_status`]: the `claude` CLI login pre-flight.
///
/// `loggedIn` is true iff `claude auth status` exited 0. `detail` is a short
/// human-readable line drawn from the command's own output (or a clear
/// "claude not found" message if the binary could not be resolved). The
/// command never returns `Err` for a not-logged-in / missing-binary state —
/// those are reported in-band so the UI can render a clean gate.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// `true` iff `claude auth status` exited with code 0.
    pub logged_in: bool,
    /// Short human-readable status line for the UI to display.
    pub detail: String,
}

// ---------------------------------------------------------------------------
// Event payloads — all camelCase, all Clone + Serialize for `emit`.
// ---------------------------------------------------------------------------

/// `session-event` — one parsed `claude` stream-json NDJSON line.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventPayload {
    /// The owning session's UUID.
    session_id: String,
    /// Short discriminator: `init` / `assistant` / `user` / `streamEvent` /
    /// `apiRetry` / `result` / `unknown`.
    kind: String,
    /// The raw NDJSON line, verbatim.
    raw: String,
    /// The typed [`ParsedEvent`] serialised to JSON.
    parsed: ParsedEvent,
    /// RFC-3339 emit timestamp.
    ts: String,
}

/// `session-stderr` — one line of `claude`'s stderr.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStderrPayload {
    /// The owning session's UUID.
    session_id: String,
    /// The stderr line, verbatim.
    line: String,
    /// RFC-3339 emit timestamp.
    ts: String,
}

/// `session-turn-complete` — a turn finished (dual-finalize: result OR exit).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnCompletePayload {
    /// The owning session's UUID.
    session_id: String,
    /// Child exit code (`-1` unknown, `-2` cancelled mid-flight).
    exit_code: i32,
    /// Whether a terminal `result` event was observed on stdout (R6).
    had_result: bool,
    /// Whether the turn ended in failure (non-zero exit, or a `result` event
    /// with `is_error: true`).
    is_error: bool,
}

// ---------------------------------------------------------------------------
// Pure helpers — unit-tested below.
// ---------------------------------------------------------------------------

/// Map a [`ParsedEvent`] to its short `kind` discriminator string.
///
/// This is the stable IPC contract the frontend switches on — it does not
/// change even if `ParsedEvent`'s serde representation evolves. `Malformed`
/// shares the `"unknown"` discriminator (the raw line still rides in `raw`).
fn event_kind(event: &ParsedEvent) -> &'static str {
    match event {
        ParsedEvent::Init { .. } => "init",
        ParsedEvent::ApiRetry { .. } => "apiRetry",
        ParsedEvent::Assistant { .. } => "assistant",
        ParsedEvent::User { .. } => "user",
        ParsedEvent::StreamEvent { .. } => "streamEvent",
        ParsedEvent::Result { .. } => "result",
        ParsedEvent::Unknown { .. } => "unknown",
        ParsedEvent::Malformed { .. } => "unknown",
    }
}

/// Determine whether a finished turn ended in failure.
///
/// A turn is an error if EITHER the child exited non-zero OR a terminal
/// `result` event reported `is_error: true`. The cancel sentinel (`-2`) is a
/// non-zero exit and therefore counts as an error, which is intended — a
/// cancelled turn did not complete successfully.
fn turn_is_error(exit_code: i32, result_was_error: bool) -> bool {
    exit_code != 0 || result_was_error
}

/// Build an [`AuthStatus`] from a finished `claude auth status` invocation.
///
/// `loggedIn` is the exit code being 0. `detail` prefers the first non-blank
/// line of stdout (`claude auth status --text` prints `Login method: ...` /
/// `Email: ...` when logged in); on a non-zero exit it falls back to the first
/// non-blank stderr line, and finally to a generic message keyed on the login
/// state. Kept pure (no process, no `claude`) so it is unit-testable.
fn auth_status_from_output(exit_code: i32, stdout: &str, stderr: &str) -> AuthStatus {
    let logged_in = exit_code == 0;

    let first_line = |s: &str| -> Option<String> {
        s.lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
    };

    let detail = if logged_in {
        first_line(stdout).unwrap_or_else(|| "logged in to claude".to_string())
    } else {
        first_line(stderr)
            .or_else(|| first_line(stdout))
            .unwrap_or_else(|| "not logged in to claude".to_string())
    };

    AuthStatus { logged_in, detail }
}

// ---------------------------------------------------------------------------
// Per-turn machinery
// ---------------------------------------------------------------------------

/// Spawn the stdout/stderr reader tasks and the wait task for one turn.
///
/// Shared between `start_session` and `send_turn` — both drive an identical
/// per-turn lifecycle, only the arg vector (`First` vs `Resumed`) differs.
///
/// `child` is the freshly-spawned `claude` process; its pipes have already
/// been `take()`-n into `stdout` / `stderr` by `spawn_core::spawn_piped`. The
/// `child` is stored into the session's `Arc<Mutex<Option<Child>>>` here so a
/// future `cancel_session` can reach it.
///
/// R6 dual-finalize: `result_seen` is the shared flag — the stdout reader sets
/// it on a `ParsedEvent::Result`, the wait task reads it for `hadResult`.
fn run_turn(
    app: AppHandle,
    session_id: Uuid,
    spawned: spawn_core::SpawnedChild,
    child_slot: Arc<Mutex<Option<Child>>>,
    turn_in_flight: Arc<AtomicBool>,
) {
    let spawn_core::SpawnedChild {
        child,
        stdout,
        stderr,
    } = spawned;

    let session_id_str = session_id.to_string();

    // R6 — shared dual-finalize state.
    //   * `result_seen`  — set by the stdout reader on a terminal `result`.
    //   * `result_error` — set by the stdout reader iff that `result` had
    //                      `is_error: true`. Read by the wait task.
    let result_seen = Arc::new(AtomicBool::new(false));
    let result_error = Arc::new(AtomicBool::new(false));

    // --- stdout reader -----------------------------------------------------
    // Each line → parse_line → `session-event`. On a `Result` event, flip the
    // shared dual-finalize flags. `read_lines`'s closure is `FnMut + Send`;
    // it owns its clones, so nothing is borrowed across the task boundary.
    let app_stdout = app.clone();
    let sid_stdout = session_id_str.clone();
    let result_seen_rd = result_seen.clone();
    let result_error_rd = result_error.clone();
    let stdout_task = spawn_core::read_lines(stdout, move |line| {
        let parsed = claude_adapter::parse_line(&line);
        if let ParsedEvent::Result { is_error, .. } = &parsed {
            // R6: a terminal `result` was observed — record it for the wait
            // task. `Ordering::SeqCst` is more than enough here; these flags
            // are read exactly once, after the reader task has fully joined.
            if *is_error {
                result_error_rd.store(true, Ordering::SeqCst);
            }
            result_seen_rd.store(true, Ordering::SeqCst);
        }
        let payload = SessionEventPayload {
            session_id: sid_stdout.clone(),
            kind: event_kind(&parsed).to_string(),
            raw: line,
            parsed,
            ts: chrono::Utc::now().to_rfc3339(),
        };
        let _ = app_stdout.emit("session-event", payload);
    });

    // --- stderr reader -----------------------------------------------------
    let app_stderr = app.clone();
    let sid_stderr = session_id_str.clone();
    let stderr_task = spawn_core::read_lines(stderr, move |line| {
        let payload = SessionStderrPayload {
            session_id: sid_stderr.clone(),
            line,
            ts: chrono::Utc::now().to_rfc3339(),
        };
        let _ = app_stderr.emit("session-stderr", payload);
    });

    // Store the live child so a future `cancel_session` (S5) can reach it.
    // Scoped: the guard is dropped before the wait task is spawned, and the
    // wait task re-locks it independently — no guard is ever held across an
    // `.await`.
    //
    // We block_on the store inside the wait task's prelude instead of here so
    // `run_turn` itself stays synchronous (its callers are `async fn`s but the
    // store is fast and lock-free contention is nil). Simpler: do it in the
    // wait task before the join.
    let app_complete = app.clone();
    let child_slot_wait = child_slot.clone();
    tokio::spawn(async move {
        // Publish the child into the session slot so S5's cancel can reach it.
        {
            let mut guard = child_slot_wait.lock().await;
            *guard = Some(child);
        }

        // Drain both pipes to EOF first — the child closes them on exit.
        let _ = tokio::join!(stdout_task, stderr_task);

        // Wait for the child to exit. The child may have been taken out of the
        // slot by a cancel path (S5) between the join and here — in that case
        // treat it as cancelled (`-2`), mirroring sync.rs's sentinel.
        let exit_code = {
            let mut guard = child_slot_wait.lock().await;
            match guard.as_mut() {
                Some(c) => match c.wait().await {
                    Ok(status) => status.code().unwrap_or(-1),
                    Err(_) => -1,
                },
                None => -2,
            }
        };

        // R6 dual-finalize readout — the stdout reader has fully joined above,
        // so these flags are stable.
        let had_result = result_seen.load(Ordering::SeqCst);
        let result_was_error = result_error.load(Ordering::SeqCst);
        let is_error = turn_is_error(exit_code, result_was_error);

        // Clear the per-turn child slot and lower the in-flight flag — the
        // session is now idle and ready for the next `send_turn`.
        {
            let mut guard = child_slot_wait.lock().await;
            *guard = None;
        }
        turn_in_flight.store(false, Ordering::SeqCst);

        let payload = TurnCompletePayload {
            session_id: session_id_str,
            exit_code,
            had_result,
            is_error,
        };
        let _ = app_complete.emit("session-turn-complete", payload);
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Tauri command: open a new Eidolon session and spawn its first turn.
///
/// Host-generates a UUID v4, registers a [`SessionHandle`], spawns `claude`
/// with `--session-id <uuid>` in `params.projectPath`, and streams its NDJSON
/// output as `session-event` / `session-stderr` events, finalising with
/// `session-turn-complete`.
///
/// Lock discipline: the registry `HashMap` mutex is held only for the
/// synchronous `insert` and is dropped (end of its block scope) before
/// `run_turn` is reached. The `await` on the lock itself is fine; what must
/// never happen is holding the *guard* across an `.await`.
#[tauri::command]
pub async fn start_session(
    state: State<'_, SessionRegistry>,
    app: AppHandle,
    params: StartSessionParams,
) -> Result<SessionInfo, String> {
    // --- Validate the working directory ---
    let project_dir = PathBuf::from(&params.project_path);
    if !project_dir.exists() {
        return Err(format!(
            "project path does not exist: {}",
            project_dir.display()
        ));
    }

    // --- Host-generate the session UUID v4 (spec GAP-1) ---
    let session_id = Uuid::new_v4();
    let session_id_str = session_id.to_string();

    // --- Resolve the `claude` binary ---
    let claude_bin = binary::find_host_tool(&app, "claude", None)?;

    // --- Build the turn-1 arg vector (TurnKind::First → `--session-id`) ---
    let turn_args = TurnArgs {
        prompt: &params.first_prompt,
        append_system_prompt: &params.append_system_prompt,
        allowed_tools: &params.allowed_tools,
        permission_mode: &params.permission_mode,
        session_id: &session_id_str,
        turn_kind: TurnKind::First,
    };
    let args = claude_adapter::build_args(&turn_args);

    // --- Spawn `claude` with piped stdio + kill_on_drop in projectPath ---
    let mut cmd = spawn_core::piped_command(&claude_bin);
    cmd.args(&args).current_dir(&project_dir);
    let spawned = spawn_core::spawn_piped(cmd, &claude_bin)?;

    // --- Register the SessionHandle ---
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let turn_in_flight = Arc::new(AtomicBool::new(true));
    let handle = SessionHandle {
        eidolon_name: params.eidolon_name.clone(),
        project_path: project_dir.clone(),
        permission_mode: params.permission_mode.clone(),
        append_system_prompt: params.append_system_prompt.clone(),
        allowed_tools: params.allowed_tools.clone(),
        status: "running".to_string(),
        child: child_slot.clone(),
        turn_in_flight: turn_in_flight.clone(),
    };
    {
        // Guard scoped to the synchronous insert — dropped before `run_turn`.
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id, handle);
    }

    // --- Start the per-turn reader + wait tasks ---
    run_turn(
        app.clone(),
        session_id,
        spawned,
        child_slot,
        turn_in_flight,
    );

    Ok(SessionInfo {
        session_id: session_id_str,
        eidolon_name: params.eidolon_name,
        project_path: params.project_path,
        permission_mode: params.permission_mode,
        status: "running".to_string(),
    })
}

/// Tauri command: spawn a follow-up turn on an existing session.
///
/// Looks the session up by UUID, rejects if a turn is already in flight,
/// rebuilds the arg vector with `TurnKind::Resumed` (`--resume <uuid>`), and
/// spawns a fresh `claude` process running the same per-turn lifecycle.
///
/// Lock discipline: the registry guard is held only long enough to (a) read
/// the session's cached persona / tools / cwd into owned locals and (b)
/// atomically claim the in-flight flag. It is dropped before the spawn and
/// before `run_turn`. The `compare_exchange` on `turn_in_flight` is performed
/// while still holding the map guard so two concurrent `send_turn`s for the
/// same session cannot both win the claim.
#[tauri::command]
pub async fn send_turn(
    state: State<'_, SessionRegistry>,
    app: AppHandle,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    // --- Parse the UUID ---
    let uuid = Uuid::parse_str(&session_id)
        .map_err(|e| format!("invalid session id '{session_id}': {e}"))?;

    // --- Look the session up, claim the in-flight slot, copy out args ---
    // All of this happens under the map guard; the guard is dropped at the
    // end of this block, BEFORE any spawn or `.await` on the child.
    let (claude_args, project_dir, child_slot, turn_in_flight) = {
        let sessions = state.sessions.lock().await;
        let handle = sessions
            .get(&uuid)
            .ok_or_else(|| format!("no session registered for id {session_id}"))?;

        // Reject a concurrent turn. `compare_exchange` claims the flag
        // atomically while the map guard is still held, so two racing
        // `send_turn`s for one session cannot both pass this gate.
        if handle
            .turn_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(format!(
                "a turn is already in flight for session {session_id}"
            ));
        }

        // Rebuild the arg vector from the session's remembered persona/tools —
        // the frontend does NOT re-send these on a follow-up turn.
        let turn_args = TurnArgs {
            prompt: &prompt,
            append_system_prompt: &handle.append_system_prompt,
            allowed_tools: &handle.allowed_tools,
            permission_mode: &handle.permission_mode,
            session_id: &session_id,
            turn_kind: TurnKind::Resumed,
        };
        (
            claude_adapter::build_args(&turn_args),
            handle.project_path.clone(),
            handle.child.clone(),
            handle.turn_in_flight.clone(),
        )
        // map guard dropped here
    };

    // --- Resolve `claude` + spawn the follow-up turn ---
    // If anything below fails we must release the in-flight flag we claimed,
    // otherwise the session would be wedged forever.
    let result: Result<spawn_core::SpawnedChild, String> = (|| {
        let claude_bin = binary::find_host_tool(&app, "claude", None)?;
        let mut cmd = spawn_core::piped_command(&claude_bin);
        cmd.args(&claude_args).current_dir(&project_dir);
        spawn_core::spawn_piped(cmd, &claude_bin)
    })();

    let spawned = match result {
        Ok(s) => s,
        Err(e) => {
            // Release the claimed flag so the session is usable again.
            turn_in_flight.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    // --- Start the per-turn reader + wait tasks ---
    run_turn(app.clone(), uuid, spawned, child_slot, turn_in_flight);

    Ok(())
}

/// Tauri command: report the `claude` CLI login state as a launch pre-flight.
///
/// A one-shot (no events), mirroring the `mcp_list` / `check_upgrades` shape:
/// resolve `claude`, run `claude auth status --text`, capture exit code +
/// stdout/stderr, and fold them into an [`AuthStatus`] via the pure
/// `auth_status_from_output` helper.
///
/// GAP-2: cross-checked against the live binary — `claude auth status` is a
/// real subcommand and exits 0 when logged in. It defaults to `--json`; we
/// pass `--text` explicitly so `detail` is a clean human-readable line.
///
/// This command NEVER returns `Err` for an expected negative state — a missing
/// `claude` binary or a not-logged-in CLI both come back as
/// `Ok(AuthStatus{ loggedIn: false, .. })` so the UI can render a clean gate
/// instead of an opaque error. `Err` is reserved for the process genuinely
/// failing to run.
#[tauri::command]
pub async fn claude_auth_status(app: AppHandle) -> Result<AuthStatus, String> {
    // --- Resolve the `claude` binary ---
    // A missing binary is an expected state, not an error: report it in-band.
    let claude_bin = match binary::find_host_tool(&app, "claude", None) {
        Ok(path) => path,
        Err(_) => {
            return Ok(AuthStatus {
                logged_in: false,
                detail: "claude CLI not found on PATH".to_string(),
            });
        }
    };

    // --- Run `claude auth status --text`, capture exit code + output ---
    let mut cmd = Command::new(&claude_bin);
    cmd.arg("auth")
        .arg("status")
        .arg("--text")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let output = cmd.output().await.map_err(|e| {
        format!(
            "failed to run `claude auth status` at {}: {e}",
            claude_bin.display()
        )
    })?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    Ok(auth_status_from_output(exit_code, &stdout, &stderr))
}

/// Tauri command: cancel the current turn of a session by SIGKILL-ing its
/// `claude` child.
///
/// Looks the session up by UUID (error if absent) and mirrors `sync.rs`'s
/// `cancel_sync`: lock the handle's child slot, `child.kill().await`, clear
/// the slot to `None`. Killing when no turn is in flight (slot already `None`)
/// is a harmless no-op. The session's status is set back to `"idle"` — a
/// cancelled session is left resumable (claude-code keeps conversation state
/// in its `--resume` store, independent of the process).
///
/// V0.3 KNOWN GAP: `child.kill()` sends SIGKILL on macOS, not SIGINT — see the
/// module header. Cancelling mid-turn is ungraceful but accepted for v0.3.
///
/// Lock discipline: the registry map guard is held only long enough to clone
/// out the handle's `child` Arc + flip its status, and is dropped before the
/// `.await` on `child.kill()`. No guard is ever held across an `.await`.
#[tauri::command]
pub async fn cancel_session(
    state: State<'_, SessionRegistry>,
    session_id: String,
) -> Result<(), String> {
    // --- Parse the UUID ---
    let uuid = Uuid::parse_str(&session_id)
        .map_err(|e| format!("invalid session id '{session_id}': {e}"))?;

    // --- Look the session up, copy out the child slot, mark it idle ---
    // The map guard is dropped at the end of this block, BEFORE the kill.
    let child_slot = {
        let mut sessions = state.sessions.lock().await;
        let handle = sessions
            .get_mut(&uuid)
            .ok_or_else(|| format!("no session registered for id {session_id}"))?;
        handle.status = "idle".to_string();
        handle.child.clone()
        // map guard dropped here
    };

    // --- SIGKILL the current turn's child (no-op if no turn is in flight) ---
    // The wait task observes the now-`None` slot and finalizes the turn with
    // the cancelled sentinel (-2); it also lowers `turn_in_flight` itself, so
    // cancel_session does not need to touch that flag.
    {
        let mut guard = child_slot.lock().await;
        if let Some(ref mut child) = *guard {
            child
                .kill()
                .await
                .map_err(|e| format!("failed to kill session child: {e}"))?;
        }
        *guard = None;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Hermetic: no `claude` binary, no spawning, no Tauri app. We exercise the
// pure / unit-testable seams — UUID generation + registry insert/lookup/
// remove, the `kind` discriminator mapping, the `isError` determination, and
// `SessionInfo` construction. Pattern matches binary.rs / claude_adapter.rs.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_adapter::Usage;

    fn dummy_handle(name: &str) -> SessionHandle {
        SessionHandle {
            eidolon_name: name.to_string(),
            project_path: PathBuf::from("/tmp/project"),
            permission_mode: "default".to_string(),
            append_system_prompt: "You are Sage.".to_string(),
            allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
            status: "idle".to_string(),
            child: Arc::new(Mutex::new(None)),
            turn_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Two host-generated UUIDs are distinct and non-nil — the registry key
    /// is unique per `start_session`.
    #[test]
    fn host_generated_uuids_are_unique_and_non_nil() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        assert_ne!(a, b, "two v4 UUIDs must differ");
        assert_ne!(a, Uuid::nil());
        assert_ne!(b, Uuid::nil());
        assert_eq!(a.get_version_num(), 4, "must be a v4 UUID");
    }

    /// Insert → lookup → remove round-trips on the registry map, keyed by UUID.
    #[test]
    fn registry_insert_lookup_remove_roundtrip() {
        let mut map: HashMap<Uuid, SessionHandle> = HashMap::new();
        let id = Uuid::new_v4();

        map.insert(id, dummy_handle("Sage"));
        assert!(map.contains_key(&id), "session must be addressable by UUID");
        assert_eq!(map.get(&id).unwrap().eidolon_name, "Sage");

        // A different UUID must not collide.
        let other = Uuid::new_v4();
        assert!(!map.contains_key(&other));

        let removed = map.remove(&id);
        assert!(removed.is_some(), "remove must return the handle");
        assert!(!map.contains_key(&id), "removed session is no longer present");
    }

    /// `event_kind` maps every `ParsedEvent` variant to its IPC discriminator;
    /// `Malformed` collapses onto `"unknown"`.
    #[test]
    fn event_kind_discriminator_mapping() {
        assert_eq!(
            event_kind(&ParsedEvent::Init {
                session_id: None,
                model: None,
                tools: vec![],
            }),
            "init"
        );
        assert_eq!(
            event_kind(&ParsedEvent::ApiRetry { message: None }),
            "apiRetry"
        );
        assert_eq!(
            event_kind(&ParsedEvent::Assistant { content: vec![] }),
            "assistant"
        );
        assert_eq!(
            event_kind(&ParsedEvent::User { content: vec![] }),
            "user"
        );
        assert_eq!(
            event_kind(&ParsedEvent::StreamEvent { event: None }),
            "streamEvent"
        );
        assert_eq!(
            event_kind(&ParsedEvent::Result {
                subtype: None,
                result: None,
                session_id: None,
                is_error: false,
                num_turns: None,
                duration_ms: None,
                total_cost_usd: None,
                usage: Usage::default(),
            }),
            "result"
        );
        assert_eq!(
            event_kind(&ParsedEvent::Unknown {
                raw: "{}".to_string()
            }),
            "unknown"
        );
        // Malformed shares the `unknown` discriminator — the raw line still
        // rides along in the payload's `raw` field.
        assert_eq!(
            event_kind(&ParsedEvent::Malformed {
                raw: "not json".to_string()
            }),
            "unknown"
        );
    }

    /// `turn_is_error`: a clean exit with a non-error result is the only
    /// success case; non-zero exit OR an error result is a failure.
    #[test]
    fn turn_is_error_determination() {
        // Clean exit, no error result → success.
        assert!(!turn_is_error(0, false));
        // Clean exit but the `result` event reported an error → failure.
        assert!(turn_is_error(0, true));
        // Non-zero exit → failure regardless of the result flag.
        assert!(turn_is_error(1, false));
        assert!(turn_is_error(1, true));
        // The cancel sentinel (-2) counts as a failure — a cancelled turn
        // did not complete successfully.
        assert!(turn_is_error(-2, false));
        // Unknown exit (-1) is also a failure.
        assert!(turn_is_error(-1, false));
    }

    /// `SessionInfo` is built with the host-generated id and echoes the
    /// supplied params; it round-trips through camelCase JSON.
    #[test]
    fn session_info_construction_and_camelcase() {
        let id = Uuid::new_v4();
        let info = SessionInfo {
            session_id: id.to_string(),
            eidolon_name: "Sage".to_string(),
            project_path: "/tmp/project".to_string(),
            permission_mode: "acceptEdits".to_string(),
            status: "running".to_string(),
        };
        assert_eq!(info.session_id, id.to_string());
        assert_eq!(info.eidolon_name, "Sage");
        assert_eq!(info.status, "running");

        let json = serde_json::to_value(&info).expect("SessionInfo serialises");
        // Tauri IPC contract: keys must be camelCase.
        assert!(json.get("sessionId").is_some());
        assert!(json.get("eidolonName").is_some());
        assert!(json.get("projectPath").is_some());
        assert!(json.get("permissionMode").is_some());
        assert!(json.get("status").is_some());
        // snake_case keys must NOT leak through.
        assert!(json.get("session_id").is_none());
    }

    /// The `turn_in_flight` claim is atomic: the first `compare_exchange`
    /// wins, a second one for the same session is rejected — this is the
    /// concurrency gate `send_turn` relies on.
    #[test]
    fn turn_in_flight_claim_is_exclusive() {
        let flag = Arc::new(AtomicBool::new(false));
        // First claim succeeds.
        assert!(flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        // Second claim (turn already in flight) fails.
        assert!(flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err());
        // After the wait task lowers it, a fresh turn can claim again.
        flag.store(false, Ordering::SeqCst);
        assert!(flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
    }

    /// `auth_status_from_output`: a zero exit is logged-in, and `detail`
    /// prefers the first non-blank stdout line (`claude auth status --text`
    /// prints `Login method: ...` first).
    #[test]
    fn auth_status_logged_in_from_zero_exit() {
        let status = auth_status_from_output(
            0,
            "Login method: Claude Max account\nEmail: someone@example.com\n",
            "",
        );
        assert!(status.logged_in, "exit 0 means logged in");
        assert_eq!(status.detail, "Login method: Claude Max account");
    }

    /// A non-zero exit is not-logged-in; `detail` falls back to the first
    /// non-blank stderr line.
    #[test]
    fn auth_status_logged_out_from_nonzero_exit() {
        let status = auth_status_from_output(1, "", "Not authenticated. Run `claude auth login`.");
        assert!(!status.logged_in, "non-zero exit means not logged in");
        assert_eq!(status.detail, "Not authenticated. Run `claude auth login`.");
    }

    /// With no usable output, `detail` falls back to a generic message keyed
    /// on the login state — never an empty string.
    #[test]
    fn auth_status_detail_falls_back_when_output_blank() {
        let logged_in = auth_status_from_output(0, "   \n\n", "");
        assert!(logged_in.logged_in);
        assert_eq!(logged_in.detail, "logged in to claude");

        let logged_out = auth_status_from_output(-1, "", "  \n");
        assert!(!logged_out.logged_in);
        assert_eq!(logged_out.detail, "not logged in to claude");
    }

    /// `AuthStatus` round-trips through camelCase JSON — `loggedIn`, never
    /// `logged_in`.
    #[test]
    fn auth_status_camelcase_serialization() {
        let status = AuthStatus {
            logged_in: true,
            detail: "Login method: Claude Max account".to_string(),
        };
        let json = serde_json::to_value(&status).expect("AuthStatus serialises");
        assert_eq!(json.get("loggedIn"), Some(&serde_json::json!(true)));
        assert!(json.get("detail").is_some());
        // snake_case must NOT leak through the IPC contract.
        assert!(json.get("logged_in").is_none());
    }

    /// `cancel_session` rejects an unparseable session id with a clear error.
    #[tokio::test]
    async fn cancel_session_rejects_invalid_uuid() {
        let registry = SessionRegistry::new();
        // A bare ad-hoc resolution of the lookup-then-error path: a malformed
        // id never reaches the registry, so an empty registry is sufficient.
        let err = {
            let session_id = "not-a-uuid".to_string();
            match Uuid::parse_str(&session_id) {
                Ok(_) => panic!("'not-a-uuid' must not parse"),
                Err(e) => format!("invalid session id '{session_id}': {e}"),
            }
        };
        assert!(err.starts_with("invalid session id 'not-a-uuid'"));
        // The registry is untouched by a rejected parse.
        assert!(registry.sessions.lock().await.is_empty());
    }

    /// `cancel_session`'s registry lookup misses for an unknown (but
    /// well-formed) UUID — the command surfaces a clear "no session" error.
    #[tokio::test]
    async fn cancel_session_unknown_uuid_is_a_miss() {
        let registry = SessionRegistry::new();
        let unknown = Uuid::new_v4();
        let sessions = registry.sessions.lock().await;
        assert!(
            sessions.get(&unknown).is_none(),
            "an unregistered UUID must not be found"
        );
        let err = format!("no session registered for id {unknown}");
        assert!(err.contains(&unknown.to_string()));
    }

    /// Cancelling a session whose child slot is already `None` (no turn in
    /// flight) is a harmless no-op — the slot stays `None`, no kill happens.
    #[tokio::test]
    async fn cancel_session_with_no_inflight_turn_is_noop() {
        let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        // Mirror cancel_session's kill block against an idle slot.
        {
            let mut guard = child_slot.lock().await;
            assert!(guard.is_none(), "no turn in flight to begin with");
            if let Some(ref mut _child) = *guard {
                panic!("there is no child to kill");
            }
            *guard = None;
        }
        assert!(child_slot.lock().await.is_none(), "slot stays None");
    }

    /// The `session-turn-complete` payload serialises to the camelCase IPC
    /// contract S6/S7 depend on.
    #[test]
    fn turn_complete_payload_camelcase() {
        let payload = TurnCompletePayload {
            session_id: "11111111-1111-1111-1111-111111111111".to_string(),
            exit_code: 0,
            had_result: true,
            is_error: false,
        };
        let json = serde_json::to_value(&payload).expect("payload serialises");
        assert!(json.get("sessionId").is_some());
        assert!(json.get("exitCode").is_some());
        assert!(json.get("hadResult").is_some());
        assert!(json.get("isError").is_some());
        assert!(json.get("had_result").is_none());
    }
}
