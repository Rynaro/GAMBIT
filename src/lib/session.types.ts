// session.types.ts — TypeScript interfaces for the Eidolon session IPC surface.
//
// These types mirror the Rust wire shapes — they MUST stay in sync with:
//   src-tauri/src/session.rs        — commands, params, SessionInfo, AuthStatus,
//                                     and the three event payloads.
//   src-tauri/src/session_store.rs  — SessionRecord, SessionSummary,
//                                     PersistedEntry, CumulativeUsage, TurnRecord.
//   src-tauri/src/claude_adapter.rs — the ParsedEvent enum + ContentBlock/Usage.
//
// All Rust structs derive `#[serde(rename_all = "camelCase")]`, so the wire
// shape is camelCase — the interfaces below match that exactly.
//
// `ParsedEvent` derives a plain `#[derive(Serialize)]` with NO `#[serde(tag)]`,
// so serde serialises it EXTERNALLY-TAGGED: each variant is a single-key object
// keyed by the variant name, e.g. `{ "Init": { ... } }`, `{ "Result": { ... } }`.
// The TS `ParsedEvent` union below mirrors that single-key-object shape. Note
// the stable lowercase discriminator the UI should switch on is the separate
// `kind` field on `SessionEventPayload` (`init` / `assistant` / `result` / …) —
// it is the IPC contract and does not move even if the enum's serde repr drifts.
//
// Permissive types on purpose: open enum-ish fields (`kind`, `permissionMode`,
// `subtype`, `blockType`) are plain `string`, not string-literal unions, so
// newer `claude` / session output loads without a type-level breaking change.
// Stated project convention — forward-compat over precision here.

// ---------------------------------------------------------------------------
// claude_adapter.rs — nested parsed-event types
// ---------------------------------------------------------------------------

/** Token-usage accounting carried on the terminal `result` event. */
export interface Usage {
  /** Input tokens billed for the turn. */
  inputTokens?: number | null;
  /** Output tokens billed for the turn. */
  outputTokens?: number | null;
  /** Tokens that created new cache entries. */
  cacheCreationInputTokens?: number | null;
  /** Tokens served from cache. */
  cacheReadInputTokens?: number | null;
}

/**
 * A single content block inside an `assistant` or `user` message.
 *
 * Wire field names are camelCase (`blockType` / `toolUseId` / `isError`):
 * `claude_adapter.rs`'s `ContentBlock` carries a split `rename_all` —
 * snake_case on the way in from `claude`, camelCase on the way out to this
 * interface. `blockType` is an open string — `"text"` / `"tool_use"` /
 * `"thinking"` / `"tool_result"` or anything newer.
 */
export interface ContentBlock {
  /** Block kind: `"text"` / `"tool_use"` / `"thinking"` / `"tool_result"` / … */
  blockType: string;
  /** Text payload — present on `text` blocks. */
  text?: string | null;
  /** Reasoning payload — present on `thinking` blocks. */
  thinking?: string | null;
  /** Tool name — present on `tool_use` blocks. */
  name?: string | null;
  /** Block id — present on `tool_use` blocks. */
  id?: string | null;
  /** Tool-use id a `tool_result` block refers back to. */
  toolUseId?: string | null;
  /** Tool input — present on `tool_use` blocks; shape varies per tool. */
  input?: unknown;
  /** Tool-result content — string or array of nested blocks. */
  content?: unknown;
  /** Whether a `tool_result` block represents an error. */
  isError?: boolean | null;
}

// ---------------------------------------------------------------------------
// claude_adapter.rs — the ParsedEvent union (externally-tagged)
// ---------------------------------------------------------------------------

/** `type: "system", subtype: "init"` — the session handshake. */
export interface ParsedInit {
  Init: {
    /** The session UUID `claude` assigned (or echoed back). */
    sessionId?: string | null;
    /** The model serving the session. */
    model?: string | null;
    /** Tool names available for the session. */
    tools: string[];
  };
}

/** `type: "system", subtype: "api_retry"` — a transient API retry notice. */
export interface ParsedApiRetry {
  ApiRetry: {
    /** Human-readable retry detail, if the line carried one. */
    message?: string | null;
  };
}

/** `type: "assistant"` — an assistant message and its content blocks. */
export interface ParsedAssistant {
  Assistant: {
    /** Content blocks of the assistant message. */
    content: ContentBlock[];
  };
}

