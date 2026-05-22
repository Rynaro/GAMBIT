// session_store.rs — On-disk persistence for Eidolon sessions.
//
// GAMBIT v0.3.0's `SessionRegistry` (see `session.rs`) is 100% in-memory:
// nothing about a session survives an app restart, and the transcript dies
// even on a route change. This module is the v0.3.1 persistence layer — it
// gives every session a durable on-disk record.
//
// Store medium — Rust `std::fs` JSON under `app_data_dir`:
//
//   The bundled-CLI extractor (`extract.rs`) already writes into
//   `app.path().app_data_dir()` with `std::fs`. Tauri capabilities gate the
//   JS `fs` plugin, NOT Rust `std::fs` — so a Rust-side store needs no new
//   capability scope. This module reuses that exact pattern.
//
// Layout (under `app_data_dir/sessions/`):
//
//   sessions/index.json     — Vec<SessionSummary>, the lightweight list view.
//   sessions/<uuid>.json    — one full SessionRecord per session.
//
// The persistable counterpart of the live (non-serializable) `SessionHandle`
// is `SessionRecord`: `SessionHandle` mixes metadata with a live `Child`
// process, so persistence EXTRACTS the serializable metadata + transcript +
// cumulative usage into a `SessionRecord` at flush time. `session.rs` owns the
// flush hooks (`start_session` writes the initial record; `run_turn`'s
// wait-task tail flushes a full record per turn).
//
// Commands (one-shot, no events — modelled on `claude_auth_status`):
//
//   list_sessions(app)                → Result<Vec<SessionSummary>, String>
//   load_session(app, sessionId)      → Result<SessionRecord, String>
//   delete_session(app, sessionId)    → Result<(), String>
//
// All errors are `Result<T, String>` (project convention — no error enums,
// no `anyhow`/`thiserror`). Every IPC-crossing struct is
// `#[serde(rename_all = "camelCase")]` so the frontend (story S2) mirrors it.
//
// Partial-turn safety (R-PARTIAL-TURN): each `SessionRecord` carries a
// per-turn `Vec<TurnRecord { turn, result_seen }>`. A turn that exits WITHOUT
// a terminal `result` event still flushes with `result_seen: false` — story
// S2 reads that flag to offer a fresh continuation rather than restoring a
// half-written turn.

use crate::claude_adapter::Usage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------------------
// Persisted data shapes — all camelCase, all Serialize + Deserialize so they
// round-trip through `<uuid>.json` / `index.json` and the IPC boundary.
// ---------------------------------------------------------------------------

/// One transcript entry as Rust observed it on the `claude` NDJSON stream.
///
/// Mirrors what `run_turn` already emits as `session-event` / `session-stderr`
/// — Rust parses every line, so it is the natural transcript owner. The
/// frontend's `TranscriptEntry` (story S2) rehydrates directly from these, so
/// the field names are kept camelCase-serde-compatible with that shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEntry {
    /// `"event"` for a parsed stdout line, `"stderr"` for a stderr line.
    pub source: String,
    /// The 1-based turn this entry belongs to.
    pub turn: u32,
    /// Short `kind` discriminator (`init` / `assistant` / `result` / …) — set
    /// for `event` entries, `None` for `stderr` entries.
    #[serde(default)]
    pub kind: Option<String>,
    /// The typed `ParsedEvent` as JSON — set for `event` entries, `None` for
    /// `stderr`. Stored as a `Value` so this module never depends on the
    /// `ParsedEvent` enum shape evolving.
    #[serde(default)]
    pub parsed: Option<serde_json::Value>,
    /// The raw line, verbatim (the NDJSON line, or the stderr line).
    pub line: String,
    /// RFC-3339 timestamp the entry was observed at.
    pub ts: String,
}

/// Cumulative token usage summed across every turn of a session.
///
/// A turn-granular `Usage` lives on each `result` event (`claude_adapter`);
/// this is the running total `run_turn` accumulates and flushes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CumulativeUsage {
    /// Sum of per-turn `input_tokens`.
    #[serde(default)]
    pub input_tokens: u64,
    /// Sum of per-turn `output_tokens`.
    #[serde(default)]
    pub output_tokens: u64,
    /// Sum of per-turn `cache_creation_input_tokens`.
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    /// Sum of per-turn `cache_read_input_tokens`.
    #[serde(default)]
    pub cache_read_input_tokens: u64,
}

