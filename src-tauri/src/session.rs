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
use crate::claude_adapter::{self, ParsedEvent, StreamDelta, TurnArgs, TurnKind};
use crate::session_store::{self, CumulativeUsage, PersistedEntry, SessionRecord, TurnRecord};
use crate::spawn_core;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
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
    /// R3 — the user-CHOSEN model, passed to `--model` on every turn. Distinct
    /// from the observed [`SessionHandle::model`] (the model `claude` reports
    /// back on `system/init`): this is the launch-time selection. Lives on the
    /// handle (not the frontend) so `send_turn` rebuilds the `TurnArgs` with it
    /// on every `--resume`. `None` omits the flag — `claude`'s default applies.
    pub chosen_model: Option<String>,
    /// R3 — the reasoning effort level, passed to `--effort` on every turn.
    /// Pinned for the session — `send_turn` rebuilds `TurnArgs` from it on
    /// every `--resume`. `None` omits the flag.
    pub thinking_effort: Option<String>,
    /// R3 — the fallback model alias, passed to `--fallback-model` on every
    /// turn. Pinned for the session's life. `None` omits the flag.
    pub fallback_model: Option<String>,
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

    // --- v0.3.1 persistence state ------------------------------------------
    // Story S1 makes Rust the transcript owner: it already parses every
    // NDJSON line, so it accumulates the durable `SessionRecord` content
    // here and flushes a full record per turn (see `run_turn`). These are
    // `Arc`s so the per-turn reader/wait tasks can touch them without
    // re-locking the registry map.
    /// `true` for a cortex-routed default session. The cortex launch path is
    /// story S4 — this field exists now so the record carries it.
    pub is_cortex: bool,
    /// Session title — derived from the turn-1 prompt at `start_session`.
    pub title: String,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
    /// The serving model — captured from the first `system/init` event seen.
    /// A synchronous `std::sync::Mutex`: the per-turn reader/wait tasks touch
    /// it only in short non-`await` critical sections (the stdout reader is a
    /// synchronous `FnMut`), so a tokio mutex would be the wrong tool here.
    pub model: Arc<StdMutex<Option<String>>>,
    /// The accumulating transcript buffer. Each reader task appends the
    /// `PersistedEntry` equivalent of every `session-event` / `session-stderr`
    /// it emits; the wait task flushes the whole buffer into the record.
    pub transcript: Arc<StdMutex<Vec<PersistedEntry>>>,
    /// Per-turn finalisation log — one [`TurnRecord`] appended by the wait
    /// task per turn, carrying the partial-turn-safety `result_seen` flag.
    pub per_turn: Arc<StdMutex<Vec<TurnRecord>>>,
    /// Cumulative token usage summed across every turn's `result` event.
    pub cumulative_usage: Arc<StdMutex<CumulativeUsage>>,
    /// Cumulative estimated cost summed across every turn's `total_cost_usd`.
    pub cumulative_cost_usd: Arc<StdMutex<Option<f64>>>,
    /// Monotonic turn counter — incremented per turn so each reader/wait task
    /// stamps its `PersistedEntry`s and `TurnRecord` with the right number.
    pub turn_counter: Arc<AtomicU32>,
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
    /// `true` for a cortex-routed default session. Optional — defaults to
    /// `false`. The cortex launch path is story S4; the field exists now so
    /// the persisted `SessionRecord` carries it from v0.3.1.
    #[serde(default)]
    pub is_cortex: bool,
    /// Optional explicit session title. When absent, the title is derived
    /// from `first_prompt` (first ~60 chars).
    #[serde(default)]
    pub title: Option<String>,
    /// R3 — the model to serve the session, passed to `--model` on every turn.
    /// An alias (`opus` / `sonnet` / `haiku` / `opusplan` / `default`, plus the
    /// `[1m]` variants) or a full model id. Optional — `None`/absent lets
    /// `claude` apply its own default. Pinned for the session's life.
    #[serde(default)]
    pub model: Option<String>,
    /// R3 — the reasoning effort level, passed to `--effort` on every turn
    /// (`low` / `medium` / `high` / `xhigh` / `max`). Optional — `None` lets
    /// `claude`'s own default apply. Pinned for the session's life.
    #[serde(default)]
    pub thinking_effort: Option<String>,
    /// R3 — the fallback model alias, passed to `--fallback-model` on every
    /// turn (auto-downgrade when the primary model is overloaded). Optional.
    #[serde(default)]
    pub fallback_model: Option<String>,
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
    /// RFC-3339 creation timestamp — also written into the `SessionRecord`.
    pub created_at: String,
    /// `true` for a cortex-routed default session (story S4 launch path).
    pub is_cortex: bool,
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

/// `session-delta` — an EPHEMERAL streaming fragment (story S6/S7).
///
/// Carries the cozy deltas pre-extracted from a `stream_event`'s inner event:
/// an incremental assistant-text fragment (`deltaKind == "text"`) or an
/// incremental `tool_use` JSON-input fragment (`deltaKind == "toolInput"`).
///
/// EPHEMERAL by contract: emitted live from the stdout reader but NEVER
/// appended to the persisted transcript / `SessionRecord` — the final
/// `assistant` / `user` `session-event` entries remain the durable source of
/// truth. `parentToolUseId` is non-null when the fragment came from a
/// self-routed subagent.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDeltaPayload {
    /// The owning session's UUID.
    session_id: String,
    /// The 1-based turn this delta belongs to.
    turn: u32,
    /// `"text"` for an assistant-text fragment, `"toolInput"` for a `tool_use`
    /// JSON-input fragment.
    delta_kind: String,
    /// The text fragment — set when `deltaKind == "text"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    /// The owning `tool_use` block's index — set when `deltaKind == "toolInput"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    block_index: Option<u64>,
    /// The `partial_json` fragment — set when `deltaKind == "toolInput"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    partial_json: Option<String>,
    /// Non-null when the fragment came from a self-routed subagent.
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
    /// RFC-3339 emit timestamp.
    ts: String,
}

