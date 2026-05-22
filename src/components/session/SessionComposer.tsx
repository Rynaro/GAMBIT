// SessionComposer.tsx — the unified chat composer (story S3).
//
// v0.3.1's composer only sent FOLLOW-UP turns on an already-live session. S3
// makes it "a common chatting place": the SAME textarea both CREATES a session
// and SENDS turns into it.
//
//   * detail mode  — a session is selected. ⌘↵ / Send issues a follow-up turn
//                     (`onSend`), exactly as before.
//   * create mode  — NO session is selected. ⌘↵ / Send CREATES a session
//                     (`onCreate`) and that text becomes turn 1.
//
// The former pre-launch FORM (Eidolon picker, permission-mode select) collapses
// into an OPTIONAL disclosure panel — collapsed by default so the zero-effort
// path is pure type-and-send. The panel is shown only in create mode (a live
// session's Eidolon/mode are immutable).
//
// Story S4 — the picker's first entry is the synthetic "Cortex (default)"
// option (TRANCE-lite, FORGE option (c)): it is pre-selected by the route so
// the zero-effort path opens a cortex-routed session with no picker
// interaction at all. Selecting a named Eidolon is the explicit opt-in
// override. A Cortex entry whose `.eidolons/cortex/EIDOLONS.md` descriptor is
// absent renders disabled with an "unavailable" note.
//
// cwd resolution (FORGE-mandated, spec §5) lives in the ROUTE — the composer is
// handed the resolved state via `createReady` / `cwdBlockedReason`. When the
// resolution yields no absolute project_path the composer is in a blocked
// state: the create action is disabled and a "select a project" affordance is
// shown. A session is NEVER created without a resolved absolute project_path.