impl CumulativeUsage {
    /// Fold one turn's [`Usage`] into the running total. `None` token fields
    /// (the adapter's `Option<u64>`s) contribute zero.
    pub fn add(&mut self, usage: &Usage) {
        self.input_tokens += usage.input_tokens.unwrap_or(0);
        self.output_tokens += usage.output_tokens.unwrap_or(0);
        self.cache_creation_input_tokens += usage.cache_creation_input_tokens.unwrap_or(0);
        self.cache_read_input_tokens += usage.cache_read_input_tokens.unwrap_or(0);
    }
}

/// One per-turn finalisation record.
///
/// `result_seen` is the partial-turn-safety flag (R-PARTIAL-TURN): `true` iff
/// a terminal `result` event was observed for that turn. A turn that exited
/// on a bare process exit (crash / SIGKILL / dropped `result`) flushes with
/// `result_seen: false`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    /// The 1-based turn number.
    pub turn: u32,
    /// `true` iff a terminal `result` event was seen for this turn.
    pub result_seen: bool,
}

/// The full, durable record of one Eidolon session.
///
/// The serializable counterpart of the live `SessionHandle` — it carries the
/// metadata `SessionHandle` holds PLUS the transcript, cumulative usage/cost
/// and per-turn finalisation log that the live handle does not.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    // --- metadata -----------------------------------------------------------
    /// Host-generated UUID v4 — the session address (file is `<uuid>.json`).
    pub uuid: String,
    /// The Eidolon identity, or empty when `is_cortex`.
    pub eidolon_name: String,
    /// `true` for a cortex-routed default session. The field exists now; the
    /// cortex launch path itself is story S4.
    #[serde(default)]
    pub is_cortex: bool,
    /// Title — derived from the turn-1 prompt (first ~60 chars) or user-set.
    pub title: String,
    /// The pinned absolute working directory `claude` is spawned in.
    pub project_path: String,
    /// Value passed verbatim to `--permission-mode`.
    pub permission_mode: String,
    /// Resolved persona text — the Eidolon `agent.md`, or the cortex descriptor.
    pub append_system_prompt: String,
    /// Tool names joined into `--allowedTools`.
    pub allowed_tools: Vec<String>,
    /// Coarse status: `idle` / `running` / `ended` / `failed`.
    pub status: String,
    /// The serving model, captured from the `system/init` event (or `None`).
    #[serde(default)]
    pub model: Option<String>,
    /// R3 — the user-CHOSEN model, passed to `--model` on every turn. Distinct
    /// from [`SessionRecord::model`] (the OBSERVED model `claude` reports on
    /// `system/init`): this is the launch-time selection, persisted so a
    /// reopened session resumes on the same `--model`. `#[serde(default)]` for
    /// forward-compat with records written before R3.
    #[serde(default)]
    pub chosen_model: Option<String>,
    /// R3 — the reasoning effort level (`--effort`), persisted so a reopened
    /// session resumes on the same effort. `#[serde(default)]` for old records.
    #[serde(default)]
    pub thinking_effort: Option<String>,
    /// R3 — the fallback model alias (`--fallback-model`). `#[serde(default)]`
    /// for forward-compat with records written before R3.
    #[serde(default)]
    pub fallback_model: Option<String>,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
    /// RFC-3339 timestamp, bumped on every turn flush.
    pub last_active_at: String,

    // --- content ------------------------------------------------------------
    /// The full rendered transcript, append-only across turns.
    #[serde(default)]
    pub transcript: Vec<PersistedEntry>,
    /// Token usage summed across every turn.
    #[serde(default)]
    pub cumulative_usage: CumulativeUsage,
    /// Estimated cost in USD summed across every turn's `total_cost_usd`.
    #[serde(default)]
    pub cumulative_cost_usd: Option<f64>,
    /// Per-turn finalisation log — drives partial-turn-safe re-entry.
    #[serde(default)]
    pub per_turn: Vec<TurnRecord>,
}

