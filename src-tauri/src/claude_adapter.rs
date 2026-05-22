// claude_adapter.rs — `claude` CLI adapter: flag construction + NDJSON parsing.
//
// GAMBIT v0.3 ("Eidolon Sessions") drives the `claude` CLI headlessly:
//
//   claude -p --output-format stream-json --verbose --include-partial-messages
//
// over piped stdio. The CLI emits one JSON object per line ("stream-json"
// NDJSON); the Rust backend parses those lines itself with `serde_json`
// (already a dependency) — no SDK, no PTY.
//
// This module is the single host-tool seam and has exactly two jobs:
//
//   (a) build_args — a pure function turning a turn's parameters into the
//       `claude` argument vector. Stateless per-turn: turn 1 spawns with
//       `--session-id <uuid>`, later turns with `--resume <uuid>`.
//
//   (b) parse_line — turn one NDJSON output line into a typed `ParsedEvent`.
//       It is deliberately permissive (newer `claude` output must not break
//       parsing) and NEVER panics: a bad line yields `Unknown`/`Malformed`.
//
// A future `session.rs` (story S4 — NOT built here) spawns `claude` via
// `spawn_core` and renders the events this module produces. A future
// `CursorAdapter` would mirror this same two-function shape.
//
// The Eidolon persona is injected via `--append-system-prompt` (a STRING the
// caller supplies — this module never reads files). `--bare` is NEVER passed:
// it strips auth + skill discovery.
//
// GAP-2: flag names below were cross-checked against `claude --help` of the
// `claude` binary on PATH at authoring time (`-p`, `--output-format`,
// `--verbose`, `--include-partial-messages`, `--append-system-prompt`,
// `--allowedTools`, `--permission-mode`, `--session-id`, `--resume`). They
// should be reconciled again against the installed `claude` during S4 manual
// smoke, since the CLI surface can drift between releases.

#![allow(dead_code)] // wired up by S4 (session.rs)

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// (a) Flag construction
// ---------------------------------------------------------------------------

/// Whether a turn opens a fresh session or resumes an existing one.
///
/// Drives the single mutually-exclusive flag pair in [`build_args`]:
/// `First` → `--session-id <uuid>`, `Resumed` → `--resume <uuid>`,
/// `Fork` → `--resume <orig> --session-id <new> --fork-session`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnKind {
    /// The first turn of a conversation — opens the session.
    First,
    /// A later turn — resumes the existing session.
    Resumed,
    /// P8 — the first turn of a FORKED session: resume an existing
    /// conversation but write to a NEW session id, leaving the original
    /// untouched. See [`TurnArgs::fork_from`].
    Fork,
}

/// All inputs `build_args` needs to assemble a `claude` argument vector.
///
/// Borrowed (`&str`) rather than owned: the caller (S4's `session.rs`) owns
/// the prompt, persona text and session UUID for the lifetime of the spawn.
/// The session id is a `&str` on purpose — the `uuid` crate is not yet a
/// dependency, and adding it is S4's concern, not S2's.
#[derive(Debug, Clone)]
pub struct TurnArgs<'a> {
    /// The user's prompt for this turn (the trailing positional argument).
    pub prompt: &'a str,
    /// The Eidolon persona text, passed verbatim to `--append-system-prompt`.
    /// Supplied by the caller as a string — this module never reads files.
    pub append_system_prompt: &'a str,
    /// Tool names the Eidolon's `agent.md` allows. Joined comma-separated
    /// into the single `--allowedTools` value.
    pub allowed_tools: &'a [String],
    /// Value for `--permission-mode` (e.g. `"default"`, `"acceptEdits"`,
    /// `"plan"`). Passed through verbatim; validation is the caller's job.
    pub permission_mode: &'a str,
    /// The session UUID — `--session-id` on a first turn, `--resume` on a
    /// resumed turn. A `&str`; the adapter does not depend on `uuid`.
    ///
    /// P8: on a [`TurnKind::Fork`] turn this is the NEW (forked) session's id,
    /// passed to `--session-id` — GAMBIT keeps owning the id. The conversation
    /// to seed from is given separately in [`TurnArgs::fork_from`].
    pub session_id: &'a str,
    /// Whether this is the first turn, a resumed turn, or a fork's first turn.
    pub turn_kind: TurnKind,
    /// R3 — the model serving the session, passed to `--model`. Accepts a
    /// short alias (`opus` / `sonnet` / `haiku` / `opusplan` / `default`, plus
    /// the `[1m]` variants) or a full model id. `None` omits the flag entirely
    /// so `claude` applies its own default.
    pub model: Option<&'a str>,
    /// R3 — the reasoning effort level, passed to `--effort` (`low` / `medium`
    /// / `high` / `xhigh` / `max`). Supported levels vary per model; an
    /// unsupported level is auto-downgraded CLI-side. `None` omits the flag.
    pub thinking_effort: Option<&'a str>,
    /// R3 — the fallback model alias, passed to `--fallback-model` — `claude`
    /// auto-downgrades to it when the primary model is overloaded (honored in
    /// `-p` mode). `None` omits the flag.
    pub fallback_model: Option<&'a str>,
    /// P8 — the ORIGINAL session id to fork from. Set ONLY on a
    /// [`TurnKind::Fork`] turn (the fork's first turn): it is the id passed to
    /// `--resume`, while [`TurnArgs::session_id`] is the NEW forked id passed to
    /// `--session-id`, and `--fork-session` is added so claude-code accepts the
    /// combination and writes the resumed conversation under the new id.
    ///
    /// `None` for every `First` / `Resumed` turn — and for those `turn_kind`s
    /// it is ignored even if set. After a fork's first turn, follow-up turns on
    /// the new session are ordinary `Resumed` turns with `fork_from: None`.
    pub fork_from: Option<&'a str>,
}

/// The fixed `--settings` JSON payload — R3.
///
/// `showThinkingSummaries` is enabled so Opus 4.7 streams `thinking` blocks
/// with NON-EMPTY content: without it the `thinking` blocks arrive blank and
/// the cozy `ThinkingBlock` would render nothing. A fixed string is enough —
/// GAMBIT carries no other host-side `claude` settings.
const SETTINGS_JSON: &str = r#"{"showThinkingSummaries":true}"#;