/** `type: "user"` — a user message, typically carrying `tool_result` blocks. */
export interface ParsedUser {
  User: {
    /** Content blocks of the user message. */
    content: ContentBlock[];
  };
}

/**
 * The cozy delta pre-extracted from a `stream_event`'s inner `event` (story
 * S6/S7), mirroring Rust's externally-tagged `StreamDelta` enum.
 *
 * Permissive: a consumer should switch on the single object key. An unmodelled
 * inner `stream_event` shape yields no `StreamDelta` at all (`delta` is
 * `null`).
 */
export type StreamDelta =
  | { Text: { text: string } }
  | { ToolInput: { index: number; partialJson: string } }
  | { ToolStart: { index: number; toolUseId: string; toolName: string } }
  | { Usage: { usage: Usage } };

/** `type: "stream_event"` — a partial-message delta. */
export interface ParsedStreamEvent {
  StreamEvent: {
    /** The raw inner `event` payload, verbatim. */
    event?: unknown;
    /**
     * The pre-extracted cozy delta — `null`/absent for an unmodelled inner
     * shape (story S6/S7).
     */
    delta?: StreamDelta | null;
    /** Non-null when the inner event came from a self-routed subagent. */
    parentToolUseId?: string | null;
  };
}

/** `type: "result"` — the terminal event ending a turn. */
export interface ParsedResult {
  Result: {
    /** Result subtype, e.g. `"success"` or `"error_max_turns"`. Open string. */
    subtype?: string | null;
    /** The final result text, when the turn produced one. */
    result?: string | null;
    /** The session UUID — useful to capture for the next turn's resume. */
    sessionId?: string | null;
    /** Whether the turn ended in an error state. */
    isError: boolean;
    /** Number of model turns the request consumed. */
    numTurns?: number | null;
    /** Wall-clock duration of the turn in milliseconds. */
    durationMs?: number | null;
    /** Total billed cost of the turn in USD. */
    totalCostUsd?: number | null;
    /** Token-usage accounting for the turn. */
    usage: Usage;
  };
}

/** A syntactically valid JSON line whose `type` is not modelled. */
export interface ParsedUnknown {
  Unknown: {
    /** The raw NDJSON line, verbatim. */
    raw: string;
  };
}

/** A line that is not valid JSON at all. */
export interface ParsedMalformed {
  Malformed: {
    /** The raw line, verbatim. */
    raw: string;
  };
}

/**
 * The typed taxonomy of `claude` stream-json NDJSON lines, mirroring the
 * externally-tagged serde representation of Rust's `ParsedEvent` enum.
 */
export type ParsedEvent =
  | ParsedInit
  | ParsedApiRetry
  | ParsedAssistant
  | ParsedUser
  | ParsedStreamEvent
  | ParsedResult
  | ParsedUnknown
  | ParsedMalformed;

// ---------------------------------------------------------------------------
// session.rs — command params + return shapes
// ---------------------------------------------------------------------------

/**
 * Parameters for the `start_session` command.
 *
 * `appendSystemPrompt` is the persona STRING — the frontend resolves it (story
 * S3's `eidolonRoster.ts`, from a `ProjectEidolon`); Rust never parses agent.md.
 */
export interface StartSessionParams {
  /** Absolute working directory to spawn `claude` in. */
  projectPath: string;
  /** The Eidolon identity to drive the session. */
  eidolonName: string;
  /** Value for `--permission-mode` (`"default"` / `"acceptEdits"` / `"plan"`). */
  permissionMode: string;
  /** Resolved Eidolon persona text — passed to `--append-system-prompt`. */
  appendSystemPrompt: string;
  /** Tool names the Eidolon allows — joined into `--allowedTools`. */
  allowedTools: string[];
  /** The prompt for turn 1. */
  firstPrompt: string;
  /**
   * `true` for a cortex-routed default session (story S4 launch path).
   * Optional — defaults to `false` on the Rust side via `#[serde(default)]`.
   */
  isCortex?: boolean;
  /**
   * Optional explicit session title. When absent, Rust derives the title
   * from `firstPrompt` (first ~60 chars).
   */
  title?: string | null;
  /**
   * R3 — the model to serve the session, passed to `--model` on every turn.
   * An alias (`opus` / `sonnet` / `haiku` / `opusplan` / `default`, plus the
   * `[1m]` variants) or a full model id. Optional — absent lets `claude`
   * apply its own default. Open string for forward-compat (new aliases).
   */
  model?: string | null;
  /**
   * R3 — the reasoning effort level, passed to `--effort` on every turn
   * (`low` / `medium` / `high` / `xhigh` / `max`). Optional — absent lets
   * `claude`'s own default apply. Open string for forward-compat.
   */
  thinkingEffort?: string | null;
  /**
   * R3 — the fallback model alias, passed to `--fallback-model` (auto-downgrade
   * when the primary model is overloaded). Optional. Open string.
   */
  fallbackModel?: string | null;
}