/// `session-tool-start` — an EPHEMERAL "a tool call is beginning" marker
/// (story S6).
///
/// Fired on a `stream_event` `content_block_start(tool_use)` so the UI can
/// show a live "running" `ToolUseChip` (spinner + elapsed time) BEFORE the
/// paired `tool_result` arrives. EPHEMERAL — never persisted; the durable
/// `assistant`(`tool_use`) / `user`(`tool_result`) `session-event`s are the
/// source of truth once the turn completes.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionToolStartPayload {
    /// The owning session's UUID.
    session_id: String,
    /// The 1-based turn this tool call belongs to.
    turn: u32,
    /// The content-block index — correlates the eventual `toolInput` deltas
    /// (which carry only the index) back to this tool call.
    block_index: u64,
    /// The `tool_use` id — pairs with the eventual `tool_result.toolUseId`.
    tool_use_id: String,
    /// The tool name.
    tool_name: String,
    /// Non-null when the tool call is self-routed-subagent work.
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
    /// RFC-3339 emit timestamp.
    ts: String,
}

/// `session-usage` — an EPHEMERAL live mid-turn token-usage update (story S7).
///
/// Carries the incremental `usage` extracted from a `stream_event`'s
/// `message_start` / `message_delta`, feeding the `ContextGauge` so the
/// temperature bar moves mid-turn instead of only on the terminal `result`.
/// EPHEMERAL — the authoritative `result` usage supersedes it at turn end.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionUsagePayload {
    /// The owning session's UUID.
    session_id: String,
    /// The 1-based turn this usage belongs to.
    turn: u32,
    /// Input tokens reported so far this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    input_tokens: Option<u64>,
    /// Output tokens reported so far this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    output_tokens: Option<u64>,
    /// Cache-read input tokens reported so far this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_read_input_tokens: Option<u64>,
    /// Cache-creation input tokens reported so far this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_creation_input_tokens: Option<u64>,
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