/// Build the `claude` argument vector for one turn.
///
/// Pure: no I/O, no spawning — it only assembles a `Vec<String>`. The result
/// is meant to be fed to `spawn_core::piped_command(...).args(build_args(&a))`
/// by S4's `session.rs`.
///
/// The vector always contains, in order:
///   `-p`, `--output-format stream-json`, `--verbose`,
///   `--include-partial-messages`, `--settings <json>`,
///   `--append-system-prompt <text>`, `--allowedTools <comma-separated>`,
///   `--permission-mode <mode>`, optionally `--model <v>` / `--effort <v>` /
///   `--fallback-model <v>` (each only when its `TurnArgs` field is `Some`),
///   then the session flags depending on `turn_kind`:
///     * `First`   → `--session-id <uuid>`
///     * `Resumed` → `--resume <uuid>`
///     * `Fork`    → `--resume <fork_from> --session-id <uuid> --fork-session`
///   and finally the prompt as the trailing positional argument.
///
/// P8: the `Fork` arm uses `--fork-session` so claude-code seeds a NEW session
/// (`--session-id <uuid>`) from a copy of an existing conversation
/// (`--resume <fork_from>`), leaving the original untouched. The CLI requires
/// `--fork-session` for the `--session-id` + `--resume` combination — without
/// it `claude` rejects the pair (`--session-id can only be used with
/// --resume ... if --fork-session is also specified`). GAMBIT therefore keeps
/// owning the id: the new session id is host-generated, never CLI-minted.
///
/// It NEVER contains `--bare` (that flag strips auth + skill discovery).
pub fn build_args(args: &TurnArgs<'_>) -> Vec<String> {
    let mut v: Vec<String> = Vec::with_capacity(24);

    // Headless streaming transport.
    v.push("-p".to_string());
    v.push("--output-format".to_string());
    v.push("stream-json".to_string());
    // `--verbose` + `--include-partial-messages` are required for the
    // stream-json NDJSON to carry init/partial events the cozy UI renders.
    v.push("--verbose".to_string());
    v.push("--include-partial-messages".to_string());

    // R3 — always pass `--settings` with `showThinkingSummaries: true` so the
    // `thinking` content blocks Opus 4.7 streams carry real reasoning text
    // (without it they arrive empty and the cozy ThinkingBlock renders blank).
    v.push("--settings".to_string());
    v.push(SETTINGS_JSON.to_string());

    // Eidolon persona — a verbatim string supplied by the caller.
    v.push("--append-system-prompt".to_string());
    v.push(args.append_system_prompt.to_string());

    // Allowed tools — one comma-separated value (the CLI also accepts
    // space-separated, but a single joined value is unambiguous).
    v.push("--allowedTools".to_string());
    v.push(args.allowed_tools.join(","));

    // Permission mode — passed through verbatim.
    v.push("--permission-mode".to_string());
    v.push(args.permission_mode.to_string());

    // R3 — optional model / effort / fallback-model. Each flag is appended
    // ONLY when its `TurnArgs` field is `Some`; a `None` omits the flag
    // entirely so `claude` applies its own default rather than receiving an
    // empty value. The model/effort are session-scoped: `send_turn` rebuilds
    // `TurnArgs` from the `SessionHandle` so they survive every `--resume`.
    if let Some(model) = args.model {
        v.push("--model".to_string());
        v.push(model.to_string());
    }
    if let Some(effort) = args.thinking_effort {
        v.push("--effort".to_string());
        v.push(effort.to_string());
    }
    if let Some(fallback) = args.fallback_model {
        v.push("--fallback-model".to_string());
        v.push(fallback.to_string());
    }

    // The session flags, depending on the turn kind.
    match args.turn_kind {
        TurnKind::First => {
            v.push("--session-id".to_string());
            v.push(args.session_id.to_string());
        }
        TurnKind::Resumed => {
            v.push("--resume".to_string());
            v.push(args.session_id.to_string());
        }
        TurnKind::Fork => {
            // P8 — fork: resume the ORIGINAL conversation (`fork_from`) but
            // write it under the NEW host-generated id (`session_id`).
            // `--fork-session` is mandatory for the CLI to accept the
            // `--resume` + `--session-id` pair. If `fork_from` is somehow
            // absent (a caller bug — `Fork` always carries it) we fall back to
            // resuming the new id, which is harmless and keeps `build_args`
            // total (it never panics on a missing field).
            if let Some(origin) = args.fork_from {
                v.push("--resume".to_string());
                v.push(origin.to_string());
            }
            v.push("--session-id".to_string());
            v.push(args.session_id.to_string());
            v.push("--fork-session".to_string());
        }
    }

    // The prompt is the trailing positional argument.
    v.push(args.prompt.to_string());

    // NOTE: `--bare` is intentionally never pushed — see module header.
    v
}

// ---------------------------------------------------------------------------
// (b) NDJSON parsing — permissive serde structs
// ---------------------------------------------------------------------------
//
// Every struct below uses `#[serde(default)]` and optional fields so that
// newer `claude` output (extra/renamed nested fields) deserialises without
// error. We model only what a "cozy" UI needs; the rest rides in the
// catch-all `Unknown` variant. `parse_line` never returns an `Err` and never
// unwraps — a malformed or unrecognised line is data, not a failure.

/// A single content block inside an `assistant` or `user` message.
///
/// `claude` content blocks are tagged by `type`: `text`, `tool_use`,
/// `thinking`, `tool_result`, plus others we do not model. All fields are
/// optional so any block kind deserialises; the `block_type` discriminator
/// tells the UI which fields to read.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
// Split rename: deserialise from `claude`'s snake_case wire, serialise to the
// frontend as camelCase. The TS `ContentBlock` mirror reads `blockType` /
// `toolUseId` / `isError` — a plain `rename_all = "camelCase"` would also flip
// deserialisation and break parsing `claude`'s `tool_use_id` / `is_error`.
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ContentBlock {
    /// The block kind: `"text"`, `"tool_use"`, `"thinking"`, `"tool_result"`,
    /// or anything newer. Deserialised from `claude`'s `type`; serialised to
    /// the frontend as `blockType` (via the struct's split rename_all).
    #[serde(default, rename(deserialize = "type"))]
    pub block_type: String,
    /// Text payload — present on `text` blocks.
    #[serde(default)]
    pub text: Option<String>,
    /// Reasoning payload — present on `thinking` blocks.
    #[serde(default)]
    pub thinking: Option<String>,
    /// Tool name — present on `tool_use` blocks.
    #[serde(default)]
    pub name: Option<String>,
    /// Block id — present on `tool_use` blocks (`id`) so `tool_result`
    /// blocks can be correlated.
    #[serde(default)]
    pub id: Option<String>,
    /// Tool-use id a `tool_result` block refers back to.
    #[serde(default)]
    pub tool_use_id: Option<String>,
    /// Tool input — present on `tool_use` blocks; shape varies per tool.
    #[serde(default)]
    pub input: Option<serde_json::Value>,
    /// Tool-result content — present on `tool_result` blocks; the CLI emits
    /// either a string or an array of nested blocks, so it stays a `Value`.
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    /// Whether a `tool_result` block represents an error.
    #[serde(default)]
    pub is_error: Option<bool>,
}

/// Token-usage accounting carried on the terminal `result` event.
///
/// Deserialised from `claude`'s snake_case wire; serialised to the frontend as
/// camelCase (`inputTokens`, …) to match the TS `Usage` mirror.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct Usage {
    /// Input tokens billed for the turn.
    #[serde(default)]
    pub input_tokens: Option<u64>,
    /// Output tokens billed for the turn.
    #[serde(default)]
    pub output_tokens: Option<u64>,
    /// Tokens that created new cache entries.
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    /// Tokens served from cache.
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}