/**
 * Parameters for the `fork_session` command (P8).
 *
 * A fork continues a COPY of an existing session's conversation under a new
 * id, leaving the original untouched — for exploring an alternate path.
 * `originSessionId` must be a persisted (known) session; its on-disk record is
 * the source of the fork's copied metadata + seeded transcript.
 */
export interface ForkSessionParams {
  /** The UUID of the session to fork from — must be persisted on disk. */
  originSessionId: string;
  /** The prompt for the fork's first turn. */
  firstPrompt: string;
  /**
   * Optional explicit title for the fork. When absent Rust derives the title
   * from `firstPrompt` (first ~60 chars), mirroring `start_session`.
   */
  title?: string | null;
}

/** Returned by `start_session` / `reopen_session` / `fork_session`: the session descriptor. */
export interface SessionInfo {
  /** The host-generated UUID v4 — the session's stable address. */
  sessionId: string;
  /** The Eidolon identity driving the session. */
  eidolonName: string;
  /** Absolute working directory `claude` runs in. */
  projectPath: string;
  /** Active `--permission-mode`. */
  permissionMode: string;
  /** Session status at return time. */
  status: string;
  /** RFC-3339 creation timestamp (story S1). */
  createdAt: string;
  /** `true` for a cortex-routed default session (story S4). */
  isCortex: boolean;
}

// ---------------------------------------------------------------------------
// session_store.rs — persisted record shapes (story S1; mirrored for S2)
// ---------------------------------------------------------------------------

/**
 * One transcript entry as Rust observed it on the `claude` NDJSON stream.
 *
 * The persisted counterpart of `TranscriptEntry` (see `useSessions.ts`) — a
 * rehydrating session rebuilds its in-memory `TranscriptEntry[]` directly from
 * a `SessionRecord`'s `PersistedEntry[]`.
 */
export interface PersistedEntry {
  /** `"event"` for a parsed stdout line, `"stderr"` for a stderr line. */
  source: string;
  /** The 1-based turn this entry belongs to. */
  turn: number;
  /** Short `kind` discriminator — set for `event` entries, absent for stderr. */
  kind?: string | null;
  /** The typed `ParsedEvent` as JSON — set for `event` entries. */
  parsed?: ParsedEvent | null;
  /** The raw line, verbatim. */
  line: string;
  /** RFC-3339 timestamp the entry was observed at. */
  ts: string;
}

/** Cumulative token usage summed across every turn of a session. */
export interface CumulativeUsage {
  /** Sum of per-turn input tokens. */
  inputTokens: number;
  /** Sum of per-turn output tokens. */
  outputTokens: number;
  /** Sum of per-turn cache-creation input tokens. */
  cacheCreationInputTokens: number;
  /** Sum of per-turn cache-read input tokens. */
  cacheReadInputTokens: number;
}

/** One per-turn finalisation record — drives partial-turn-safe re-entry. */
export interface TurnRecord {
  /** The 1-based turn number. */
  turn: number;
  /** `true` iff a terminal `result` event was seen for this turn. */
  resultSeen: boolean;
}

/**
 * The full, durable record of one Eidolon session — returned by
 * `load_session`. The serializable counterpart of the live session.
 */