impl SessionRecord {
    /// Project this record down to its lightweight [`SessionSummary`] — the
    /// shape stored in `index.json` and returned by `list_sessions`.
    pub fn summary(&self) -> SessionSummary {
        SessionSummary {
            uuid: self.uuid.clone(),
            eidolon_name: self.eidolon_name.clone(),
            is_cortex: self.is_cortex,
            title: self.title.clone(),
            project_path: self.project_path.clone(),
            status: self.status.clone(),
            model: self.model.clone(),
            chosen_model: self.chosen_model.clone(),
            thinking_effort: self.thinking_effort.clone(),
            created_at: self.created_at.clone(),
            last_active_at: self.last_active_at.clone(),
            cumulative_input_tokens: self.cumulative_usage.input_tokens,
            cumulative_output_tokens: self.cumulative_usage.output_tokens,
            cumulative_cost_usd: self.cumulative_cost_usd.unwrap_or(0.0),
        }
    }
}

/// The lightweight list-view shape — one entry per session in `index.json`.
///
/// Carries just enough to render a session list without loading the full
/// `SessionRecord` (transcripts can be large). `list_sessions` returns a
/// `Vec<SessionSummary>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    /// Host-generated UUID v4 — the session address.
    pub uuid: String,
    /// The Eidolon identity, or empty when `is_cortex`.
    pub eidolon_name: String,
    /// `true` for a cortex-routed default session.
    #[serde(default)]
    pub is_cortex: bool,
    /// Title — derived from the turn-1 prompt or user-set.
    pub title: String,
    /// The pinned absolute working directory `claude` was spawned in.
    ///
    /// Surfaced on the summary (story S3) so the composer-as-creator cwd
    /// resolution can default to the most-recently-active session's project
    /// without a `load_session` round trip.
    #[serde(default)]
    pub project_path: String,
    /// Coarse status: `idle` / `running` / `ended` / `failed`.
    pub status: String,
    /// The serving model, or `None` if not yet captured.
    #[serde(default)]
    pub model: Option<String>,
    /// R3 — the user-CHOSEN model (`--model`), surfaced on the summary so the
    /// session list can show the pinned model before the first `system/init`
    /// arrives. `#[serde(default)]` for forward-compat with old index entries.
    #[serde(default)]
    pub chosen_model: Option<String>,
    /// R3 — the reasoning effort level (`--effort`). `#[serde(default)]` for
    /// forward-compat with old index entries.
    #[serde(default)]
    pub thinking_effort: Option<String>,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
    /// RFC-3339 timestamp, bumped on every turn flush.
    pub last_active_at: String,
    /// Cumulative input tokens across all turns.
    #[serde(default)]
    pub cumulative_input_tokens: u64,
    /// Cumulative output tokens across all turns.
    #[serde(default)]
    pub cumulative_output_tokens: u64,
    /// Cumulative estimated cost in USD across all turns.
    #[serde(default)]
    pub cumulative_cost_usd: f64,
}

// ---------------------------------------------------------------------------
// Pure index helpers — unit-tested below; no I/O so they stay hermetic.
// ---------------------------------------------------------------------------

/// Upsert a session's summary into the index list, keyed by `uuid`.
///
/// If an entry with the same `uuid` already exists it is replaced in place
/// (so a per-turn flush refreshes the summary); otherwise the summary is
/// appended. Pure — the caller persists the result.
pub fn index_upsert(index: &mut Vec<SessionSummary>, summary: SessionSummary) {
    match index.iter_mut().find(|s| s.uuid == summary.uuid) {
        Some(existing) => *existing = summary,
        None => index.push(summary),
    }
}

/// Remove a session's summary from the index list by `uuid`.
///
/// Returns `true` iff an entry was removed. Pure — the caller persists.
pub fn index_remove(index: &mut Vec<SessionSummary>, uuid: &str) -> bool {
    let before = index.len();
    index.retain(|s| s.uuid != uuid);
    index.len() != before
}

/// Derive a session title from its turn-1 prompt.
///
/// Trims surrounding whitespace, collapses to the first line, and truncates
/// to ~60 characters (on a `char` boundary so multi-byte text is safe). An
/// empty prompt yields the placeholder `"Untitled session"`.
pub fn derive_title(first_prompt: &str) -> String {
    let first_line = first_prompt.trim().lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return "Untitled session".to_string();
    }
    let truncated: String = first_line.chars().take(60).collect();
    truncated
}