/// A single permission denial carried on the terminal `result` event.
///
/// S0 — when a claude-code turn requests a tool that is not pre-approved,
/// headless mode silently denies the call: the turn still finishes, but the
/// requested work never happened. claude-code reports each such block in the
/// `result` event's `permission_denials` array; GAMBIT surfaces it on the
/// result card so the denial is not invisible.
///
/// Deserialised from claude's snake_case wire (`tool_name` / `tool_use_id` /
/// `tool_input`); serialised to the frontend as camelCase (`toolName` /
/// `toolUseId` / `toolInput`) to match the TS `PermissionDenial` mirror — the
/// same split `rename_all` the v0.3.6 `ContentBlock` fix established.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct PermissionDenial {
    /// The name of the tool whose call was denied (e.g. `"Write"`, `"Bash"`).
    #[serde(default)]
    pub tool_name: String,
    /// The `tool_use` id of the denied call.
    #[serde(default)]
    pub tool_use_id: String,
    /// The tool input the denied call would have run — shape varies per tool.
    #[serde(default)]
    pub tool_input: serde_json::Value,
}

/// The cozy delta pre-extracted from a `stream_event`'s inner `event` (story
/// S6/S7).
///
/// `claude --include-partial-messages` emits Anthropic SSE-shaped inner events
/// (`message_start`, `content_block_start`, `content_block_delta`,
/// `message_delta`, …). [`extract_stream_delta`] recognises only the four the
/// cozy UI needs and folds them into this enum; every other inner shape — and
/// every malformed one — yields `None` so the event is a safe no-op.
///
/// `parent_tool_use_id` is carried alongside (on [`StreamEvent`]'s extraction)
/// rather than inside each variant: a non-null value means the inner event
/// originated from a self-routed subagent, which the UI renders nested.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum StreamDelta {
    /// `content_block_delta` with `delta.type == "text_delta"` — an
    /// incremental assistant-text fragment.
    Text {
        /// The text fragment to append to the in-flight assistant block.
        text: String,
    },
    /// `content_block_delta` with `delta.type == "input_json_delta"` — an
    /// incremental fragment of a `tool_use` block's JSON input.
    ToolInput {
        /// The content block's index within the message (the `tool_use` id is
        /// only on the paired `content_block_start`, so the index correlates).
        index: u64,
        /// The `partial_json` fragment — concatenate across deltas to rebuild
        /// the tool input.
        partial_json: String,
    },
    /// `content_block_start` with `content_block.type == "tool_use"` — a tool
    /// call is beginning; the UI shows a live "running" chip from here.
    ToolStart {
        /// The content block's index within the message.
        index: u64,
        /// The tool-use id (`tool_use.id`) — pairs with the eventual
        /// `tool_result.tool_use_id`.
        tool_use_id: String,
        /// The tool name.
        tool_name: String,
    },
    /// `message_start` / `message_delta` — incremental token usage (story S7's
    /// live mid-turn context-gauge feed).
    Usage {
        /// The incremental usage block carried on the inner event.
        usage: Usage,
    },
}

/// The result of extracting a cozy delta from a `stream_event` inner `event`.
///
/// Pairs the optional [`StreamDelta`] with the inner event's top-level
/// `parent_tool_use_id`: a non-null id means the inner event came from a
/// self-routed subagent, so the UI renders the activity nested.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamDeltaExtraction {
    /// The recognised cozy delta, or `None` for an unmodelled inner shape.
    pub delta: Option<StreamDelta>,
    /// The inner event's `parent_tool_use_id`, when non-null — a subagent marker.
    pub parent_tool_use_id: Option<String>,
}

/// The typed taxonomy of `claude` stream-json NDJSON lines.
///
/// Covers what a cozy session UI needs; anything unrecognised falls through
/// to [`ParsedEvent::Unknown`] (unknown `type`) or [`ParsedEvent::Malformed`]
/// (not valid JSON). `parse_line` is total — it always returns one of these.
// `rename_all_fields` camelCases every struct-variant field on serialise
// (`session_id` -> `sessionId`, `total_cost_usd` -> `totalCostUsd`,
// `permission_denials` -> `permissionDenials`, `parent_tool_use_id` -> …) so
// the `session-event` payload's `parsed` object matches the camelCase TS
// mirrors. The variant names (`Init`/`Result`/…) are deliberately NOT renamed —
// they are the externally-tagged keys the frontend switches on (`parsed.Result`).
// Without this, the multi-word fields shipped snake_case and the UI read
// `undefined` (ResultCard cost/turns/duration, the S0 denial notice).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all_fields = "camelCase")]
pub enum ParsedEvent {
    /// `type: "system", subtype: "init"` — the session handshake.
    Init {
        /// The session UUID `claude` assigned (or echoed back).
        session_id: Option<String>,
        /// The model serving the session.
        model: Option<String>,
        /// Tool names available for the session.
        tools: Vec<String>,
    },
    /// `type: "system", subtype: "api_retry"` — a transient API retry notice.
    ApiRetry {
        /// Human-readable retry detail, if the line carried one.
        message: Option<String>,
    },
    /// `type: "assistant"` — an assistant message and its content blocks
    /// (`text` / `tool_use` / `thinking`).
    Assistant {
        /// Content blocks of the assistant message.
        content: Vec<ContentBlock>,
    },
    /// `type: "user"` — a user message, typically carrying `tool_result`
    /// blocks fed back into the conversation.
    User {
        /// Content blocks of the user message.
        content: Vec<ContentBlock>,
    },
    /// `type: "stream_event"` — a partial-message delta (only present with
    /// `--include-partial-messages`).
    ///
    /// Story S6/S7 stops treating the inner `event` as fully opaque: the raw
    /// `event` still rides along verbatim (so nothing is lost), but the cozy
    /// deltas the UI needs are pre-extracted into [`StreamDelta`]. The
    /// extraction is permissive — an unrecognised inner shape yields
    /// `delta = None` and the event degrades to a harmless no-op, never an
    /// error (see [`extract_stream_delta`]).
    StreamEvent {
        /// The raw `event` payload, verbatim — kept for forward-compat / the
        /// raw NDJSON toggle.
        event: Option<serde_json::Value>,
        /// The pre-extracted cozy delta, when the inner shape is one we model
        /// (text fragment / tool input fragment / tool start / usage). `None`
        /// for an unmodelled inner shape — the caller emits nothing.
        delta: Option<StreamDelta>,
        /// The inner event's top-level `parent_tool_use_id`, when non-null — a
        /// self-routed-subagent marker the UI renders nested.
        parent_tool_use_id: Option<String>,
    },
    /// `type: "result"` — the terminal event ending a turn.
    Result {
        /// Result subtype, e.g. `"success"` or `"error_max_turns"`.
        subtype: Option<String>,
        /// The final result text, when the turn produced one.
        result: Option<String>,
        /// The session UUID — useful to capture for the next turn's resume.
        session_id: Option<String>,
        /// Whether the turn ended in an error state.
        is_error: bool,
        /// Number of model turns the request consumed.
        num_turns: Option<u64>,
        /// Wall-clock duration of the turn in milliseconds.
        duration_ms: Option<u64>,
        /// Total billed cost of the turn in USD.
        total_cost_usd: Option<f64>,
        /// Token-usage accounting for the turn.
        usage: Usage,
        /// S0 — tool calls claude-code silently denied during the turn (a tool
        /// not pre-approved in headless mode). Empty when nothing was denied.
        permission_denials: Vec<PermissionDenial>,
    },
    /// A syntactically valid JSON line whose `type` we do not model — carries
    /// the raw line so nothing is silently dropped.
    Unknown {
        /// The raw NDJSON line, verbatim.
        raw: String,
    },
    /// A line that is not valid JSON at all — carries the raw line.
    Malformed {
        /// The raw line, verbatim.
        raw: String,
    },
}