export interface SessionRecord {
  /** Host-generated UUID v4 — the session address. */
  uuid: string;
  /** The Eidolon identity, or empty when `isCortex`. */
  eidolonName: string;
  /** `true` for a cortex-routed default session. */
  isCortex: boolean;
  /** Title — derived from the turn-1 prompt or user-set. */
  title: string;
  /** The pinned absolute working directory `claude` is spawned in. */
  projectPath: string;
  /** Value passed verbatim to `--permission-mode`. */
  permissionMode: string;
  /** Resolved persona text — the Eidolon `agent.md`, or the cortex descriptor. */
  appendSystemPrompt: string;
  /** Tool names joined into `--allowedTools`. */
  allowedTools: string[];
  /** Coarse status: `idle` / `running` / `ended` / `failed`. */
  status: string;
  /** The serving model, captured from the `system/init` event. */
  model?: string | null;
  /**
   * R3 — the user-CHOSEN model (`--model`), distinct from the OBSERVED
   * `model` above. The launch-time selection, persisted so a reopened session
   * resumes on the same model. Absent on records written before R3.
   */
  chosenModel?: string | null;
  /** R3 — the reasoning effort level (`--effort`). Absent on pre-R3 records. */
  thinkingEffort?: string | null;
  /** R3 — the fallback model alias (`--fallback-model`). Absent pre-R3. */
  fallbackModel?: string | null;
  /**
   * P8 — when this session is a FORK, the UUID of the session it was forked
   * from (its parent). Absent / `null` for an ordinary, non-forked session.
   * The fork's metadata is copied from the parent at fork time; this records
   * the lineage. Absent on records written before P8.
   */
  forkedFrom?: string | null;
  /** RFC-3339 creation timestamp. */
  createdAt: string;
  /** RFC-3339 timestamp, bumped on every turn flush. */
  lastActiveAt: string;
  /** The full rendered transcript, append-only across turns. */
  transcript: PersistedEntry[];
  /** Token usage summed across every turn. */
  cumulativeUsage: CumulativeUsage;
  /** Estimated cost in USD summed across every turn. */
  cumulativeCostUsd?: number | null;
  /** Per-turn finalisation log — drives partial-turn-safe re-entry. */
  perTurn: TurnRecord[];
}

/**
 * The lightweight list-view shape — one entry per session in `index.json`,
 * returned by `list_sessions`.
 */
export interface SessionSummary {
  /** Host-generated UUID v4 — the session address. */
  uuid: string;
  /** The Eidolon identity, or empty when `isCortex`. */
  eidolonName: string;
  /** `true` for a cortex-routed default session. */
  isCortex: boolean;
  /** Title — derived from the turn-1 prompt or user-set. */
  title: string;
  /**
   * The pinned absolute working directory `claude` was spawned in.
   *
   * Surfaced on the summary (story S3) so the composer-as-creator cwd
   * resolution can default to the most-recently-active session's project
   * without a `load_session` round trip. May be `""` on an index entry
   * written by an older build (the Rust field is `#[serde(default)]`).
   */
  projectPath: string;
  /** Coarse status: `idle` / `running` / `ended` / `failed`. */
  status: string;
  /** The serving model, or null if not yet captured. */
  model?: string | null;
  /**
   * R3 — the user-CHOSEN model (`--model`), surfaced on the summary so the
   * list can show the pinned model before the first `system/init` arrives.
   * Absent on index entries written before R3.
   */
  chosenModel?: string | null;
  /** R3 — the reasoning effort level (`--effort`). Absent pre-R3. */
  thinkingEffort?: string | null;
  /** RFC-3339 creation timestamp. */
  createdAt: string;
  /** RFC-3339 timestamp, bumped on every turn flush. */
  lastActiveAt: string;
  /** Cumulative input tokens across all turns. */
  cumulativeInputTokens: number;
  /** Cumulative output tokens across all turns. */
  cumulativeOutputTokens: number;
  /** Cumulative estimated cost in USD across all turns. */
  cumulativeCostUsd: number;
}

/** Returned by `claude_auth_status`: the `claude` CLI login pre-flight. */
export interface AuthStatus {
  /** `true` iff `claude auth status` exited with code 0. */
  loggedIn: boolean;
  /** Short human-readable status line for the UI to display. */
  detail: string;
}

/**
 * P9 — the return shape of the `list_project_files` command.
 *
 * The Rust command (`project_files.rs`) returns a bare `Vec<String>` of
 * RELATIVE, forward-slashed file paths sorted alphabetically and capped at a
 * few thousand entries — the file pool the composer's `@`-mention picker
 * filters. A plain alias rather than an `interface` because the wire shape is
 * exactly `string[]`; the alias documents the contract at the call site.
 */
export type ProjectFiles = string[];

// ---------------------------------------------------------------------------
// session.rs — event payloads (all camelCase on the wire)
// ---------------------------------------------------------------------------