/// Emit the EPHEMERAL streaming events for one extracted [`StreamDelta`]
/// (story S6/S7).
///
/// Called from the stdout reader for every `stream_event` line that carried a
/// recognised cozy delta. It maps the delta to one of the three new events:
///   * [`StreamDelta::Text`]      → `session-delta` (`deltaKind: "text"`)
///   * [`StreamDelta::ToolInput`] → `session-delta` (`deltaKind: "toolInput"`)
///   * [`StreamDelta::ToolStart`] → `session-tool-start`
///   * [`StreamDelta::Usage`]     → `session-usage`
///
/// EPHEMERAL by contract: this only `emit`s — it touches no persistence
/// buffer, so the deltas never reach the `SessionRecord`. An `emit` failure
/// is swallowed (`let _ =`), mirroring the other event emits in this module.
fn emit_stream_delta(
    app: &AppHandle,
    session_id: &str,
    turn: u32,
    delta: &StreamDelta,
    parent_tool_use_id: Option<&str>,
) {
    let ts = chrono::Utc::now().to_rfc3339();
    let parent = parent_tool_use_id.map(str::to_string);
    match delta {
        StreamDelta::Text { text } => {
            let _ = app.emit(
                "session-delta",
                SessionDeltaPayload {
                    session_id: session_id.to_string(),
                    turn,
                    delta_kind: "text".to_string(),
                    text: Some(text.clone()),
                    block_index: None,
                    partial_json: None,
                    parent_tool_use_id: parent,
                    ts,
                },
            );
        }
        StreamDelta::ToolInput {
            index,
            partial_json,
        } => {
            let _ = app.emit(
                "session-delta",
                SessionDeltaPayload {
                    session_id: session_id.to_string(),
                    turn,
                    delta_kind: "toolInput".to_string(),
                    text: None,
                    block_index: Some(*index),
                    partial_json: Some(partial_json.clone()),
                    parent_tool_use_id: parent,
                    ts,
                },
            );
        }
        StreamDelta::ToolStart {
            index,
            tool_use_id,
            tool_name,
        } => {
            let _ = app.emit(
                "session-tool-start",
                SessionToolStartPayload {
                    session_id: session_id.to_string(),
                    turn,
                    block_index: *index,
                    tool_use_id: tool_use_id.clone(),
                    tool_name: tool_name.clone(),
                    parent_tool_use_id: parent,
                    ts,
                },
            );
        }
        StreamDelta::Usage { usage } => {
            let _ = app.emit(
                "session-usage",
                SessionUsagePayload {
                    session_id: session_id.to_string(),
                    turn,
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    cache_read_input_tokens: usage.cache_read_input_tokens,
                    cache_creation_input_tokens: usage.cache_creation_input_tokens,
                    ts,
                },
            );
        }
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
// Persistence plumbing (story S1)
// ---------------------------------------------------------------------------

/// Immutable per-session metadata snapshotted into a turn's reader/wait tasks.
///
/// `SessionHandle` lives in the registry behind a map mutex; cloning these
/// owned fields out once (under the map guard, then dropped) lets the spawned
/// tasks build a [`SessionRecord`] at flush time WITHOUT re-locking the map.
#[derive(Clone)]
struct SessionMeta {
    uuid: String,
    eidolon_name: String,
    is_cortex: bool,
    title: String,
    project_path: String,
    permission_mode: String,
    append_system_prompt: String,
    allowed_tools: Vec<String>,
    created_at: String,
    /// R3 — the user-chosen model / effort / fallback, snapshotted so the
    /// per-turn flush writes them into the durable `SessionRecord`.
    chosen_model: Option<String>,
    thinking_effort: Option<String>,
    fallback_model: Option<String>,
}

/// The shared persistence `Arc`s a turn's reader/wait tasks accumulate into.
///
/// Cloned out of the [`SessionHandle`] alongside [`SessionMeta`]; the reader
/// tasks append to `transcript`, the wait task folds usage/cost and appends
/// the per-turn [`TurnRecord`], then flushes a full [`SessionRecord`]. All
/// `std::sync::Mutex` — every critical section is synchronous and short, and
/// no guard is ever held across an `.await`.
#[derive(Clone)]
struct PersistState {
    model: Arc<StdMutex<Option<String>>>,
    transcript: Arc<StdMutex<Vec<PersistedEntry>>>,
    per_turn: Arc<StdMutex<Vec<TurnRecord>>>,
    cumulative_usage: Arc<StdMutex<CumulativeUsage>>,
    cumulative_cost_usd: Arc<StdMutex<Option<f64>>>,
}

/// Build the current [`SessionRecord`] from the session's metadata + the
/// accumulated persistence state. Called by the wait-task tail per turn.
///
/// `status` is the post-turn status string (`idle` / `failed`). Each lock is
/// taken, read into an owned value, and dropped within its own statement —
/// no guard is ever held across an `.await`.
fn build_record(meta: &SessionMeta, persist: &PersistState, status: &str) -> SessionRecord {
    let model = persist.model.lock().expect("model mutex poisoned").clone();
    let transcript = persist
        .transcript
        .lock()
        .expect("transcript mutex poisoned")
        .clone();
    let per_turn = persist
        .per_turn
        .lock()
        .expect("per_turn mutex poisoned")
        .clone();
    let cumulative_usage = persist
        .cumulative_usage
        .lock()
        .expect("cumulative_usage mutex poisoned")
        .clone();
    let cumulative_cost_usd = *persist
        .cumulative_cost_usd
        .lock()
        .expect("cumulative_cost mutex poisoned");

    SessionRecord {
        uuid: meta.uuid.clone(),
        eidolon_name: meta.eidolon_name.clone(),
        is_cortex: meta.is_cortex,
        title: meta.title.clone(),
        project_path: meta.project_path.clone(),
        permission_mode: meta.permission_mode.clone(),
        append_system_prompt: meta.append_system_prompt.clone(),
        allowed_tools: meta.allowed_tools.clone(),
        status: status.to_string(),
        model,
        // R3 — persist the launch-time model/effort selection so a reopened
        // session resumes with the SAME `--model` / `--effort` / fallback.
        chosen_model: meta.chosen_model.clone(),
        thinking_effort: meta.thinking_effort.clone(),
        fallback_model: meta.fallback_model.clone(),
        created_at: meta.created_at.clone(),
        last_active_at: chrono::Utc::now().to_rfc3339(),
        transcript,
        cumulative_usage,
        cumulative_cost_usd,
        per_turn,
    }
}

/// Reconstruct a live [`SessionHandle`] from a persisted [`SessionRecord`].
///
/// Story S2 — the `reopen_session` reconstruction seam, factored out so the
/// record→handle mapping is unit-testable without an `AppHandle` or disk I/O.
///
/// Metadata is copied verbatim from the record. The persistence buffers
/// (`transcript` / `per_turn` / `cumulative_usage` / `cumulative_cost_usd` /
/// `model`) are SEEDED from the record so a later turn's flush rebuilds the
/// full record from them rather than truncating the rehydrated history. Live
/// state is fresh: `child = None`, `turn_in_flight = false`, `status = "idle"`
/// (re-entry is lazy — no turn is spawned). The `turn_counter` is seeded past
/// the highest recorded turn so the next `send_turn` stamps a fresh number.
fn handle_from_record(record: &SessionRecord) -> SessionHandle {
    let turn_counter_start = record.per_turn.iter().map(|t| t.turn).max().unwrap_or(0);
    SessionHandle {
        eidolon_name: record.eidolon_name.clone(),
        project_path: PathBuf::from(&record.project_path),
        permission_mode: record.permission_mode.clone(),
        // R3 — rehydrate the launch-time model/effort selection so a resumed
        // turn rebuilds `TurnArgs` with the same `--model` / `--effort`.
        chosen_model: record.chosen_model.clone(),
        thinking_effort: record.thinking_effort.clone(),
        fallback_model: record.fallback_model.clone(),
        append_system_prompt: record.append_system_prompt.clone(),
        allowed_tools: record.allowed_tools.clone(),
        status: "idle".to_string(),
        child: Arc::new(Mutex::new(None)),
        turn_in_flight: Arc::new(AtomicBool::new(false)),
        is_cortex: record.is_cortex,
        title: record.title.clone(),
        created_at: record.created_at.clone(),
        model: Arc::new(StdMutex::new(record.model.clone())),
        transcript: Arc::new(StdMutex::new(record.transcript.clone())),
        per_turn: Arc::new(StdMutex::new(record.per_turn.clone())),
        cumulative_usage: Arc::new(StdMutex::new(record.cumulative_usage.clone())),
        cumulative_cost_usd: Arc::new(StdMutex::new(record.cumulative_cost_usd)),
        turn_counter: Arc::new(AtomicU32::new(turn_counter_start)),
    }
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
///
/// Story S1 — persistence: `turn` is this turn's 1-based number; the reader
/// tasks append a [`PersistedEntry`] to `persist.transcript` for every
/// `session-event` / `session-stderr` they emit (Rust is the transcript
/// owner). The wait-task tail folds the turn's usage/cost, appends a
/// [`TurnRecord`] (with `result_seen` — `false` when the turn exited WITHOUT
/// a terminal `result`, the crash/SIGKILL safety case), and flushes the FULL
/// [`SessionRecord`] + `index.json` entry right before the
/// `session-turn-complete` emit.
///
/// R4 — `prompt` is the human's typed prompt for this turn. A `PersistedEntry`
/// for it is appended to `persist.transcript` here, BEFORE the reader tasks,
/// so it lands ahead of the turn's `claude` output and survives a reopen. It
/// is DELIBERATELY not emitted as a live event: the frontend already appends
/// the matching live `prompt` `TranscriptEntry` on turn dispatch, so emitting
/// here would double it. The persisted entry is purely for restart durability
/// — `reopen` replaces the whole transcript via `transcriptFromPersisted`, so
/// the live and reopened transcripts converge on the SAME `prompt` entry shape.
#[allow(clippy::too_many_arguments)]
fn run_turn(
    app: AppHandle,
    session_id: Uuid,
    spawned: spawn_core::SpawnedChild,
    child_slot: Arc<Mutex<Option<Child>>>,
    turn_in_flight: Arc<AtomicBool>,
    meta: SessionMeta,
    persist: PersistState,
    turn: u32,
    prompt: &str,
) {
    let spawn_core::SpawnedChild {
        child,
        stdout,
        stderr,
    } = spawned;

    let session_id_str = session_id.to_string();

    // R4 — append the user's typed prompt as a `prompt` PersistedEntry before
    // the turn's `claude` output. It heads the turn group on a reopen and uses
    // the SAME shape (`source: "prompt"`, `line` = prompt text) the frontend
    // appends live, so a reopened transcript neither duplicates nor mis-renders.
    {
        let prompt_ts = chrono::Utc::now().to_rfc3339();
        persist
            .transcript
            .lock()
            .expect("transcript mutex poisoned")
            .push(PersistedEntry {
                source: "prompt".to_string(),
                turn,
                kind: None,
                parsed: None,
                line: prompt.to_string(),
                ts: prompt_ts,
            });
    }

    // R6 — shared dual-finalize state.
    //   * `result_seen`  — set by the stdout reader on a terminal `result`.
    //   * `result_error` — set by the stdout reader iff that `result` had
    //                      `is_error: true`. Read by the wait task.
    let result_seen = Arc::new(AtomicBool::new(false));
    let result_error = Arc::new(AtomicBool::new(false));

    // --- stdout reader -----------------------------------------------------
    // Each line → parse_line → `session-event`. On a `Result` event, flip the
    // shared dual-finalize flags AND fold its usage/cost into the cumulative
    // totals. On an `Init` event, capture the serving model. Every line is
    // also appended to the transcript buffer (Rust is the transcript owner).
    // `read_lines`'s closure is a synchronous `FnMut + Send`; the persistence
    // mutexes are `std::sync::Mutex` so their short critical sections need no
    // `.await` — nothing is held across a yield point.
    let app_stdout = app.clone();
    let sid_stdout = session_id_str.clone();
    let result_seen_rd = result_seen.clone();
    let result_error_rd = result_error.clone();
    let persist_stdout = persist.clone();
    let stdout_task = spawn_core::read_lines(stdout, move |line| {
        let parsed = claude_adapter::parse_line(&line);
        match &parsed {
            ParsedEvent::Result {
                is_error,
                usage,
                total_cost_usd,
                ..
            } => {
                // R6: a terminal `result` was observed — record it for the
                // wait task. `Ordering::SeqCst` is more than enough here;
                // these flags are read once, after the reader fully joins.
                if *is_error {
                    result_error_rd.store(true, Ordering::SeqCst);
                }
                result_seen_rd.store(true, Ordering::SeqCst);

                // Accumulate cumulative usage + cost across turns.
                persist_stdout
                    .cumulative_usage
                    .lock()
                    .expect("cumulative_usage mutex poisoned")
                    .add(usage);
                if let Some(cost) = total_cost_usd {
                    let mut acc = persist_stdout
                        .cumulative_cost_usd
                        .lock()
                        .expect("cumulative_cost mutex poisoned");
                    *acc = Some(acc.unwrap_or(0.0) + cost);
                }
            }
            ParsedEvent::Init {
                model: Some(m), ..
            } => {
                // Capture the serving model the first time `init` reports one.
                let mut slot = persist_stdout
                    .model
                    .lock()
                    .expect("model mutex poisoned");
                if slot.is_none() {
                    *slot = Some(m.clone());
                }
            }
            ParsedEvent::StreamEvent {
                delta: Some(delta),
                parent_tool_use_id,
                ..
            } => {
                // Story S6/S7 — emit the EPHEMERAL streaming events. These are
                // emitted but DELIBERATELY NOT folded into any persistence
                // buffer: the `stream_event` line still rides into `transcript`
                // as a `streamEvent` `session-event` below (story S1), but the
                // *deltas* never become durable state. The cumulative usage on
                // the `SessionRecord` is only ever advanced by a terminal
                // `result` (above) — `session-usage` is a live preview the
                // `result` supersedes, so there is no double-counting.
                emit_stream_delta(
                    &app_stdout,
                    &sid_stdout,
                    turn,
                    delta,
                    parent_tool_use_id.as_deref(),
                );
            }
            _ => {}
        }

        let ts = chrono::Utc::now().to_rfc3339();
        let kind = event_kind(&parsed).to_string();

        // Append the durable transcript entry before emitting — the parsed
        // event is serialised to a `Value` so the store never depends on the
        // `ParsedEvent` enum shape.
        let parsed_value = serde_json::to_value(&parsed).ok();
        persist_stdout
            .transcript
            .lock()
            .expect("transcript mutex poisoned")
            .push(PersistedEntry {
                source: "event".to_string(),
                turn,
                kind: Some(kind.clone()),
                parsed: parsed_value,
                line: line.clone(),
                ts: ts.clone(),
            });

        let payload = SessionEventPayload {
            session_id: sid_stdout.clone(),
            kind,
            raw: line,
            parsed,
            ts,
        };
        let _ = app_stdout.emit("session-event", payload);
    });

    // --- stderr reader -----------------------------------------------------
    let app_stderr = app.clone();
    let sid_stderr = session_id_str.clone();
    let persist_stderr = persist.clone();
    let stderr_task = spawn_core::read_lines(stderr, move |line| {
        let ts = chrono::Utc::now().to_rfc3339();

        // A stderr entry carries no `kind` / `parsed` — just the raw line.
        persist_stderr
            .transcript
            .lock()
            .expect("transcript mutex poisoned")
            .push(PersistedEntry {
                source: "stderr".to_string(),
                turn,
                kind: None,
                parsed: None,
                line: line.clone(),
                ts: ts.clone(),
            });

        let payload = SessionStderrPayload {
            session_id: sid_stderr.clone(),
            line,
            ts,
        };
        let _ = app_stderr.emit("session-stderr", payload);
    });

    // Store the live child so a future `cancel_session` (S5) can reach it.
    // Scoped: the guard is dropped before the wait task is spawned, and the
    // wait task re-locks it independently — no guard is ever held across an
    // `.await`.
    let app_complete = app.clone();
    let app_persist = app.clone();
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

        // --- Story S1: per-turn durable flush --------------------------------
        // Append this turn's finalisation record. `result_seen` carries the
        // partial-turn-safety signal: a turn that exited WITHOUT a terminal
        // `result` event (crash / SIGKILL / dropped result) flushes here with
        // `result_seen: false` so re-entry (story S2) offers a fresh
        // continuation rather than restoring a half-written turn.
        {
            let mut log = persist
                .per_turn
                .lock()
                .expect("per_turn mutex poisoned");
            log.push(TurnRecord {
                turn,
                result_seen: had_result,
            });
        }

        // Flush the FULL SessionRecord (transcript buffer included) + refresh
        // the index.json entry. A flush failure is logged, not fatal — the
        // turn still completes and the UI still receives `session-turn-complete`.
        let status = if is_error { "failed" } else { "idle" };
        let record = build_record(&meta, &persist, status);
        if let Err(e) = session_store::persist_record(&app_persist, &record) {
            eprintln!("[session-store] warn: per-turn flush failed for {session_id_str}: {e}");
        }

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
    // R3 — the user-chosen model / effort / fallback flow in from `params`.
    let turn_args = TurnArgs {
        prompt: &params.first_prompt,
        append_system_prompt: &params.append_system_prompt,
        allowed_tools: &params.allowed_tools,
        permission_mode: &params.permission_mode,
        session_id: &session_id_str,
        turn_kind: TurnKind::First,
        model: params.model.as_deref(),
        thinking_effort: params.thinking_effort.as_deref(),
        fallback_model: params.fallback_model.as_deref(),
    };
    let args = claude_adapter::build_args(&turn_args);

    // --- Spawn `claude` with piped stdio + kill_on_drop in projectPath ---
    let mut cmd = spawn_core::piped_command(&claude_bin);
    cmd.args(&args).current_dir(&project_dir);
    let spawned = spawn_core::spawn_piped(cmd, &claude_bin)?;

    // --- Derive the title + creation timestamp (story S1 persistence) ---
    // The title is the caller-supplied one if present, else derived from the
    // turn-1 prompt (first ~60 chars). `created_at` is fixed for the session's
    // life; `last_active_at` is bumped on every per-turn flush.
    let title = match &params.title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => session_store::derive_title(&params.first_prompt),
    };
    let created_at = chrono::Utc::now().to_rfc3339();

    // --- Register the SessionHandle ---
    let child_slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    let turn_in_flight = Arc::new(AtomicBool::new(true));
    let turn_counter = Arc::new(AtomicU32::new(0));
    // Story S1 persistence buffers — Rust owns the durable transcript.
    let model: Arc<StdMutex<Option<String>>> = Arc::new(StdMutex::new(None));
    let transcript: Arc<StdMutex<Vec<PersistedEntry>>> = Arc::new(StdMutex::new(Vec::new()));
    let per_turn: Arc<StdMutex<Vec<TurnRecord>>> = Arc::new(StdMutex::new(Vec::new()));
    let cumulative_usage: Arc<StdMutex<CumulativeUsage>> =
        Arc::new(StdMutex::new(CumulativeUsage::default()));
    let cumulative_cost_usd: Arc<StdMutex<Option<f64>>> = Arc::new(StdMutex::new(None));

    let handle = SessionHandle {
        eidolon_name: params.eidolon_name.clone(),
        project_path: project_dir.clone(),
        permission_mode: params.permission_mode.clone(),
        // R3 — pin the launch-time model/effort onto the handle so `send_turn`
        // rebuilds `TurnArgs` with them on every `--resume`.
        chosen_model: params.model.clone(),
        thinking_effort: params.thinking_effort.clone(),
        fallback_model: params.fallback_model.clone(),
        append_system_prompt: params.append_system_prompt.clone(),
        allowed_tools: params.allowed_tools.clone(),
        status: "running".to_string(),
        child: child_slot.clone(),
        turn_in_flight: turn_in_flight.clone(),
        is_cortex: params.is_cortex,
        title: title.clone(),
        created_at: created_at.clone(),
        model: model.clone(),
        transcript: transcript.clone(),
        per_turn: per_turn.clone(),
        cumulative_usage: cumulative_usage.clone(),
        cumulative_cost_usd: cumulative_cost_usd.clone(),
        turn_counter: turn_counter.clone(),
    };
    {
        // Guard scoped to the synchronous insert — dropped before `run_turn`.
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id, handle);
    }

    // --- Snapshot the persistence context for turn 1 ---
    let meta = SessionMeta {
        uuid: session_id_str.clone(),
        eidolon_name: params.eidolon_name.clone(),
        is_cortex: params.is_cortex,
        title: title.clone(),
        project_path: params.project_path.clone(),
        permission_mode: params.permission_mode.clone(),
        append_system_prompt: params.append_system_prompt.clone(),
        allowed_tools: params.allowed_tools.clone(),
        created_at: created_at.clone(),
        chosen_model: params.model.clone(),
        thinking_effort: params.thinking_effort.clone(),
        fallback_model: params.fallback_model.clone(),
    };
    let persist = PersistState {
        model,
        transcript,
        per_turn,
        cumulative_usage,
        cumulative_cost_usd,
    };

    // --- Write the initial SessionRecord + index.json entry ---
    // The session is durable from birth — even if turn 1 crashes before its
    // per-turn flush, `list_sessions` already sees it. A write failure is
    // logged, not fatal: the in-memory session still runs.
    {
        let initial = build_record(&meta, &persist, "running");
        if let Err(e) = session_store::persist_record(&app, &initial) {
            eprintln!("[session-store] warn: initial record write failed for {session_id_str}: {e}");
        }
    }

    // --- Start the per-turn reader + wait tasks (turn 1) ---
    let turn = turn_counter.fetch_add(1, Ordering::SeqCst) + 1;
    run_turn(
        app.clone(),
        session_id,
        spawned,
        child_slot,
        turn_in_flight,
        meta,
        persist,
        turn,
        &params.first_prompt,
    );

    Ok(SessionInfo {
        session_id: session_id_str,
        eidolon_name: params.eidolon_name,
        project_path: params.project_path,
        permission_mode: params.permission_mode,
        status: "running".to_string(),
        created_at,
        is_cortex: params.is_cortex,
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
    // end of this block, BEFORE any spawn or `.await` on the child. The
    // persistence context (`meta` + `persist` + the next turn number) is
    // snapshotted here too — story S1 threads it into `run_turn`'s flush.
    let (claude_args, project_dir, child_slot, turn_in_flight, meta, persist, turn) = {
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
        // the frontend does NOT re-send these on a follow-up turn. R3: the
        // user-chosen model / effort / fallback are read from the handle here
        // too, so a `--resume` turn runs on the SAME model/effort as turn 1.
        let turn_args = TurnArgs {
            prompt: &prompt,
            append_system_prompt: &handle.append_system_prompt,
            allowed_tools: &handle.allowed_tools,
            permission_mode: &handle.permission_mode,
            session_id: &session_id,
            turn_kind: TurnKind::Resumed,
            model: handle.chosen_model.as_deref(),
            thinking_effort: handle.thinking_effort.as_deref(),
            fallback_model: handle.fallback_model.as_deref(),
        };
        let meta = SessionMeta {
            uuid: session_id.clone(),
            eidolon_name: handle.eidolon_name.clone(),
            is_cortex: handle.is_cortex,
            title: handle.title.clone(),
            project_path: handle.project_path.to_string_lossy().to_string(),
            permission_mode: handle.permission_mode.clone(),
            append_system_prompt: handle.append_system_prompt.clone(),
            allowed_tools: handle.allowed_tools.clone(),
            created_at: handle.created_at.clone(),
            chosen_model: handle.chosen_model.clone(),
            thinking_effort: handle.thinking_effort.clone(),
            fallback_model: handle.fallback_model.clone(),
        };
        let persist = PersistState {
            model: handle.model.clone(),
            transcript: handle.transcript.clone(),
            per_turn: handle.per_turn.clone(),
            cumulative_usage: handle.cumulative_usage.clone(),
            cumulative_cost_usd: handle.cumulative_cost_usd.clone(),
        };
        // The next 1-based turn number for this session.
        let turn = handle.turn_counter.fetch_add(1, Ordering::SeqCst) + 1;
        (
            claude_adapter::build_args(&turn_args),
            handle.project_path.clone(),
            handle.child.clone(),
            handle.turn_in_flight.clone(),
            meta,
            persist,
            turn,
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
    run_turn(
        app.clone(),
        uuid,
        spawned,
        child_slot,
        turn_in_flight,
        meta,
        persist,
        turn,
        &prompt,
    );

    Ok(())
}

/// Tauri command: re-insert a persisted session into the live registry.
///
/// Story S2 — re-entry after a route change or an app restart. The
/// [`SessionRegistry`] is in-memory, so a session loaded from disk has no
/// live [`SessionHandle`]: a follow-up `send_turn` would fail with "no session
/// registered". `reopen_session` closes that gap.
///
/// It reads the persisted [`SessionRecord`] (via `session_store`), reconstructs
/// a `SessionHandle` with the record's metadata AND its accumulated content
/// rehydrated — the transcript buffer, the per-turn finalisation log, the
/// cumulative usage/cost, the captured model, and the turn counter set to the
/// number of turns already recorded. Rehydrating the buffers matters: a later
/// turn's flush rebuilds the FULL [`SessionRecord`] from `persist.transcript`,
/// so an empty buffer would silently truncate the session's history on the
/// next `send_turn`.
///
/// The live state is fresh: `child = None`, `turn_in_flight = false`. It does
/// NOT spawn a turn — re-entry is lazy; the next `send_turn` issues the
/// `--resume <uuid>` for this session.
///
/// Idempotent: if the session is already live in the registry (e.g. reopened
/// twice, or never unmounted), the existing handle is left untouched and its
/// current [`SessionInfo`] is returned.
///
/// Lock discipline: the registry map guard is taken twice — once for the
/// idempotency probe, once for the insert — each scoped to a synchronous
/// block, never held across the `.await` on `session_store` I/O (which itself
/// is synchronous `std::fs`, run before the second lock).
#[tauri::command]
pub async fn reopen_session(
    state: State<'_, SessionRegistry>,
    app: AppHandle,
    session_id: String,
) -> Result<SessionInfo, String> {
    // --- Parse the UUID ---
    let uuid = Uuid::parse_str(&session_id)
        .map_err(|e| format!("invalid session id '{session_id}': {e}"))?;

    // --- Idempotency probe: already live? Return its current SessionInfo ---
    // The map guard is scoped to this block and dropped before any I/O.
    {
        let sessions = state.sessions.lock().await;
        if let Some(handle) = sessions.get(&uuid) {
            return Ok(SessionInfo {
                session_id: session_id.clone(),
                eidolon_name: handle.eidolon_name.clone(),
                project_path: handle.project_path.to_string_lossy().to_string(),
                permission_mode: handle.permission_mode.clone(),
                status: handle.status.clone(),
                created_at: handle.created_at.clone(),
                is_cortex: handle.is_cortex,
            });
        }
    }

    // --- Load the persisted record from disk ---
    let record = session_store::read_record(&app, &session_id)?;

    // --- Reconstruct a SessionHandle with the record's content rehydrated ---
    // Live state is fresh (no child, no turn in flight); the persistence
    // buffers are seeded from the record so a later turn's flush does not
    // truncate the rehydrated history. See `handle_from_record`.
    let handle = handle_from_record(&record);

    // --- Insert into the registry (guard scoped to the synchronous insert) ---
    // A racing `reopen_session` for the same id may have inserted between the
    // probe and here — re-check under the guard and prefer the existing handle.
    {
        let mut sessions = state.sessions.lock().await;
        sessions.entry(uuid).or_insert(handle);
    }

    Ok(SessionInfo {
        session_id,
        eidolon_name: record.eidolon_name,
        project_path: record.project_path,
        permission_mode: record.permission_mode,
        status: "idle".to_string(),
        created_at: record.created_at,
        is_cortex: record.is_cortex,
    })
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
            chosen_model: None,
            thinking_effort: None,
            fallback_model: None,
            append_system_prompt: "You are Sage.".to_string(),
            allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
            status: "idle".to_string(),
            child: Arc::new(Mutex::new(None)),
            turn_in_flight: Arc::new(AtomicBool::new(false)),
            is_cortex: false,
            title: "Test session".to_string(),
            created_at: "2026-05-22T12:00:00+00:00".to_string(),
            model: Arc::new(StdMutex::new(None)),
            transcript: Arc::new(StdMutex::new(Vec::new())),
            per_turn: Arc::new(StdMutex::new(Vec::new())),
            cumulative_usage: Arc::new(StdMutex::new(CumulativeUsage::default())),
            cumulative_cost_usd: Arc::new(StdMutex::new(None)),
            turn_counter: Arc::new(AtomicU32::new(0)),
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
            event_kind(&ParsedEvent::StreamEvent {
                event: None,
                delta: None,
                parent_tool_use_id: None,
            }),
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
            created_at: "2026-05-22T12:00:00+00:00".to_string(),
            is_cortex: false,
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
        assert!(json.get("createdAt").is_some());
        assert!(json.get("isCortex").is_some());
        // snake_case keys must NOT leak through.
        assert!(json.get("session_id").is_none());
        assert!(json.get("created_at").is_none());
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

    // --- reopen_session reconstruction (story S2) -----------------------------

    fn sample_record() -> SessionRecord {
        SessionRecord {
            uuid: "44444444-4444-4444-4444-444444444444".to_string(),
            eidolon_name: "Sage".to_string(),
            is_cortex: false,
            title: "Reopened session".to_string(),
            project_path: "/tmp/project".to_string(),
            permission_mode: "acceptEdits".to_string(),
            append_system_prompt: "You are Sage.".to_string(),
            allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
            status: "failed".to_string(),
            model: Some("claude-opus-4-7".to_string()),
            chosen_model: Some("opus".to_string()),
            thinking_effort: Some("high".to_string()),
            fallback_model: Some("sonnet".to_string()),
            created_at: "2026-05-22T12:00:00+00:00".to_string(),
            last_active_at: "2026-05-22T12:30:00+00:00".to_string(),
            transcript: vec![PersistedEntry {
                source: "event".to_string(),
                turn: 1,
                kind: Some("assistant".to_string()),
                parsed: None,
                line: r#"{"type":"assistant"}"#.to_string(),
                ts: "2026-05-22T12:00:00+00:00".to_string(),
            }],
            cumulative_usage: CumulativeUsage {
                input_tokens: 900,
                output_tokens: 120,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 50,
            },
            cumulative_cost_usd: Some(0.0456),
            per_turn: vec![
                TurnRecord {
                    turn: 1,
                    result_seen: true,
                },
                TurnRecord {
                    turn: 2,
                    result_seen: false,
                },
            ],
        }
    }

    /// `handle_from_record` copies the record's metadata verbatim and seeds the
    /// live state fresh — `idle`, no child, no turn in flight.
    #[test]
    fn handle_from_record_maps_metadata_and_fresh_live_state() {
        let record = sample_record();
        let handle = handle_from_record(&record);

        // Metadata copied verbatim from the record.
        assert_eq!(handle.eidolon_name, "Sage");
        assert_eq!(handle.project_path, PathBuf::from("/tmp/project"));
        assert_eq!(handle.permission_mode, "acceptEdits");
        assert_eq!(handle.append_system_prompt, "You are Sage.");
        assert_eq!(handle.allowed_tools, vec!["Read", "Edit"]);
        assert!(!handle.is_cortex);
        assert_eq!(handle.title, "Reopened session");
        assert_eq!(handle.created_at, "2026-05-22T12:00:00+00:00");

        // Live state is FRESH regardless of the record's persisted status —
        // re-entry is lazy, the session is idle until the next `send_turn`.
        assert_eq!(handle.status, "idle");
        assert!(!handle.turn_in_flight.load(Ordering::SeqCst));
    }

    /// `handle_from_record` rehydrates the content buffers so a later turn's
    /// flush rebuilds the FULL record rather than truncating prior history.
    #[test]
    fn handle_from_record_rehydrates_content_buffers() {
        let record = sample_record();
        let handle = handle_from_record(&record);

        // Transcript buffer carries the persisted entries.
        assert_eq!(
            handle.transcript.lock().unwrap().len(),
            1,
            "transcript must be rehydrated, not empty"
        );
        // Per-turn log carries every recorded turn.
        assert_eq!(handle.per_turn.lock().unwrap().len(), 2);
        // Cumulative usage + cost + model are seeded from the record.
        assert_eq!(handle.cumulative_usage.lock().unwrap().input_tokens, 900);
        assert_eq!(*handle.cumulative_cost_usd.lock().unwrap(), Some(0.0456));
        assert_eq!(
            handle.model.lock().unwrap().as_deref(),
            Some("claude-opus-4-7")
        );
        // The turn counter is seeded past the highest recorded turn — the next
        // `send_turn` (counter + 1) stamps turn 3.
        assert_eq!(handle.turn_counter.load(Ordering::SeqCst), 2);
        assert_eq!(
            handle.turn_counter.fetch_add(1, Ordering::SeqCst) + 1,
            3,
            "next turn after rehydration is turn 3"
        );
    }

    /// R3 — `handle_from_record` rehydrates the user-chosen model / effort /
    /// fallback so a `--resume` turn rebuilds `TurnArgs` with the same flags.
    #[test]
    fn handle_from_record_rehydrates_chosen_model_and_effort() {
        let record = sample_record();
        let handle = handle_from_record(&record);
        assert_eq!(handle.chosen_model.as_deref(), Some("opus"));
        assert_eq!(handle.thinking_effort.as_deref(), Some("high"));
        assert_eq!(handle.fallback_model.as_deref(), Some("sonnet"));
    }

    /// A record with no per-turn entries (a session that never finished a turn)
    /// rehydrates with the turn counter at 0 — the next `send_turn` is turn 1.
    #[test]
    fn handle_from_record_empty_per_turn_starts_counter_at_zero() {
        let mut record = sample_record();
        record.per_turn.clear();
        record.transcript.clear();
        let handle = handle_from_record(&record);
        assert_eq!(handle.turn_counter.load(Ordering::SeqCst), 0);
        assert!(handle.transcript.lock().unwrap().is_empty());
    }

    /// `reopen_session` is idempotent: re-inserting an already-live session
    /// must not clobber it. `HashMap::entry().or_insert()` is the seam — a
    /// second insert for the same key is a no-op.
    #[test]
    fn reopen_is_idempotent_via_entry_or_insert() {
        let mut map: HashMap<Uuid, SessionHandle> = HashMap::new();
        let id = Uuid::new_v4();

        // First reopen inserts.
        map.entry(id).or_insert_with(|| dummy_handle("First"));
        assert_eq!(map.get(&id).unwrap().eidolon_name, "First");

        // A second reopen for the same id must NOT replace the live handle.
        map.entry(id).or_insert_with(|| dummy_handle("Second"));
        assert_eq!(
            map.get(&id).unwrap().eidolon_name,
            "First",
            "an already-live session must not be clobbered by reopen"
        );
    }

    // --- R4: user-prompt transcript entry ------------------------------------

    /// R4 — a `prompt` `PersistedEntry` (the human's typed turn prompt) is the
    /// shape `run_turn` appends at turn start: `source: "prompt"`, the raw
    /// prompt in `line`, and no `kind` / `parsed`.
    #[test]
    fn prompt_persisted_entry_has_prompt_source_and_carries_text() {
        // Mirror the entry `run_turn` pushes for a turn's prompt.
        let entry = PersistedEntry {
            source: "prompt".to_string(),
            turn: 2,
            kind: None,
            parsed: None,
            line: "refactor the auth module".to_string(),
            ts: "2026-05-22T12:00:00+00:00".to_string(),
        };
        assert_eq!(entry.source, "prompt");
        assert_eq!(entry.line, "refactor the auth module");
        assert!(entry.kind.is_none(), "a prompt entry carries no kind");
        assert!(entry.parsed.is_none(), "a prompt entry carries no parsed event");
    }

    /// R4 — a `prompt` `PersistedEntry` round-trips through a `SessionRecord`'s
    /// transcript: a session persisted with a prompt entry, then read back from
    /// disk, still carries the typed prompt so a reopened session shows it.
    #[test]
    fn prompt_entry_round_trips_through_session_record() {
        let mut record = sample_record();
        // Append a turn-3 prompt entry, as `run_turn` does at turn start.
        record.transcript.push(PersistedEntry {
            source: "prompt".to_string(),
            turn: 3,
            kind: None,
            parsed: None,
            line: "and now write the changelog".to_string(),
            ts: "2026-05-22T13:00:00+00:00".to_string(),
        });

        let json = serde_json::to_string(&record).expect("SessionRecord serialises");
        let back: SessionRecord =
            serde_json::from_str(&json).expect("SessionRecord deserialises");

        let prompt = back
            .transcript
            .iter()
            .find(|e| e.source == "prompt")
            .expect("the prompt entry survives the round-trip");
        assert_eq!(prompt.turn, 3);
        assert_eq!(prompt.line, "and now write the changelog");
        assert_eq!(record, back, "round-trip must be lossless");
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