// --- Permissive deserialisation targets -----------------------------------

/// Envelope just for sniffing the top-level `type` (and `subtype`) so we can
/// route to the right per-kind struct.
#[derive(Debug, Default, Deserialize)]
struct Envelope {
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    subtype: String,
}

/// Permissive shape for `system` lines (`init` and `api_retry`).
#[derive(Debug, Default, Deserialize)]
struct SystemLine {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    tools: Vec<String>,
    #[serde(default)]
    message: Option<String>,
}

/// Inner `message` object of an `assistant` / `user` line.
#[derive(Debug, Default, Deserialize)]
struct InnerMessage {
    #[serde(default)]
    content: Vec<ContentBlock>,
}

/// Permissive shape for `assistant` / `user` lines. `claude` nests the
/// blocks under `message.content`.
#[derive(Debug, Default, Deserialize)]
struct MessageLine {
    #[serde(default)]
    message: InnerMessage,
}

/// Permissive shape for `stream_event` lines.
///
/// `parent_tool_use_id` rides on the OUTER line envelope (alongside
/// `type: "stream_event"`) — claude-code stamps it there when the partial
/// message originates from a self-routed subagent. It may ALSO appear on the
/// inner `event`; [`extract_stream_delta`] checks the inner copy and the outer
/// one wins when both are present.
#[derive(Debug, Default, Deserialize)]
struct StreamEventLine {
    #[serde(default)]
    event: Option<serde_json::Value>,
    #[serde(default)]
    parent_tool_use_id: Option<String>,
}

// --- stream_event inner-event extraction (story S6 / S7) -------------------
//
// The inner `event` is an Anthropic SSE-shaped object. Every struct below is
// fully permissive (`#[serde(default)]`, all fields optional) so an unknown
// or partial inner shape deserialises silently — `extract_stream_delta` then
// degrades to `delta = None` rather than failing.

/// Permissive shape for a `stream_event`'s inner `event` object.
#[derive(Debug, Default, Deserialize)]
struct InnerStreamEvent {
    /// Inner event kind: `message_start` / `content_block_start` /
    /// `content_block_delta` / `message_delta` / `content_block_stop` / …
    #[serde(default, rename = "type")]
    kind: String,
    /// Content-block index — present on `content_block_start` / `_delta`.
    #[serde(default)]
    index: Option<u64>,
    /// The per-block delta — present on `content_block_delta`.
    #[serde(default)]
    delta: Option<InnerDelta>,
    /// The starting content block — present on `content_block_start`.
    #[serde(default)]
    content_block: Option<InnerContentBlock>,
    /// The message envelope — present on `message_start` (carries `usage`).
    #[serde(default)]
    message: Option<InnerMessageUsage>,
    /// Token usage — present directly on `message_delta`.
    #[serde(default)]
    usage: Option<Usage>,
    /// Non-null when the inner event originated from a self-routed subagent.
    #[serde(default)]
    parent_tool_use_id: Option<String>,
}

/// Permissive shape for a `content_block_delta`'s `delta` object.
#[derive(Debug, Default, Deserialize)]
struct InnerDelta {
    /// Delta kind: `text_delta` / `input_json_delta` / `thinking_delta` / …
    #[serde(default, rename = "type")]
    kind: String,
    /// Text fragment — present on a `text_delta`.
    #[serde(default)]
    text: Option<String>,
    /// JSON-input fragment — present on an `input_json_delta`.
    #[serde(default)]
    partial_json: Option<String>,
}

/// Permissive shape for a `content_block_start`'s `content_block` object.
#[derive(Debug, Default, Deserialize)]
struct InnerContentBlock {
    /// Block kind: `tool_use` / `text` / `thinking` / …
    #[serde(default, rename = "type")]
    kind: String,
    /// Tool-use id — present on a `tool_use` block.
    #[serde(default)]
    id: Option<String>,
    /// Tool name — present on a `tool_use` block.
    #[serde(default)]
    name: Option<String>,
}

/// Permissive shape for a `message_start`'s `message` object — only the
/// `usage` block is of interest.
#[derive(Debug, Default, Deserialize)]
struct InnerMessageUsage {
    #[serde(default)]
    usage: Option<Usage>,
}

/// Extract the cozy [`StreamDelta`] from a `stream_event`'s inner `event`.
///
/// Permissive and total: every recognised inner shape folds into a
/// [`StreamDelta`]; an unrecognised inner shape, a missing `event`, or a value
/// that fails the (already very permissive) deserialise all yield
/// `delta = None`. The inner event's `parent_tool_use_id` is carried out
/// regardless of whether a delta was recognised — a non-null value marks the
/// activity as self-routed-subagent work.
///
/// Recognised shapes (story S6/S7):
///   * `content_block_delta` + `delta.type == "text_delta"`        → `Text`
///   * `content_block_delta` + `delta.type == "input_json_delta"`  → `ToolInput`
///   * `content_block_start` + `content_block.type == "tool_use"`  → `ToolStart`
///   * `message_start` / `message_delta` carrying `usage`          → `Usage`
pub fn extract_stream_delta(event: Option<&serde_json::Value>) -> StreamDeltaExtraction {
    let Some(value) = event else {
        return StreamDeltaExtraction::default();
    };
    let inner: InnerStreamEvent = match serde_json::from_value(value.clone()) {
        Ok(i) => i,
        // A non-object / unexpected inner value — degrade to a no-op.
        Err(_) => return StreamDeltaExtraction::default(),
    };

    let parent_tool_use_id = inner
        .parent_tool_use_id
        .filter(|s| !s.is_empty());

    let delta = match inner.kind.as_str() {
        "content_block_delta" => match inner.delta {
            Some(d) => match d.kind.as_str() {
                "text_delta" => d.text.map(|text| StreamDelta::Text { text }),
                "input_json_delta" => d.partial_json.map(|partial_json| StreamDelta::ToolInput {
                    index: inner.index.unwrap_or(0),
                    partial_json,
                }),
                // `thinking_delta` and friends are not modelled — no-op.
                _ => None,
            },
            None => None,
        },
        "content_block_start" => match inner.content_block {
            Some(cb) if cb.kind == "tool_use" => match (cb.id, cb.name) {
                (Some(tool_use_id), Some(tool_name)) => Some(StreamDelta::ToolStart {
                    index: inner.index.unwrap_or(0),
                    tool_use_id,
                    tool_name,
                }),
                // A `tool_use` start missing id or name — cannot pair it; skip.
                _ => None,
            },
            // A `text` / `thinking` block start carries no cozy delta.
            _ => None,
        },
        "message_start" => inner
            .message
            .and_then(|m| m.usage)
            .map(|usage| StreamDelta::Usage { usage }),
        "message_delta" => inner.usage.map(|usage| StreamDelta::Usage { usage }),
        // `content_block_stop`, `message_stop`, `ping`, anything newer — no-op.
        _ => None,
    };

    StreamDeltaExtraction {
        delta,
        parent_tool_use_id,
    }
}

