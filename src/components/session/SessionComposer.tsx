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

import { EFFORT_OPTIONS, MODEL_OPTIONS } from "@/lib/claudeModels";
import { getEnterToSend, setEnterToSend } from "@/lib/composerPrefs";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import { CORTEX_DISPLAY_NAME } from "@/lib/eidolonRoster";
import { estimateTokens } from "@/lib/estimateTokens";
import { type MentionContext, applyMention, detectMention, filterFiles } from "@/lib/mentionPicker";
import type { ProjectFiles } from "@/lib/session.types";
import { invoke } from "@tauri-apps/api/core";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
   *
   * R3 — `model` / `thinkingEffort` are the launch-time selections forwarded
   * to `StartSessionParams`. An empty `thinkingEffort` means "let claude's own
   * default apply" (the route maps it to an absent `--effort`).
   */
  onCreate: (
    prompt: string,
    opts: {
      eidolonName: string;
      permissionMode: string;
      model: string;
      thinkingEffort: string;
    },
  ) => void;
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
  /** R3 — the selected `--model` value (controlled by the route). */
  model: string;
  /** R3 — change the selected model. */
  onSelectModel: (model: string) => void;
  /** R3 — the selected `--effort` value, or `""` for claude's own default. */
  thinkingEffort: string;
  /** R3 — change the selected thinking-effort level. */
  onSelectThinkingEffort: (effort: string) => void;

  // -- P4 edit-and-resend -------------------------------------------------
  /**
   * P4 — a draft injection pulse. When `editDraft.nonce` advances, the
   * composer loads `editDraft.text` into the textarea and focuses it so the
   * user can amend a prior prompt before sending. A fresh `nonce` (not the
   * text alone) drives the load so re-injecting the SAME text still works.
   * `nonce` starts at `0` — that initial value never injects.
   */
  editDraft?: { text: string; nonce: number };

  // -- P9 @-file mentions -------------------------------------------------
  /**
   * P9 — the project's absolute path, used to lazily fetch the file list for
   * the `@`-mention picker. `null` (no project resolved) disables the picker —
   * typing `@` simply inserts a literal `@`. The list is fetched once per
   * `projectPath` on first `@` and cached for the composer's lifetime.
   */
  projectPath: string | null;
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
  model,
  onSelectModel,
  thinkingEffort,
  onSelectThinkingEffort,
  editDraft,
  projectPath,
}: SessionComposerProps) {
  const [draft, setDraft] = useState("");
  // The optional FORM disclosure — collapsed by default so the zero-effort
  // path is pure type-and-send.
  const [showOptions, setShowOptions] = useState(false);

  // P7 — the Enter-to-send preference, seeded lazily from `localStorage` and
  // persisted on every flip (gambit: key prefix, mirroring `railStore.ts`).
  // OFF (default): ⌘/Ctrl+Enter sends, plain Enter is a newline.
  // ON: plain Enter sends, Shift+Enter inserts a newline.
  const [enterToSend, setEnterToSendState] = useState<boolean>(getEnterToSend);

  // P4 — load an edited prompt into the draft when the route pulses a fresh
  // `editDraft.nonce`. The `nonce` (not the text) is the dependency so
  // re-injecting the same text still loads. The `0` initial nonce never fires.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce pulse is the trigger; text is read but must not re-fire on its own
  useEffect(() => {
    if (!editDraft || editDraft.nonce === 0) return;
    setDraft(editDraft.text);
  }, [editDraft?.nonce]);

  const isCreate = mode === "create";
  // Whether the compose action can fire at all (independent of draft text).
  const actionEnabled = isCreate ? createReady : canSend;

  // R5 — a deliberately-approximate token estimate of the draft, recomputed on
  // every keystroke. The draft is only a FRACTION of the true request, so this
  // is a "ballpark" figure and is labelled with a leading `~`.
  const tokenEstimate = useMemo(() => estimateTokens(draft), [draft]);

  // -------------------------------------------------------------------------
  // P9 — @-file mention picker
  // -------------------------------------------------------------------------
  // The textarea ref lets the caret-aware mention detection read the current
  // selection start, and lets `pickMention` re-place the cursor after a splice.
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The project's file list — fetched lazily once on the first `@` and cached
  // for the composer's lifetime (re-fetched only if `projectPath` changes).
  const [projectFiles, setProjectFiles] = useState<ProjectFiles>([]);
  const filesFetchedFor = useRef<string | null>(null);

  // The active `@`-mention token under the caret (`null` = dropdown closed),
  // and which filtered row is highlighted.
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // The filtered file rows for the open mention — empty when no mention.
  const mentionMatches = useMemo(
    () => (mention ? filterFiles(projectFiles, mention.query) : []),
    [mention, projectFiles],
  );
  const mentionOpen = mention !== null && mentionMatches.length > 0;

  /**
   * Lazily fetch the project file list for the `@`-picker. Fetched once per
   * `projectPath`; a fetch failure leaves the list empty (the dropdown simply
   * shows nothing) — `@` mentioning is a convenience, never a hard dependency.
   */
  const ensureProjectFiles = useCallback(async () => {
    if (!projectPath || filesFetchedFor.current === projectPath) return;
    filesFetchedFor.current = projectPath;
    try {
      const files = await invoke<ProjectFiles>("list_project_files", { projectPath });
      setProjectFiles(files);
    } catch {
      // A missing/unreadable project leaves the picker empty — non-fatal.
      setProjectFiles([]);
    }
  }, [projectPath]);

  /**
   * Re-evaluate the `@`-mention state from the textarea's current value +
   * caret. Called on every change / key / click so the dropdown opens, tracks
   * the query, and closes exactly as the caret moves.
   */
  const syncMention = useCallback(
    (value: string, caret: number) => {
      // No project → no file pool → `@` is just a literal character.
      if (!projectPath) {
        setMention(null);
        return;
      }
      const ctx = detectMention(value, caret);
      setMention(ctx);
      setMentionIndex(0);
      if (ctx) void ensureProjectFiles();
    },
    [projectPath, ensureProjectFiles],
  );

  /** Textarea `onChange` — update the draft AND re-evaluate the mention. */
  function handleDraftChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setDraft(value);
    syncMention(value, e.target.selectionStart ?? value.length);
  }

  /**
   * Insert the picked file path as an `@<path>` token, replacing the active
   * mention span, then close the dropdown and re-place the caret past the
   * inserted token.
   */
  function pickMention(path: string) {
    if (!mention) return;
    const ta = textareaRef.current;
    const caret = ta?.selectionStart ?? draft.length;
    const { text, caret: nextCaret } = applyMention(draft, mention, path, caret);
    setDraft(text);
    setMention(null);
    setMentionIndex(0);
    // Re-place the caret after React commits the new value.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function handleCompose() {
    const prompt = draft.trim();
    if (!prompt || !actionEnabled) return;
    if (isCreate) {
      onCreate(prompt, {
        eidolonName: selectedEidolon,
        permissionMode,
        model,
        thinkingEffort,
      });
    } else {
      onSend(prompt);
    }
    setDraft("");
  }

  /** Flip the Enter-to-send preference and persist it (P7). */
  function toggleEnterToSend() {
    setEnterToSendState((prev) => {
      const next = !prev;
      setEnterToSend(next);
      return next;
    });
  }

  /**
   * P7 — composer-scoped Esc → cancel the in-flight turn. Bound on the
   * composer WRAPPER (not the textarea) so it still fires while the textarea
   * is disabled mid-turn, yet stays scoped to the composer so it never
   * surprises the user from an unrelated input.
   */
  function handleComposerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && turnRunning) {
      e.preventDefault();
      onCancel();
    }
  }

  /**
   * P7/P9 — textarea key handling.
   *
   * When the `@`-mention dropdown is OPEN it OWNS the navigation keys: ↑/↓ move
   * the highlighted row, Enter / Tab pick it, Esc dismisses — and the
   * compose/send behaviour is suppressed so Enter never sends mid-pick. When
   * the dropdown is CLOSED the v0.4.3 behaviour is unchanged: ⌘/Ctrl+Enter
   * composes, plus plain Enter when the Enter-to-send preference is on.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // --- P9: the open mention dropdown captures navigation keys first. ---
    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionMatches[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key !== "Enter") return;

    // P7 — Enter-to-send ON: plain Enter sends, Shift+Enter is a newline.
    if (enterToSend && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      handleCompose();
      return;
    }

    // Cmd/Ctrl+Enter always composes — newline stays the default Enter
    // behaviour when the Enter-to-send preference is OFF.
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      handleCompose();
    }
  }

  /**
   * P9 — re-evaluate the mention after a caret-moving interaction that is NOT
   * a value change (arrow keys, clicks): the caret may have entered or left an
   * `@` token without the draft text changing.
   */
  function handleCaretSync(e: { currentTarget: HTMLTextAreaElement }) {
    const ta = e.currentTarget;
    syncMention(ta.value, ta.selectionStart ?? ta.value.length);
  }

  // The textarea is disabled only when a follow-up turn cannot be sent. In
  // create mode it stays editable even while blocked — the user can type, then
  // pick a project — so the blocked reason is shown, not a dead textarea.
  const inputDisabled = !isCreate && !canSend;

  // P7 — the send hint mirrors the active Enter-to-send preference.
  const sendHint = enterToSend ? "↵ to send" : "⌘↵ to send";
  const placeholder = isCreate
    ? `Describe what you want to do… (${enterToSend ? "↵" : "⌘↵"} to start a session)`
    : canSend
      ? `Reply to the Eidolon… (${sendHint})`
      : "Waiting for the current turn…";

  const actionLabel = isCreate ? "Start session" : "Send";

  return (
    <div className="session-composer" onKeyDown={handleComposerKeyDown}>
      {/* create-mode blocked affordance (spec §5 step 3) */}
      {isCreate && !createReady && cwdBlockedReason && (
        <p className="session-composer-blocked" role="alert">
          <span aria-hidden="true">⚠ </span>
          {cwdBlockedReason}
        </p>
      )}

      {/* P9 — the textarea + its `@`-mention dropdown share a positioned
          wrapper so the dropdown anchors directly above the input. */}
      <div className="session-composer-input-wrap">
        <textarea
          ref={textareaRef}
          className="session-composer-input"
          placeholder={placeholder}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleKeyDown}
          onClick={handleCaretSync}
          disabled={inputDisabled}
          rows={3}
          aria-label={isCreate ? "New session prompt" : "Follow-up turn prompt"}
        />

        {/* P9 — the @-file mention dropdown. Open only while the caret sits in
            an `@` token AND the project's file list has matches. */}
        {mentionOpen && (
          <ul className="session-mention-list" aria-label="Project files">
            {mentionMatches.map((path, i) => (
              <li key={path}>
                <button
                  type="button"
                  className="session-mention-row"
                  data-active={i === mentionIndex}
                  // `onMouseDown` (not `onClick`) so the pick fires before the
                  // textarea loses focus — a blur would otherwise close the
                  // dropdown first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(path);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <span className="session-mention-glyph" aria-hidden="true">
                    @
                  </span>
                  {path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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

              {/* R3 — the model is chosen at launch and pinned for the
                  session; `claude` resolves the aliases CLI-side. */}
              <div className="session-field">
                <label className="session-field-label" htmlFor="composer-model-select">
                  Model
                </label>
                <select
                  id="composer-model-select"
                  className="session-select"
                  value={model}
                  onChange={(e) => onSelectModel(e.target.value)}
                  aria-label="Select the model"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* R3 — thinking effort. The leading "" option lets claude's
                  own default apply (no `--effort` flag). */}
              <div className="session-field">
                <label className="session-field-label" htmlFor="composer-effort-select">
                  Thinking effort
                </label>
                <select
                  id="composer-effort-select"
                  className="session-select"
                  value={thinkingEffort}
                  onChange={(e) => onSelectThinkingEffort(e.target.value)}
                  aria-label="Select the thinking effort"
                >
                  <option value="">Default (claude picks)</option>
                  {EFFORT_OPTIONS.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="session-composer-actions">
        {/* R5 — approximate token estimate of the draft; `~` + a thousands
            separator make clear it is a ballpark, not an exact count. */}
        <span
          className="session-composer-estimate"
          title="Approximate token count of your draft — an estimate, not exact"
        >
          ~{tokenEstimate.toLocaleString("en-US")} tokens
        </span>

        {/* P7 — the Enter-to-send preference toggle. Persisted to localStorage;
            flips plain-Enter between "send" and "newline". */}
        <label
          className="session-enter-pref"
          title="When on, Enter sends and Shift+Enter is a newline"
        >
          <input
            type="checkbox"
            className="session-enter-pref-box"
            checked={enterToSend}
            onChange={toggleEnterToSend}
            aria-label="Enter sends the message"
          />
          <span className="session-enter-pref-label">Enter to send</span>
        </label>

        {/* P1 — a prominent Stop control while a turn streams. It REPLACES
            Send mid-turn (the only useful action then) and calls
            `store.cancel(sessionId)` via `onCancel`. */}
        {turnRunning ? (
          <button
            type="button"
            className="session-stop-btn"
            onClick={onCancel}
            aria-label="Stop the running turn"
          >
            <span className="session-stop-glyph" aria-hidden="true">
              ■
            </span>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="session-send-btn"
            onClick={handleCompose}
            disabled={!actionEnabled || draft.trim().length === 0}
            aria-label={isCreate ? "Start the session" : "Send follow-up turn"}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