// ---------------------------------------------------------------------------
// Filesystem layer — resolves `app_data_dir/sessions/` and reads/writes JSON.
// ---------------------------------------------------------------------------

/// Resolve `app_data_dir/sessions/`, creating it if necessary.
///
/// Mirrors `extract.rs`: `app.path().app_data_dir()` + `fs::create_dir_all`.
/// Rust `std::fs` to `app_data_dir` is ungated — no Tauri capability needed.
pub fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app_data_dir: {e}"))?;
    let dir = app_data_dir.join("sessions");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Absolute path of one session's record file: `sessions/<uuid>.json`.
fn record_path(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    Ok(sessions_dir(app)?.join(format!("{session_id}.json")))
}

/// Absolute path of the index file: `sessions/index.json`.
fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sessions_dir(app)?.join("index.json"))
}

/// Write a [`SessionRecord`] to `sessions/<uuid>.json` (pretty JSON).
pub fn write_record(app: &AppHandle, record: &SessionRecord) -> Result<(), String> {
    let path = record_path(app, &record.uuid)?;
    let json = serde_json::to_string_pretty(record)
        .map_err(|e| format!("serialize SessionRecord {}: {e}", record.uuid))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Read a [`SessionRecord`] back from `sessions/<uuid>.json`.
pub fn read_record(app: &AppHandle, session_id: &str) -> Result<SessionRecord, String> {
    let path = record_path(app, session_id)?;
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

/// Read `sessions/index.json` — a missing or empty file yields an empty list
/// (a fresh install has no sessions yet, which is not an error).
pub fn read_index(app: &AppHandle) -> Result<Vec<SessionSummary>, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    if contents.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&contents)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

/// Write the index list back to `sessions/index.json` (pretty JSON).
fn write_index(app: &AppHandle, index: &[SessionSummary]) -> Result<(), String> {
    let path = index_path(app)?;
    let json = serde_json::to_string_pretty(index)
        .map_err(|e| format!("serialize session index: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

/// Persist a [`SessionRecord`] AND refresh its `index.json` entry in one call.
///
/// This is the single durable-flush primitive `session.rs` calls: from
/// `start_session` (the initial record + a new index entry) and from
/// `run_turn`'s wait-task tail (the full per-turn flush). The record file is
/// written first so the index never references a missing record.
pub fn persist_record(app: &AppHandle, record: &SessionRecord) -> Result<(), String> {
    write_record(app, record)?;
    let mut index = read_index(app)?;
    index_upsert(&mut index, record.summary());
    write_index(app, &index)
}

/// Remove a session's record file and its `index.json` entry.
///
/// A missing record file is tolerated (the index entry is still cleared) so
/// `delete_session` is idempotent.
pub fn remove_record(app: &AppHandle, session_id: &str) -> Result<(), String> {
    let path = record_path(app, session_id)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    let mut index = read_index(app)?;
    index_remove(&mut index, session_id);
    write_index(app, &index)
}

// ---------------------------------------------------------------------------
// Commands — one-shot, no events. Shape template = `claude_auth_status`.
// ---------------------------------------------------------------------------

/// Tauri command: list every persisted session as a lightweight summary.
///
/// Reads `app_data_dir/sessions/index.json`. A fresh install (no index file)
/// returns an empty `Vec` — not an error. Used by story S2 to populate the
/// session rail on `useSessions` mount.
#[tauri::command]
pub async fn list_sessions(app: AppHandle) -> Result<Vec<SessionSummary>, String> {
    read_index(&app)
}

/// Tauri command: load one session's full [`SessionRecord`] from disk.
///
/// Reads `sessions/<sessionId>.json`. Used by story S2 to rehydrate a
/// session's detail view (transcript included).
#[tauri::command]
pub async fn load_session(app: AppHandle, session_id: String) -> Result<SessionRecord, String> {
    read_record(&app, &session_id)
}

/// Tauri command: delete one session — its record file and its index entry.
///
/// Idempotent: a missing record file is not an error.
#[tauri::command]
pub async fn delete_session(app: AppHandle, session_id: String) -> Result<(), String> {
    remove_record(&app, &session_id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Hermetic: no `AppHandle`, no real `app_data_dir`, no filesystem — we
// exercise the serde round-trips and the pure index/title helpers. The
// `persist_record` / `read_index` filesystem layer is thin (`serde_json` +
// `std::fs`) and is covered indirectly by these serde tests plus the
// integration `make ci` pass. `tempfile` is not a dependency, so the I/O
// helpers are not unit-tested directly. Pattern matches session.rs /
// claude_adapter.rs / binary.rs.

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry(turn: u32) -> PersistedEntry {
        PersistedEntry {
            source: "event".to_string(),
            turn,
            kind: Some("assistant".to_string()),
            parsed: Some(serde_json::json!({ "Assistant": { "content": [] } })),
            line: r#"{"type":"assistant"}"#.to_string(),
            ts: "2026-05-22T12:00:00+00:00".to_string(),
        }
    }

    fn sample_record() -> SessionRecord {
        SessionRecord {
            uuid: "11111111-1111-1111-1111-111111111111".to_string(),
            eidolon_name: "Sage".to_string(),
            is_cortex: false,
            title: "Refactor the auth module".to_string(),
            project_path: "/tmp/project".to_string(),
            permission_mode: "default".to_string(),
            append_system_prompt: "You are Sage.".to_string(),
            allowed_tools: vec!["Read".to_string(), "Edit".to_string()],
            status: "idle".to_string(),
            model: Some("claude-opus-4-7".to_string()),
            chosen_model: Some("opus".to_string()),
            thinking_effort: Some("high".to_string()),
            fallback_model: Some("sonnet".to_string()),
            created_at: "2026-05-22T12:00:00+00:00".to_string(),
            last_active_at: "2026-05-22T12:05:00+00:00".to_string(),
            transcript: vec![sample_entry(1)],
            cumulative_usage: CumulativeUsage {
                input_tokens: 1500,
                output_tokens: 300,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 200,
            },
            cumulative_cost_usd: Some(0.0123),
            per_turn: vec![TurnRecord {
                turn: 1,
                result_seen: true,
            }],
        }
    }

    /// A `SessionRecord` round-trips losslessly through JSON.
    #[test]
    fn session_record_json_roundtrip() {
        let record = sample_record();
        let json = serde_json::to_string(&record).expect("SessionRecord serialises");
        let back: SessionRecord =
            serde_json::from_str(&json).expect("SessionRecord deserialises");
        assert_eq!(record, back, "round-trip must be lossless");
    }

    /// `SessionRecord` serialises with camelCase keys — the IPC contract the
    /// frontend (story S2) mirrors. snake_case keys must NOT leak.
    #[test]
    fn session_record_camelcase_serialization() {
        let json = serde_json::to_value(sample_record()).expect("serialises");
        for key in [
            "uuid",
            "eidolonName",
            "isCortex",
            "title",
            "projectPath",
            "permissionMode",
            "appendSystemPrompt",
            "allowedTools",
            "status",
            "model",
            "chosenModel",
            "thinkingEffort",
            "fallbackModel",
            "createdAt",
            "lastActiveAt",
            "transcript",
            "cumulativeUsage",
            "cumulativeCostUsd",
            "perTurn",
        ] {
            assert!(json.get(key).is_some(), "missing camelCase key `{key}`");
        }
        // snake_case must not leak through the IPC contract.
        assert!(json.get("eidolon_name").is_none());
        assert!(json.get("project_path").is_none());
        assert!(json.get("per_turn").is_none());
    }

    /// `PersistedEntry` round-trips and serialises with camelCase keys.
    #[test]
    fn persisted_entry_roundtrip_and_camelcase() {
        let entry = sample_entry(2);
        let json = serde_json::to_value(&entry).expect("serialises");
        assert!(json.get("source").is_some());
        assert!(json.get("turn").is_some());
        assert!(json.get("kind").is_some());
        assert!(json.get("parsed").is_some());
        assert!(json.get("line").is_some());
        assert!(json.get("ts").is_some());

        let back: PersistedEntry =
            serde_json::from_value(json).expect("PersistedEntry deserialises");
        assert_eq!(entry, back);
    }

    /// A `stderr` entry has no `kind` / `parsed` — `None` round-trips cleanly.
    #[test]
    fn persisted_entry_stderr_has_no_kind_or_parsed() {
        let entry = PersistedEntry {
            source: "stderr".to_string(),
            turn: 1,
            kind: None,
            parsed: None,
            line: "a warning line".to_string(),
            ts: "2026-05-22T12:00:00+00:00".to_string(),
        };
        let json = serde_json::to_string(&entry).expect("serialises");
        let back: PersistedEntry = serde_json::from_str(&json).expect("deserialises");
        assert_eq!(entry, back);
        assert!(back.kind.is_none());
        assert!(back.parsed.is_none());
    }

    /// `SessionSummary` serialises with camelCase keys and round-trips.
    #[test]
    fn session_summary_camelcase_and_roundtrip() {
        let summary = sample_record().summary();
        let json = serde_json::to_value(&summary).expect("serialises");
        for key in [
            "uuid",
            "eidolonName",
            "isCortex",
            "title",
            "projectPath",
            "status",
            "model",
            "chosenModel",
            "thinkingEffort",
            "createdAt",
            "lastActiveAt",
            "cumulativeInputTokens",
            "cumulativeOutputTokens",
            "cumulativeCostUsd",
        ] {
            assert!(json.get(key).is_some(), "missing camelCase key `{key}`");
        }
        assert!(json.get("last_active_at").is_none());

        let back: SessionSummary =
            serde_json::from_value(json).expect("SessionSummary deserialises");
        assert_eq!(summary, back);
    }

    /// `SessionRecord::summary` projects the record's metadata + cumulative
    /// figures down to the list-view shape.
    #[test]
    fn summary_projects_record_metadata() {
        let record = sample_record();
        let summary = record.summary();
        assert_eq!(summary.uuid, record.uuid);
        assert_eq!(summary.eidolon_name, record.eidolon_name);
        assert_eq!(summary.title, record.title);
        assert_eq!(summary.project_path, record.project_path);
        assert_eq!(summary.status, record.status);
        assert_eq!(summary.model, record.model);
        assert_eq!(summary.cumulative_input_tokens, 1500);
        assert_eq!(summary.cumulative_output_tokens, 300);
        assert_eq!(summary.cumulative_cost_usd, 0.0123);
    }

    /// `index_upsert` appends a never-seen session and replaces an existing
    /// one in place — a per-turn flush refreshes the summary without growing
    /// the index.
    #[test]
    fn index_upsert_appends_then_replaces() {
        let mut index: Vec<SessionSummary> = Vec::new();
        let mut summary = sample_record().summary();

        // First upsert appends.
        index_upsert(&mut index, summary.clone());
        assert_eq!(index.len(), 1);
        assert_eq!(index[0].status, "idle");

        // A second upsert with the same uuid replaces in place.
        summary.status = "running".to_string();
        index_upsert(&mut index, summary.clone());
        assert_eq!(index.len(), 1, "same uuid must not duplicate");
        assert_eq!(index[0].status, "running", "summary refreshed in place");

        // A different uuid appends.
        let mut other = summary.clone();
        other.uuid = "22222222-2222-2222-2222-222222222222".to_string();
        index_upsert(&mut index, other);
        assert_eq!(index.len(), 2);
    }

    /// `index_remove` drops the matching entry and reports whether it removed
    /// anything — an unknown uuid is a harmless no-op.
    #[test]
    fn index_remove_drops_matching_entry() {
        let mut index: Vec<SessionSummary> = Vec::new();
        let summary = sample_record().summary();
        index_upsert(&mut index, summary.clone());
        assert_eq!(index.len(), 1);

        // Removing an unknown uuid changes nothing.
        assert!(!index_remove(&mut index, "no-such-uuid"));
        assert_eq!(index.len(), 1);

        // Removing the real uuid drops it.
        assert!(index_remove(&mut index, &summary.uuid));
        assert!(index.is_empty());
    }

    /// `CumulativeUsage::add` folds a per-turn `Usage` into the running total;
    /// `None` token fields contribute zero.
    #[test]
    fn cumulative_usage_accumulates_across_turns() {
        let mut total = CumulativeUsage::default();
        total.add(&Usage {
            input_tokens: Some(100),
            output_tokens: Some(20),
            cache_creation_input_tokens: Some(5),
            cache_read_input_tokens: None,
        });
        total.add(&Usage {
            input_tokens: Some(200),
            output_tokens: None,
            cache_creation_input_tokens: None,
            cache_read_input_tokens: Some(40),
        });
        assert_eq!(total.input_tokens, 300);
        assert_eq!(total.output_tokens, 20);
        assert_eq!(total.cache_creation_input_tokens, 5);
        assert_eq!(total.cache_read_input_tokens, 40);
    }

    /// `derive_title` trims, takes the first line, and truncates to 60 chars.
    #[test]
    fn derive_title_trims_truncates_and_handles_empty() {
        assert_eq!(derive_title("  Refactor the auth module  "), "Refactor the auth module");
        // First line only.
        assert_eq!(derive_title("First line\nSecond line"), "First line");
        // Truncated to 60 chars.
        let long = "x".repeat(200);
        assert_eq!(derive_title(&long).chars().count(), 60);
        // Empty / whitespace-only → placeholder.
        assert_eq!(derive_title(""), "Untitled session");
        assert_eq!(derive_title("   \n  "), "Untitled session");
    }

    /// `derive_title` truncates on a `char` boundary — multi-byte text is safe.
    #[test]
    fn derive_title_truncates_on_char_boundary() {
        let multibyte = "é".repeat(100);
        let title = derive_title(&multibyte);
        assert_eq!(title.chars().count(), 60);
    }

    /// A `SessionRecord` with a partial (un-finalised) turn carries
    /// `result_seen: false` — the R-PARTIAL-TURN safety signal.
    #[test]
    fn partial_turn_record_has_result_seen_false() {
        let mut record = sample_record();
        record.per_turn.push(TurnRecord {
            turn: 2,
            result_seen: false,
        });
        let json = serde_json::to_string(&record).expect("serialises");
        let back: SessionRecord = serde_json::from_str(&json).expect("deserialises");
        let partial = back.per_turn.iter().find(|t| t.turn == 2).unwrap();
        assert!(
            !partial.result_seen,
            "a turn that never saw a result must persist result_seen=false"
        );
    }

    /// A `SessionRecord` JSON written by an older build that omits the
    /// `#[serde(default)]` fields still deserialises (forward-compat).
    #[test]
    fn session_record_deserialises_with_defaulted_fields_absent() {
        let minimal = serde_json::json!({
            "uuid": "33333333-3333-3333-3333-333333333333",
            "eidolonName": "Sage",
            "title": "minimal",
            "projectPath": "/tmp/p",
            "permissionMode": "default",
            "appendSystemPrompt": "persona",
            "allowedTools": [],
            "status": "idle",
            "createdAt": "2026-05-22T12:00:00+00:00",
            "lastActiveAt": "2026-05-22T12:00:00+00:00"
        });
        let record: SessionRecord =
            serde_json::from_value(minimal).expect("minimal record deserialises");
        assert!(!record.is_cortex);
        assert!(record.transcript.is_empty());
        assert!(record.per_turn.is_empty());
        assert_eq!(record.cumulative_usage, CumulativeUsage::default());
        assert!(record.model.is_none());
        // R3 — the new fields default to `None` on a pre-R3 record.
        assert!(record.chosen_model.is_none());
        assert!(record.thinking_effort.is_none());
        assert!(record.fallback_model.is_none());
    }

    /// R3 — the user-chosen `model` / `thinkingEffort` / `fallbackModel`
    /// round-trip through a `SessionRecord` and project onto the summary, so a
    /// reopened session resumes on the same `--model` / `--effort`.
    #[test]
    fn r3_chosen_model_and_effort_round_trip_and_project_to_summary() {
        let record = sample_record();
        assert_eq!(record.chosen_model.as_deref(), Some("opus"));
        assert_eq!(record.thinking_effort.as_deref(), Some("high"));
        assert_eq!(record.fallback_model.as_deref(), Some("sonnet"));

        let json = serde_json::to_string(&record).expect("serialises");
        let back: SessionRecord = serde_json::from_str(&json).expect("deserialises");
        assert_eq!(record, back, "R3 fields round-trip losslessly");

        let summary = record.summary();
        assert_eq!(summary.chosen_model.as_deref(), Some("opus"));
        assert_eq!(summary.thinking_effort.as_deref(), Some("high"));
    }
}