/// Permissive shape for the terminal `result` line.
#[derive(Debug, Default, Deserialize)]
struct ResultLine {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    num_turns: Option<u64>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    total_cost_usd: Option<f64>,
    #[serde(default)]
    usage: Usage,
    #[serde(default)]
    permission_denials: Vec<PermissionDenial>,
}

/// Parse one NDJSON output line into a typed [`ParsedEvent`].
///
/// Total and panic-free by construction:
///   * a line that is not valid JSON → [`ParsedEvent::Malformed`];
///   * a JSON object with an unrecognised `type` → [`ParsedEvent::Unknown`];
///   * a recognised `type` whose body fails the (already very permissive)
///     per-kind deserialise → [`ParsedEvent::Unknown`] (we still saw the
///     `type`, but cannot trust the body).
///
/// It never returns an `Err` and never `unwrap`s — every failure mode is a
/// data variant the caller renders, so a single bad line cannot abort a turn.
pub fn parse_line(line: &str) -> ParsedEvent {
    // Step 1 — is it JSON at all? Sniff just the envelope.
    let envelope: Envelope = match serde_json::from_str(line) {
        Ok(e) => e,
        Err(_) => {
            return ParsedEvent::Malformed {
                raw: line.to_string(),
            }
        }
    };

    // Step 2 — route on `type` (and `subtype` for `system`).
    match envelope.kind.as_str() {
        "system" => match envelope.subtype.as_str() {
            "init" => match serde_json::from_str::<SystemLine>(line) {
                Ok(s) => ParsedEvent::Init {
                    session_id: s.session_id,
                    model: s.model,
                    tools: s.tools,
                },
                Err(_) => unknown(line),
            },
            "api_retry" => match serde_json::from_str::<SystemLine>(line) {
                Ok(s) => ParsedEvent::ApiRetry { message: s.message },
                Err(_) => unknown(line),
            },
            // Other `system` subtypes are not modelled — keep the raw line.
            _ => unknown(line),
        },
        "assistant" => match serde_json::from_str::<MessageLine>(line) {
            Ok(m) => ParsedEvent::Assistant {
                content: m.message.content,
            },
            Err(_) => unknown(line),
        },
        "user" => match serde_json::from_str::<MessageLine>(line) {
            Ok(m) => ParsedEvent::User {
                content: m.message.content,
            },
            Err(_) => unknown(line),
        },
        "stream_event" => match serde_json::from_str::<StreamEventLine>(line) {
            Ok(s) => {
                // Story S6/S7 — pre-extract the cozy delta from the inner
                // event. The extraction is permissive: an unmodelled inner
                // shape simply yields `delta = None`, never an error.
                let extraction = extract_stream_delta(s.event.as_ref());
                // `parent_tool_use_id` rides on the OUTER envelope; the outer
                // copy wins, the inner one is the fallback (self-routed marker).
                let parent_tool_use_id = s
                    .parent_tool_use_id
                    .filter(|p| !p.is_empty())
                    .or(extraction.parent_tool_use_id);
                ParsedEvent::StreamEvent {
                    event: s.event,
                    delta: extraction.delta,
                    parent_tool_use_id,
                }
            }
            Err(_) => unknown(line),
        },
        "result" => match serde_json::from_str::<ResultLine>(line) {
            Ok(r) => ParsedEvent::Result {
                subtype: r.subtype,
                result: r.result,
                session_id: r.session_id,
                is_error: r.is_error,
                num_turns: r.num_turns,
                duration_ms: r.duration_ms,
                total_cost_usd: r.total_cost_usd,
                usage: r.usage,
                permission_denials: r.permission_denials,
            },
            Err(_) => unknown(line),
        },
        // Unrecognised `type` — ride along in the catch-all.
        _ => unknown(line),
    }
}

