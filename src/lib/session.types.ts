// session.types.ts — TypeScript interfaces for the Eidolon session IPC surface.
//
// These types mirror the Rust wire shapes — they MUST stay in sync with:
//   src-tauri/src/session.rs        — commands, params, SessionInfo, AuthStatus,
//                                     and the three event payloads.
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
 * The `type` field is renamed to `blockType` (the Rust field is
 * `#[serde(rename = "type")] block_type`). It is an open string —
 * `"text"` / `"tool_use"` / `"thinking"` / `"tool_result"` or anything newer.
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

/** `type: "stream_event"` — a partial-message delta. */
export interface ParsedStreamEvent {
  StreamEvent: {
    /** The raw inner `event` payload, verbatim. */
    event?: unknown;
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
}

/** Returned by `start_session`: the addressable session descriptor. */
export interface SessionInfo {
  /** The host-generated UUID v4 — the session's stable address. */
  sessionId: string;
  /** The Eidolon identity driving the session. */
  eidolonName: string;
  /** Absolute working directory `claude` runs in. */
  projectPath: string;
  /** Active `--permission-mode`. */
  permissionMode: string;
  /** Session status at return time (`"running"` — turn 1 was just spawned). */
  status: string;
}

/** Returned by `claude_auth_status`: the `claude` CLI login pre-flight. */
export interface AuthStatus {
  /** `true` iff `claude auth status` exited with code 0. */
  loggedIn: boolean;
  /** Short human-readable status line for the UI to display. */
  detail: string;
}

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