import type { ProjectEidolon } from "@/lib/eidolon.types";
import { CORTEX_DISPLAY_NAME } from "@/lib/eidolonRoster";
import { type KeyboardEvent, useState } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionComposerProps {
  /**
   * `"detail"` — a session is selected; ⌘↵ sends a follow-up turn.
   * `"create"` — no session selected; ⌘↵ creates a session + sends turn 1.
   */
  mode: "detail" | "create";

  // -- detail mode --------------------------------------------------------
  /** Whether the selected session is ready to accept a new turn. */
  canSend: boolean;
  /** Whether a turn is currently in flight (enables Cancel). */
  turnRunning: boolean;
  /** Send a follow-up turn with the composed prompt (detail mode). */
  onSend: (prompt: string) => void;
  /** Cancel the in-flight turn. */
  onCancel: () => void;

  // -- create mode --------------------------------------------------------
  /**
   * Create a session and dispatch turn 1 with `prompt`. The route resolves +
   * pins the cwd before calling `start` — the composer never sees a path.
   */
  onCreate: (prompt: string, opts: { eidolonName: string; permissionMode: string }) => void;
  /**
   * `true` when create mode has a resolved absolute `project_path` AND `claude`
   * is logged in — i.e. a session can actually be created. `false` blocks the
   * create action (spec §5 step 3 — no session without a resolved path).
   */
  createReady: boolean;
  /**
   * Human-readable reason the create action is blocked (no project / not
   * logged in), shown as an affordance. Empty when `createReady`.
   */
  cwdBlockedReason: string;
  /** Absolute project path the new session will be pinned to, for display. */
  resolvedProjectPath: string | null;
  /** The project's Eidolon roster — populates the disclosure picker. */
  eidolons: ProjectEidolon[];
  /** Whether the roster has finished loading. */
  eidolonsLoaded: boolean;
  /** The selected Eidolon name (controlled by the route). */
  selectedEidolon: string;
  /** Change the selected Eidolon. */
  onSelectEidolon: (name: string) => void;
  /** Permission-mode options for the disclosure select. */
  permissionModes: string[];
  /** The selected permission mode (controlled by the route). */
  permissionMode: string;
  /** Change the permission mode. */
  onSelectPermissionMode: (mode: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionComposer({
  mode,
  canSend,
  turnRunning,
  onSend,
  onCancel,
  onCreate,
  createReady,
  cwdBlockedReason,
  resolvedProjectPath,
  eidolons,
  eidolonsLoaded,
  selectedEidolon,
  onSelectEidolon,
  permissionModes,
  permissionMode,
  onSelectPermissionMode,
}: SessionComposerProps) {
  const [draft, setDraft] = useState("");
  // The optional FORM disclosure — collapsed by default so the zero-effort
  // path is pure type-and-send.
  const [showOptions, setShowOptions] = useState(false);

  const isCreate = mode === "create";
  // Whether the compose action can fire at all (independent of draft text).
  const actionEnabled = isCreate ? createReady : canSend;

  function handleCompose() {
    const prompt = draft.trim();
    if (!prompt || !actionEnabled) return;
    if (isCreate) {
      onCreate(prompt, { eidolonName: selectedEidolon, permissionMode });
    } else {
      onSend(prompt);
    }
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter composes — newline stays the default Enter behaviour.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleCompose();
    }
  }

  // The textarea is disabled only when a follow-up turn cannot be sent. In
  // create mode it stays editable even while blocked — the user can type, then
  // pick a project — so the blocked reason is shown, not a dead textarea.
  const inputDisabled = !isCreate && !canSend;

  const placeholder = isCreate
    ? "Describe what you want to do… (⌘↵ to start a session)"
    : canSend
      ? "Reply to the Eidolon… (⌘↵ to send)"
      : "Waiting for the current turn…";

  const actionLabel = isCreate ? "Start session" : "Send";

  return (
    <div className="session-composer">
      {/* create-mode blocked affordance (spec §5 step 3) */}
      {isCreate && !createReady && cwdBlockedReason && (
        <p className="session-composer-blocked" role="alert">
          <span aria-hidden="true">⚠ </span>
          {cwdBlockedReason}
        </p>
      )}

      <textarea
        className="session-composer-input"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
        rows={3}
        aria-label={isCreate ? "New session prompt" : "Follow-up turn prompt"}
      />

      {/* optional FORM disclosure — create mode only */}
      {isCreate && (
        <div className="session-composer-options">
          <button
            type="button"
            className="session-composer-disclosure"
            onClick={() => setShowOptions((v) => !v)}
            aria-expanded={showOptions}
            aria-label="Toggle session options"
          >
            <span className="session-composer-chevron" data-expanded={showOptions}>
              ▸
            </span>
            Options
            {resolvedProjectPath && (
              <span className="session-composer-cwd" title={resolvedProjectPath}>
                {resolvedProjectPath}
              </span>
            )}
          </button>

          {showOptions && (
            <div className="session-composer-options-body">
              <div className="session-field">
                <label className="session-field-label" htmlFor="composer-eidolon-select">
                  Eidolon
                </label>
                {eidolonsLoaded && eidolons.length === 0 ? (
                  <p className="session-field-note">
                    No Eidolons found — add members to <code>eidolons.yaml</code>.
                  </p>
                ) : (
                  <select
                    id="composer-eidolon-select"
                    className="session-select"
                    value={selectedEidolon}
                    onChange={(e) => onSelectEidolon(e.target.value)}
                    aria-label="Select an Eidolon to launch"
                  >
                    {!eidolonsLoaded && <option value="">Loading…</option>}
                    {eidolons.map((e) => {
                      // S4: the synthetic Cortex entry shows its display name;
                      // a Cortex entry whose descriptor is missing is disabled
                      // so it cannot be picked as the launch persona.
                      const label = e.isCortex
                        ? e.unavailable
                          ? `${CORTEX_DISPLAY_NAME} — unavailable`
                          : CORTEX_DISPLAY_NAME
                        : `${e.name}${e.role ? ` — ${e.role}` : ""}`;
                      return (
                        <option
                          key={e.name}
                          value={e.name}
                          disabled={e.isCortex === true && e.unavailable === true}
                        >
                          {label}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              <div className="session-field">
                <label className="session-field-label" htmlFor="composer-mode-select">
                  Permission mode
                </label>
                <select
                  id="composer-mode-select"
                  className="session-select"
                  value={permissionMode}
                  onChange={(e) => onSelectPermissionMode(e.target.value)}
                  aria-label="Select the permission mode"
                >
                  {permissionModes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="session-composer-actions">
        {turnRunning && (
          <button
            type="button"
            className="session-cancel-btn"
            onClick={onCancel}
            aria-label="Cancel the running turn"
          >
            Cancel turn
          </button>
        )}
        <button
          type="button"
          className="session-send-btn"
          onClick={handleCompose}
          disabled={!actionEnabled || draft.trim().length === 0}
          aria-label={isCreate ? "Start the session" : "Send follow-up turn"}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