/// Small helper: wrap a raw line as [`ParsedEvent::Unknown`].
fn unknown(line: &str) -> ParsedEvent {
    ParsedEvent::Unknown {
        raw: line.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Hermetic: no spawning, no `claude` binary, no fixture files — the NDJSON
// samples are inline string literals. Matches the pattern binary.rs
// established (the repo's first Rust tests).

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tools() -> Vec<String> {
        vec!["Read".to_string(), "Edit".to_string(), "Bash".to_string()]
    }

    /// A first-turn call carries `--session-id`, all required flags, the
    /// prompt — and never `--bare`.
    #[test]
    fn build_args_first_turn_has_session_id_and_required_flags() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "hello eidolon",
            append_system_prompt: "You are Sage.",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "11111111-1111-1111-1111-111111111111",
            turn_kind: TurnKind::First,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        let v = build_args(&args);

        assert!(v.contains(&"-p".to_string()));
        assert!(v.contains(&"--output-format".to_string()));
        assert!(v.contains(&"stream-json".to_string()));
        assert!(v.contains(&"--verbose".to_string()));
        assert!(v.contains(&"--include-partial-messages".to_string()));
        assert!(v.contains(&"--append-system-prompt".to_string()));
        assert!(v.contains(&"You are Sage.".to_string()));
        assert!(v.contains(&"--allowedTools".to_string()));
        assert!(v.contains(&"Read,Edit,Bash".to_string()));
        assert!(v.contains(&"--permission-mode".to_string()));
        assert!(v.contains(&"default".to_string()));
        assert!(v.contains(&"--session-id".to_string()));
        assert!(v.contains(&"11111111-1111-1111-1111-111111111111".to_string()));
        assert!(v.contains(&"hello eidolon".to_string()));

        // First turn never resumes.
        assert!(!v.contains(&"--resume".to_string()));
        // `--bare` is forbidden — it strips auth + skill discovery.
        assert!(!v.contains(&"--bare".to_string()));
    }

    /// A resumed-turn call carries `--resume` (not `--session-id`) and still
    /// never `--bare`.
    #[test]
    fn build_args_resumed_turn_has_resume_not_session_id() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "follow up",
            append_system_prompt: "You are Sage.",
            allowed_tools: &tools,
            permission_mode: "acceptEdits",
            session_id: "22222222-2222-2222-2222-222222222222",
            turn_kind: TurnKind::Resumed,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        let v = build_args(&args);

        assert!(v.contains(&"--resume".to_string()));
        assert!(v.contains(&"22222222-2222-2222-2222-222222222222".to_string()));
        assert!(!v.contains(&"--session-id".to_string()));
        // `--bare` stays forbidden on resumed turns too.
        assert!(!v.contains(&"--bare".to_string()));
    }

    /// The prompt is the trailing positional argument.
    #[test]
    fn build_args_prompt_is_last() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "the prompt",
            append_system_prompt: "persona",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "33333333-3333-3333-3333-333333333333",
            turn_kind: TurnKind::First,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        let v = build_args(&args);
        assert_eq!(v.last().map(String::as_str), Some("the prompt"));
    }

    /// R3 — `--settings` carrying `showThinkingSummaries` is ALWAYS present,
    /// even when no model/effort is chosen, so streamed `thinking` blocks
    /// carry real reasoning text.
    #[test]
    fn build_args_always_passes_settings_with_thinking_summaries() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "p",
            append_system_prompt: "persona",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "44444444-4444-4444-4444-444444444444",
            turn_kind: TurnKind::First,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        let v = build_args(&args);
        assert!(v.contains(&"--settings".to_string()));
        assert!(v.contains(&r#"{"showThinkingSummaries":true}"#.to_string()));
        // `--bare` stays forbidden.
        assert!(!v.contains(&"--bare".to_string()));
    }

    /// R3 — when `model` / `thinking_effort` / `fallback_model` are `Some`,
    /// `build_args` appends `--model` / `--effort` / `--fallback-model` with
    /// their values.
    #[test]
    fn build_args_includes_model_effort_and_fallback_when_set() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "p",
            append_system_prompt: "persona",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "55555555-5555-5555-5555-555555555555",
            turn_kind: TurnKind::First,
            model: Some("opus[1m]"),
            thinking_effort: Some("high"),
            fallback_model: Some("sonnet"),
            fork_from: None,
        };
        let v = build_args(&args);

        // Each flag is followed immediately by its value.
        let flag_value = |flag: &str| -> Option<&str> {
            v.iter()
                .position(|a| a == flag)
                .and_then(|i| v.get(i + 1))
                .map(String::as_str)
        };
        assert_eq!(flag_value("--model"), Some("opus[1m]"));
        assert_eq!(flag_value("--effort"), Some("high"));
        assert_eq!(flag_value("--fallback-model"), Some("sonnet"));
    }

    /// R3 — when `model` / `thinking_effort` / `fallback_model` are `None`,
    /// the corresponding flags are omitted ENTIRELY (no empty value passed).
    #[test]
    fn build_args_omits_model_effort_and_fallback_when_none() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "p",
            append_system_prompt: "persona",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "66666666-6666-6666-6666-666666666666",
            turn_kind: TurnKind::Resumed,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        let v = build_args(&args);
        assert!(!v.contains(&"--model".to_string()));
        assert!(!v.contains(&"--effort".to_string()));
        assert!(!v.contains(&"--fallback-model".to_string()));
        // The empty-string value must never leak in.
        assert!(!v.contains(&String::new()));
    }

    /// P8 — a `Fork` turn carries `--resume <origin>` AND `--session-id <new>`
    /// AND `--fork-session`: it resumes the ORIGINAL conversation but writes to
    /// the NEW host-generated id. This is the fork's FIRST turn only.
    #[test]
    fn build_args_fork_turn_resumes_origin_and_writes_new_id() {
        let tools = sample_tools();
        let args = TurnArgs {
            prompt: "explore an alternate path",
            append_system_prompt: "You are Sage.",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "99999999-9999-9999-9999-999999999999",
            turn_kind: TurnKind::Fork,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: Some("11111111-1111-1111-1111-111111111111"),
        };
        let v = build_args(&args);

        // `--resume` carries the ORIGINAL id; `--session-id` the NEW forked id.
        let flag_value = |flag: &str| -> Option<&str> {
            v.iter()
                .position(|a| a == flag)
                .and_then(|i| v.get(i + 1))
                .map(String::as_str)
        };
        assert_eq!(
            flag_value("--resume"),
            Some("11111111-1111-1111-1111-111111111111")
        );
        assert_eq!(
            flag_value("--session-id"),
            Some("99999999-9999-9999-9999-999999999999")
        );
        // `--fork-session` is mandatory for the CLI to accept the pair.
        assert!(v.contains(&"--fork-session".to_string()));
        // The prompt still rides as the trailing positional.
        assert_eq!(v.last().map(String::as_str), Some("explore an alternate path"));
        // `--bare` stays forbidden.
        assert!(!v.contains(&"--bare".to_string()));
    }

    /// P8 — `--fork-session` appears ONLY on a `Fork` turn. A `First` turn and
    /// a `Resumed` turn never carry it (a fork's follow-up turns are ordinary
    /// `Resumed` turns).
    #[test]
    fn build_args_fork_session_only_on_fork_turn() {
        let tools = sample_tools();
        let base = |kind: TurnKind| TurnArgs {
            prompt: "p",
            append_system_prompt: "persona",
            allowed_tools: &tools,
            permission_mode: "default",
            session_id: "22222222-2222-2222-2222-222222222222",
            turn_kind: kind,
            model: None,
            thinking_effort: None,
            fallback_model: None,
            fork_from: None,
        };
        assert!(!build_args(&base(TurnKind::First)).contains(&"--fork-session".to_string()));
        assert!(!build_args(&base(TurnKind::Resumed)).contains(&"--fork-session".to_string()));
    }

    /// `system/init` → `ParsedEvent::Init` with session/model/tools populated.
    #[test]
    fn parse_line_system_init() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc-123","model":"claude-opus-4-7","tools":["Read","Edit"],"cwd":"/tmp"}"#;
        match parse_line(line) {
            ParsedEvent::Init {
                session_id,
                model,
                tools,
            } => {
                assert_eq!(session_id.as_deref(), Some("abc-123"));
                assert_eq!(model.as_deref(), Some("claude-opus-4-7"));
                assert_eq!(tools, vec!["Read".to_string(), "Edit".to_string()]);
            }
            other => panic!("expected Init, got {other:?}"),
        }
    }

    /// `system/api_retry` → `ParsedEvent::ApiRetry`.
    #[test]
    fn parse_line_system_api_retry() {
        let line = r#"{"type":"system","subtype":"api_retry","message":"overloaded, retrying"}"#;
        match parse_line(line) {
            ParsedEvent::ApiRetry { message } => {
                assert_eq!(message.as_deref(), Some("overloaded, retrying"));
            }
            other => panic!("expected ApiRetry, got {other:?}"),
        }
    }

    /// `assistant` → `ParsedEvent::Assistant` with text + tool_use blocks.
    #[test]
    fn parse_line_assistant_with_blocks() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi there"},{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/a"}}]}}"#;
        match parse_line(line) {
            ParsedEvent::Assistant { content } => {
                assert_eq!(content.len(), 2);
                assert_eq!(content[0].block_type, "text");
                assert_eq!(content[0].text.as_deref(), Some("hi there"));
                assert_eq!(content[1].block_type, "tool_use");
                assert_eq!(content[1].name.as_deref(), Some("Read"));
                assert_eq!(content[1].id.as_deref(), Some("tu_1"));
                assert!(content[1].input.is_some());
            }
            other => panic!("expected Assistant, got {other:?}"),
        }
    }

    /// REGRESSION (VIGIL root-cause-report): the `session-event` payload's
    /// `parsed` field is `serde_json::to_value(&ParsedEvent)`. The serialised
    /// `ContentBlock` MUST be camelCase (`blockType`) — the frontend's
    /// `AssistantBlock` switches on `block.blockType`. A snake_case `type`
    /// made every assistant block render as nothing.
    #[test]
    fn assistant_content_serialises_camelcase_for_the_frontend() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"},{"type":"tool_use","id":"tu_1","name":"Read","input":{}}]}}"#;
        let value = serde_json::to_value(parse_line(line)).expect("serialise");
        let blocks = value
            .get("Assistant")
            .and_then(|a| a.get("content"))
            .and_then(|c| c.as_array())
            .expect("Assistant.content array");
        assert_eq!(blocks[0].get("blockType").and_then(|v| v.as_str()), Some("text"));
        assert!(blocks[0].get("type").is_none(), "must not serialise as `type`");
        assert_eq!(blocks[1].get("blockType").and_then(|v| v.as_str()), Some("tool_use"));
    }

    /// REGRESSION: a `tool_result` block must serialise `tool_use_id`→`toolUseId`
    /// and `is_error`→`isError`, or the frontend tool-result index stays empty.
    #[test]
    fn tool_result_block_serialises_camelcase() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"out","is_error":true}]}}"#;
        let value = serde_json::to_value(parse_line(line)).expect("serialise");
        let content = value
            .get("User")
            .and_then(|u| u.get("content"))
            .and_then(|c| c.as_array())
            .expect("User.content array");
        let block = &content[0];
        assert_eq!(block.get("toolUseId").and_then(|v| v.as_str()), Some("tu_1"));
        assert_eq!(block.get("isError").and_then(|v| v.as_bool()), Some(true));
        assert!(block.get("tool_use_id").is_none(), "must not serialise as `tool_use_id`");
    }

    /// `user` carrying a `tool_result` block → `ParsedEvent::User`.
    #[test]
    fn parse_line_user_with_tool_result() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"file contents","is_error":false}]}}"#;
        match parse_line(line) {
            ParsedEvent::User { content } => {
                assert_eq!(content.len(), 1);
                assert_eq!(content[0].block_type, "tool_result");
                assert_eq!(content[0].tool_use_id.as_deref(), Some("tu_1"));
                assert_eq!(content[0].is_error, Some(false));
            }
            other => panic!("expected User, got {other:?}"),
        }
    }

    /// `stream_event` text delta → `ParsedEvent::StreamEvent` with a `Text`
    /// delta pre-extracted; the raw `event` still rides along.
    #[test]
    fn parse_line_stream_event_text_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"par"}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent {
                event,
                delta,
                parent_tool_use_id,
            } => {
                assert!(event.is_some(), "raw event preserved");
                assert_eq!(delta, Some(StreamDelta::Text { text: "par".into() }));
                assert_eq!(parent_tool_use_id, None);
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// `stream_event` `input_json_delta` → a `ToolInput` delta carrying the
    /// block index + the `partial_json` fragment.
    #[test]
    fn parse_line_stream_event_input_json_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"file"}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { delta, .. } => {
                assert_eq!(
                    delta,
                    Some(StreamDelta::ToolInput {
                        index: 2,
                        partial_json: "{\"file".into(),
                    })
                );
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// `stream_event` `content_block_start(tool_use)` → a `ToolStart` delta
    /// carrying the tool id + name.
    #[test]
    fn parse_line_stream_event_tool_start() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_42","name":"Read"}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { delta, .. } => {
                assert_eq!(
                    delta,
                    Some(StreamDelta::ToolStart {
                        index: 1,
                        tool_use_id: "tu_42".into(),
                        tool_name: "Read".into(),
                    })
                );
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// `stream_event` `message_delta` → a `Usage` delta (story S7's live feed).
    #[test]
    fn parse_line_stream_event_message_delta_usage() {
        let line = r#"{"type":"stream_event","event":{"type":"message_delta","usage":{"input_tokens":1200,"output_tokens":48,"cache_read_input_tokens":900}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { delta, .. } => match delta {
                Some(StreamDelta::Usage { usage }) => {
                    assert_eq!(usage.input_tokens, Some(1200));
                    assert_eq!(usage.output_tokens, Some(48));
                    assert_eq!(usage.cache_read_input_tokens, Some(900));
                }
                other => panic!("expected Usage delta, got {other:?}"),
            },
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// `stream_event` `message_start` carrying nested `message.usage` → a
    /// `Usage` delta.
    #[test]
    fn parse_line_stream_event_message_start_usage() {
        let line = r#"{"type":"stream_event","event":{"type":"message_start","message":{"role":"assistant","usage":{"input_tokens":500}}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { delta, .. } => match delta {
                Some(StreamDelta::Usage { usage }) => {
                    assert_eq!(usage.input_tokens, Some(500));
                }
                other => panic!("expected Usage delta, got {other:?}"),
            },
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// A `stream_event` carrying `parent_tool_use_id` surfaces it — the
    /// self-routed-subagent marker — alongside the delta.
    #[test]
    fn parse_line_stream_event_parent_tool_use_id() {
        let line = r#"{"type":"stream_event","parent_tool_use_id":"tu_parent","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"sub"}}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent {
                delta,
                parent_tool_use_id,
                ..
            } => {
                assert_eq!(delta, Some(StreamDelta::Text { text: "sub".into() }));
                assert_eq!(parent_tool_use_id.as_deref(), Some("tu_parent"));
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// An UNRECOGNISED inner `stream_event` shape is a safe no-op — the event
    /// still parses, but `delta` is `None` (never an error).
    #[test]
    fn parse_line_stream_event_unknown_inner_is_noop() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_stop","index":0}}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { event, delta, .. } => {
                assert!(event.is_some(), "raw event still preserved");
                assert_eq!(delta, None, "unmodelled inner shape → no delta");
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }

        // A `thinking_delta` content_block_delta is also unmodelled.
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}}"#;
        match parse_line(thinking) {
            ParsedEvent::StreamEvent { delta, .. } => assert_eq!(delta, None),
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// A `stream_event` with NO `event` at all degrades to a no-op delta.
    #[test]
    fn parse_line_stream_event_missing_event() {
        let line = r#"{"type":"stream_event"}"#;
        match parse_line(line) {
            ParsedEvent::StreamEvent { event, delta, .. } => {
                assert!(event.is_none());
                assert_eq!(delta, None);
            }
            other => panic!("expected StreamEvent, got {other:?}"),
        }
    }

    /// `extract_stream_delta` on a non-object inner value never panics — it
    /// just yields an empty extraction.
    #[test]
    fn extract_stream_delta_tolerates_garbage() {
        let garbage = serde_json::json!("not an object");
        assert_eq!(
            extract_stream_delta(Some(&garbage)),
            StreamDeltaExtraction::default()
        );
        assert_eq!(extract_stream_delta(None), StreamDeltaExtraction::default());
    }

    /// `result` → `ParsedEvent::Result` with terminal fields populated.
    #[test]
    fn parse_line_result() {
        let line = r#"{"type":"result","subtype":"success","result":"all done","session_id":"abc-123","is_error":false,"num_turns":3,"duration_ms":4200,"total_cost_usd":0.0123,"usage":{"input_tokens":1500,"output_tokens":300}}"#;
        match parse_line(line) {
            ParsedEvent::Result {
                subtype,
                result,
                session_id,
                is_error,
                num_turns,
                duration_ms,
                total_cost_usd,
                usage,
                permission_denials,
            } => {
                assert_eq!(subtype.as_deref(), Some("success"));
                assert_eq!(result.as_deref(), Some("all done"));
                assert_eq!(session_id.as_deref(), Some("abc-123"));
                assert!(!is_error);
                assert_eq!(num_turns, Some(3));
                assert_eq!(duration_ms, Some(4200));
                assert_eq!(total_cost_usd, Some(0.0123));
                assert_eq!(usage.input_tokens, Some(1500));
                assert_eq!(usage.output_tokens, Some(300));
                // No `permission_denials` field on the line → empty vec.
                assert!(permission_denials.is_empty());
            }
            other => panic!("expected Result, got {other:?}"),
        }
    }

    /// S0 — a `result` line carrying `permission_denials` parses each denial
    /// with its `tool_name` / `tool_use_id` / `tool_input`.
    #[test]
    fn parse_line_result_with_permission_denials() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"usage":{},"permission_denials":[{"tool_name":"Write","tool_use_id":"toolu_1","tool_input":{"file_path":"/a"}},{"tool_name":"Bash","tool_use_id":"toolu_2","tool_input":{"command":"ls"}}]}"#;
        match parse_line(line) {
            ParsedEvent::Result {
                permission_denials,
                ..
            } => {
                assert_eq!(permission_denials.len(), 2);
                assert_eq!(permission_denials[0].tool_name, "Write");
                assert_eq!(permission_denials[0].tool_use_id, "toolu_1");
                assert_eq!(
                    permission_denials[0].tool_input.get("file_path"),
                    Some(&serde_json::json!("/a"))
                );
                assert_eq!(permission_denials[1].tool_name, "Bash");
            }
            other => panic!("expected Result, got {other:?}"),
        }
    }

    /// S0 — an empty `permission_denials: []` array yields an empty vec, same
    /// as the field being absent (no regression to the normal result).
    #[test]
    fn parse_line_result_empty_permission_denials() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"usage":{},"permission_denials":[]}"#;
        match parse_line(line) {
            ParsedEvent::Result {
                permission_denials, ..
            } => assert!(permission_denials.is_empty()),
            other => panic!("expected Result, got {other:?}"),
        }
    }

    /// REGRESSION (mirrors the v0.3.6 camelCase regression test, extended for
    /// the `ParsedEvent` enum-level `rename_all_fields`): `ParsedEvent::Result`
    /// must serialise EVERY multi-word field as camelCase — `totalCostUsd` /
    /// `numTurns` / `durationMs` / `isError` / `sessionId` / `permissionDenials`
    /// — so the frontend's `ParsedResult` mirror reads them. Without the
    /// enum-level `rename_all_fields`, these shipped snake_case and the UI
    /// (ResultCard cost/turns/duration, the S0 denial notice) read `undefined`.
    /// Each denial's INNER fields are camelCased by `PermissionDenial`'s own
    /// split `rename_all`.
    #[test]
    fn parsed_result_serialises_camelcase_for_the_frontend() {
        let line = r#"{"type":"result","subtype":"success","session_id":"s1","is_error":false,"num_turns":3,"duration_ms":4200,"total_cost_usd":0.0123,"usage":{},"permission_denials":[{"tool_name":"Write","tool_use_id":"toolu_1","tool_input":{"file_path":"/a"}}]}"#;
        let value = serde_json::to_value(parse_line(line)).expect("serialise");
        let r = value.get("Result").expect("Result variant");
        // The variant-level multi-word fields are camelCase.
        assert_eq!(r.get("totalCostUsd").and_then(|v| v.as_f64()), Some(0.0123));
        assert_eq!(r.get("numTurns").and_then(|v| v.as_u64()), Some(3));
        assert_eq!(r.get("durationMs").and_then(|v| v.as_u64()), Some(4200));
        assert_eq!(r.get("isError").and_then(|v| v.as_bool()), Some(false));
        assert_eq!(r.get("sessionId").and_then(|v| v.as_str()), Some("s1"));
        assert!(r.get("permissionDenials").is_some(), "permissionDenials present");
        // The snake_case names must NOT appear.
        for snake in ["total_cost_usd", "num_turns", "duration_ms", "is_error", "permission_denials"] {
            assert!(r.get(snake).is_none(), "must not serialise as `{snake}`");
        }
        // Each denial's inner fields are camelCased by PermissionDenial.
        let d0 = &r
            .get("permissionDenials")
            .and_then(|d| d.as_array())
            .expect("permissionDenials array")[0];
        assert_eq!(d0.get("toolName").and_then(|v| v.as_str()), Some("Write"));
        assert_eq!(d0.get("toolUseId").and_then(|v| v.as_str()), Some("toolu_1"));
        assert!(d0.get("toolInput").is_some(), "toolInput present");
    }

    /// A JSON line with an unrecognised `type` → `Unknown`, raw preserved.
    #[test]
    fn parse_line_unknown_type() {
        let line = r#"{"type":"some_future_kind","payload":42}"#;
        match parse_line(line) {
            ParsedEvent::Unknown { raw } => assert_eq!(raw, line),
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    /// A non-JSON line → `Malformed`, raw preserved, and no panic.
    #[test]
    fn parse_line_non_json_is_malformed() {
        let line = "this is not json at all {";
        match parse_line(line) {
            ParsedEvent::Malformed { raw } => assert_eq!(raw, line),
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    /// An empty line also degrades gracefully (no panic).
    #[test]
    fn parse_line_empty_is_malformed() {
        match parse_line("") {
            ParsedEvent::Malformed { raw } => assert_eq!(raw, ""),
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    /// Newer/unmodelled nested fields must not break a recognised line —
    /// permissive serde lets extra keys ride.
    #[test]
    fn parse_line_tolerates_extra_fields() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"brand_new_field":{"nested":true},"usage":{"input_tokens":1,"output_tokens":2,"some_new_token_bucket":9}}"#;
        match parse_line(line) {
            ParsedEvent::Result { subtype, .. } => {
                assert_eq!(subtype.as_deref(), Some("success"));
            }
            other => panic!("expected Result despite extra fields, got {other:?}"),
        }
    }
}