/** `session-event` — one parsed `claude` stream-json NDJSON line. */
export interface SessionEventPayload {
  /** The owning session's UUID. */
  sessionId: string;
  /**
   * Short, stable discriminator: `init` / `assistant` / `user` /
   * `streamEvent` / `apiRetry` / `result` / `unknown`. Open string — switch
   * on THIS field, not on the `parsed` union's tag.
   */
  kind: string;
  /** The raw NDJSON line, verbatim. */
  raw: string;
  /** The typed `ParsedEvent` (externally-tagged single-key object). */
  parsed: ParsedEvent;
  /** RFC-3339 emit timestamp. */
  ts: string;
}

/** `session-stderr` — one line of `claude`'s stderr. */
export interface SessionStderrPayload {
  /** The owning session's UUID. */
  sessionId: string;
  /** The stderr line, verbatim. */
  line: string;
  /** RFC-3339 emit timestamp. */
  ts: string;
}

/** `session-turn-complete` — a turn finished (dual-finalize: result OR exit). */
export interface SessionTurnCompletePayload {
  /** The owning session's UUID. */
  sessionId: string;
  /** Child exit code (`-1` unknown, `-2` cancelled mid-flight). */
  exitCode: number;
  /** Whether a terminal `result` event was observed on stdout (R6). */
  hadResult: boolean;
  /**
   * Whether the turn ended in failure (non-zero exit, or a `result` event
   * with `isError: true`).
   */
  isError: boolean;
}

/**
 * `session-delta` — an EPHEMERAL streaming fragment (story S6/S7).
 *
 * Carries an incremental assistant-text fragment (`deltaKind === "text"`) or a
 * `tool_use` JSON-input fragment (`deltaKind === "toolInput"`). EPHEMERAL by
 * contract — the store accumulates these into per-turn live state and CLEARS
 * that state on `session-turn-complete`; the persisted `assistant` / `user`
 * `session-event` entries are the durable source of truth.
 */
export interface SessionDeltaPayload {
  /** The owning session's UUID. */
  sessionId: string;
  /** The 1-based turn this delta belongs to. */
  turn: number;
  /** `"text"` for an assistant-text fragment, `"toolInput"` for a tool-input
   * fragment. Open string for forward-compat. */
  deltaKind: string;
  /** The text fragment — present when `deltaKind === "text"`. */
  text?: string | null;
  /** The owning `tool_use` block's index — present for `"toolInput"`. */
  blockIndex?: number | null;
  /** The `partial_json` fragment — present when `deltaKind === "toolInput"`. */
  partialJson?: string | null;
  /** Non-null when the fragment came from a self-routed subagent. */
  parentToolUseId?: string | null;
  /** RFC-3339 emit timestamp. */
  ts: string;
}

/**
 * `session-tool-start` — an EPHEMERAL "a tool call is beginning" marker
 * (story S6).
 *
 * Fires on a `stream_event` `content_block_start(tool_use)` so the UI can show
 * a live "running" `ToolUseChip` (spinner + elapsed time) before the paired
 * `tool_result` lands. EPHEMERAL — cleared on `session-turn-complete`.
 */
export interface SessionToolStartPayload {
  /** The owning session's UUID. */
  sessionId: string;
  /** The 1-based turn this tool call belongs to. */
  turn: number;
  /** The content-block index — correlates the `toolInput` deltas back. */
  blockIndex: number;
  /** The `tool_use` id — pairs with the eventual `tool_result.toolUseId`. */
  toolUseId: string;
  /** The tool name. */
  toolName: string;
  /** Non-null when the tool call is self-routed-subagent work. */
  parentToolUseId?: string | null;
  /** RFC-3339 emit timestamp. */
  ts: string;
}

/**
 * `session-usage` — an EPHEMERAL live mid-turn token-usage update (story S7).
 *
 * Carries the incremental `usage` from a `stream_event`'s `message_start` /
 * `message_delta`, feeding the `ContextGauge` so the temperature bar moves
 * mid-turn. EPHEMERAL — the authoritative `result` usage supersedes it.
 */
export interface SessionUsagePayload {
  /** The owning session's UUID. */
  sessionId: string;
  /** The 1-based turn this usage belongs to. */
  turn: number;
  /** Input tokens reported so far this turn. */
  inputTokens?: number | null;
  /** Output tokens reported so far this turn. */
  outputTokens?: number | null;
  /** Cache-read input tokens reported so far this turn. */
  cacheReadInputTokens?: number | null;
  /** Cache-creation input tokens reported so far this turn. */
  cacheCreationInputTokens?: number | null;
  /** RFC-3339 emit timestamp. */
  ts: string;
}
