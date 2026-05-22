// SessionsRoute.tsx — the user-facing "Sessions" surface.
//
// Story S3 restructures the route from a 3-state single-session screen into a
// LIST<->DETAIL shell:
//
//   * no project        — empty state, mirrors sibling routes.
//   * list<->detail      — a persistent left rail (`SessionList`: every session
//                          + a "New session" button) beside a detail pane.
//       - a session selected → the turn-grouped card pipeline + composer.
//       - none selected      → the composer in CREATE mode, centered.
//
// The v0.3.1 pre-launch FORM is GONE: the composer ("a common chatting place")
// both creates a session and sends every turn. With no session selected, ⌘↵
// creates one and that text is turn 1; the Eidolon picker + permission-mode
// select collapse into the composer's optional disclosure panel.
//
// cwd resolution (FORGE-mandated, spec §5) — before a composer-created
// session's turn 1, an absolute `project_path` is resolved, ordered:
//   1. the currently-selected project (`projectPath` prop), if non-null;
//   2. else the `projectPath` of the most-recently-active existing session;
//   3. else a blocked "select a project first" state.
// A session is NEVER created without a resolved absolute `project_path`; the
// resolved path is passed in `start`'s params and pinned for the session life.
//
// The FRONTEND supplies the persona text: a create reads the chosen Eidolon's
// `agent.md` and passes its full content as `appendSystemPrompt`.

import { RouteHeader } from "@/components/RouteHeader";
import { AssistantText } from "@/components/session/AssistantText";
import { RawNdjsonToggle } from "@/components/session/RawNdjsonToggle";
import { ResultCard } from "@/components/session/ResultCard";
import { SessionCard } from "@/components/session/SessionCard";
import { SessionComposer } from "@/components/session/SessionComposer";
import { SessionList } from "@/components/session/SessionList";
import { ThinkingBlock } from "@/components/session/ThinkingBlock";
import { ToolUseChip } from "@/components/session/ToolUseChip";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import { readProjectEidolons } from "@/lib/eidolonRoster";
import type {
  ContentBlock,
  ParsedAssistant,
  ParsedInit,
  ParsedResult,
  ParsedUser,
} from "@/lib/session.types";
import type { TranscriptEntry, UseSessionResult } from "@/lib/useSession";
import { useSession } from "@/lib/useSession";
import type { SessionSlice, UseSessionsResult } from "@/lib/useSessions";
import { getRoute } from "@/routes/index";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
import "@/components/session/session.css";
import "./SessionsRoute.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTE = getRoute("sessions");

/** `--permission-mode` options surfaced in the composer's options panel. */
const PERMISSION_MODES = ["default", "plan", "acceptEdits", "dontAsk", "bypassPermissions"];

// ---------------------------------------------------------------------------
// cwd resolution (spec §5)
// ---------------------------------------------------------------------------

/** The outcome of resolving the cwd for a composer-created session. */
interface CwdResolution {
  /** The resolved absolute project path, or `null` when none could be found. */
  path: string | null;
  /** Which §5 rule produced the path — for diagnostics / tests. */
  source: "selected-project" | "recent-session" | "none";
}

/**
 * Resolve the absolute `project_path` a composer-created session pins, per the
 * FORGE-mandated §5 order: selected project → most-recently-active session's
 * project → none. Pure so it is directly unit-testable.
 *
 * A `null` `path` means rule 3 — the composer is blocked; no session is ever
 * created without a resolved absolute path.
 */
export function resolveCwd(
  projectPath: string | null,
  sessions: Record<string, SessionSlice>,
): CwdResolution {
  // Rule 1 — the currently-selected project.
  if (projectPath && projectPath.trim().length > 0) {
    return { path: projectPath, source: "selected-project" };
  }

  // Rule 2 — the project of the most-recently-active existing session.
  let bestPath: string | null = null;
  let bestStamp = Number.NEGATIVE_INFINITY;
  for (const slice of Object.values(sessions)) {
    const candidate = slice.summary?.projectPath || slice.sessionInfo?.projectPath || "";
    if (!candidate) continue;
    const iso =
      slice.summary?.lastActiveAt ?? slice.summary?.createdAt ?? slice.sessionInfo?.createdAt ?? "";
    const stamp = Date.parse(iso);
    const ms = Number.isNaN(stamp) ? 0 : stamp;
    if (ms >= bestStamp) {
      bestStamp = ms;
      bestPath = candidate;
    }
  }
  if (bestPath) {
    return { path: bestPath, source: "recent-session" };
  }

  // Rule 3 — no project selected AND no prior session: blocked.
  return { path: null, source: "none" };
}

// ---------------------------------------------------------------------------
// Transcript-grouping helpers
// ---------------------------------------------------------------------------

/** A transcript sliced into per-turn groups for turn-by-turn rendering. */
interface TurnGroup {
  turn: number;
  entries: TranscriptEntry[];
}

/** Group an append-only transcript into ascending turn buckets. */
function groupByTurn(transcript: TranscriptEntry[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const entry of transcript) {
    let group = groups.find((g) => g.turn === entry.turn);
    if (!group) {
      group = { turn: entry.turn, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  groups.sort((a, b) => a.turn - b.turn);
  return groups;
}

/** Stringify a `tool_result` block's `content` (string or nested-block array). */
function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as ContentBlock;
        if (typeof b?.text === "string") return b.text;
        try {
          return JSON.stringify(block);
        } catch {
          return String(block);
        }
      })
      .join("\n");
  }
  if (content === undefined || content === null) return "";
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/** Index every `tool_result` block in the transcript by its `toolUseId`. */
function indexToolResults(
  transcript: TranscriptEntry[],
): Map<string, { text: string; isError: boolean }> {
  const map = new Map<string, { text: string; isError: boolean }>();
  for (const entry of transcript) {
    if (entry.source !== "event" || entry.kind !== "user" || !entry.parsed) continue;
    const user = entry.parsed as ParsedUser;
    for (const block of user.User?.content ?? []) {
      if (block.blockType === "tool_result" && block.toolUseId) {
        map.set(block.toolUseId, {
          text: stringifyToolResult(block.content),
          isError: Boolean(block.isError),
        });
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionsRouteProps {
  projectPath: string | null;
  /**
   * The multi-session store, lifted to the App shell and prop-drilled in.
   * Living above the router is WHAT keeps a session's transcript alive across
   * a route change (story S2 — the transcript-loss bug fix).
   */
  store: UseSessionsResult;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function SessionsRoute({ projectPath, store }: SessionsRouteProps) {
  // S3: the route is a list<->detail shell. `activeSessionId` selects the
  // detail session; `null` puts the composer into create mode.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const session = useSession(store, activeSessionId);

  // The Roster "Launch" handoff name comes from the store (S2).
  const initialEidolonName = store.pendingEidolon;

  // Composer create-mode form state. The Eidolon picker + permission select
  // are now an optional disclosure inside the composer (story S3).
  const [eidolons, setEidolons] = useState<ProjectEidolon[]>([]);
  const [eidolonsLoaded, setEidolonsLoaded] = useState(false);
  const [selectedName, setSelectedName] = useState<string>(initialEidolonName ?? "");
  const [permissionMode, setPermissionMode] = useState<string>("default");
  const [createError, setCreateError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // cwd resolution (spec §5) — the path a composer-created session pins.
  // -------------------------------------------------------------------------
  const cwd = useMemo(() => resolveCwd(projectPath, store.sessions), [projectPath, store.sessions]);

  // The Eidolon roster loads from whichever project the cwd resolution landed
  // on — the selected project, or the most-recent session's project (so the
  // picker is populated even with no project selected but prior sessions).
  const rosterPath = cwd.path;

  // Load the project's Eidolons + run the auth pre-flight when a project opens.
  useEffect(() => {
    if (!rosterPath) {
      setEidolons([]);
      setEidolonsLoaded(false);
      setSelectedName("");
      return;
    }

    let cancelled = false;
    setEidolonsLoaded(false);
    readProjectEidolons(rosterPath)
      .then((roster) => {
        if (cancelled) return;
        setEidolons(roster);
        // Prefer the Roster handoff name when it matches a project Eidolon,
        // else keep any prior selection, else auto-select the first.
        const handoff =
          initialEidolonName && roster.some((e) => e.name === initialEidolonName)
            ? initialEidolonName
            : "";
        setSelectedName((prev) => handoff || prev || roster[0]?.name || "");
      })
      .catch(() => {
        if (!cancelled) setEidolons([]);
      })
      .finally(() => {
        if (!cancelled) setEidolonsLoaded(true);
      });

    // Pre-flight the `claude` login so the create gate is ready.
    store.checkAuth();

    return () => {
      cancelled = true;
    };
    // store.checkAuth is a stable useCallback; rosterPath drives the reload,
    // initialEidolonName re-runs the load so a fresh handoff re-seeds the pick.
  }, [rosterPath, initialEidolonName]);

  const selectedEidolon = useMemo(
    () => eidolons.find((e) => e.name === selectedName) ?? null,
    [eidolons, selectedName],
  );

  // The create action is ready only when the cwd resolved AND `claude` is
  // logged in (spec §5 step 3 — no session without a resolved abs path).
  const loggedIn = store.authStatus?.loggedIn === true;
  const createReady = cwd.path !== null && loggedIn;

  /** The human reason create is blocked — empty when ready. */
  const cwdBlockedReason = useMemo(() => {
    if (cwd.path === null) {
      return "Select a project folder from the sidebar to start a session.";
    }
    if (!loggedIn && store.authStatus) {
      return store.authStatus.detail || "Not logged in to claude — run `claude` once to log in.";
    }
    return "";
  }, [cwd.path, loggedIn, store.authStatus]);

  // -------------------------------------------------------------------------
  // Composer actions
  // -------------------------------------------------------------------------

  /**
   * Create a session from the composer (create mode) and dispatch turn 1.
   *
   * cwd resolution (§5) has ALREADY run — `cwd.path` is the resolved absolute
   * path, immutably pinned into the session via `start`'s `projectPath`. The
   * create is BLOCKED when `cwd.path` is `null`, so a session is never started
   * without a resolved absolute project path.
   */
  async function handleCreate(prompt: string, opts: { eidolonName: string }) {
    // §5 P0 gate — never create without a resolved absolute project path.
    if (cwd.path === null) return;
    setCreateError(null);

    // The FRONTEND resolves the persona text — read the chosen Eidolon's
    // agent.md and pass its full content as appendSystemPrompt.
    let appendSystemPrompt = "";
    let allowedTools: string[] = [];
    const eidolon = eidolons.find((e) => e.name === opts.eidolonName) ?? selectedEidolon;
    if (eidolon) {
      allowedTools = eidolon.allowedTools;
      try {
        appendSystemPrompt = await readTextFile(eidolon.agentMdPath);
      } catch {
        // agent.md unreadable — proceed with an empty persona; surface a note.
        setCreateError(
          `Could not read ${eidolon.agentMdPath} — launching without a persona prompt.`,
        );
      }
    }

    // `start` ADDS a session to the store and returns its id — select it so
    // the detail pane opens. The resolved cwd is pinned here, before turn 1.
    const newId = await store.start({
      projectPath: cwd.path,
      eidolonName: eidolon?.name ?? "",
      permissionMode,
      appendSystemPrompt,
      allowedTools,
      firstPrompt: prompt,
    });
    if (newId) {
      setActiveSessionId(newId);
      store.setPendingEidolon(null);
    }
  }

  /** Select a session row — open its detail; reopen it if not yet hydrated. */
  function handleSelect(sessionId: string) {
    setActiveSessionId(sessionId);
    const slice = store.sessions[sessionId];
    if (slice && !slice.hydrated) {
      void store.reopen(sessionId);
    }
  }

  // ------------------------------------------------------------------
  // State 1 — no project AND no prior session: the no-project empty state
  // ------------------------------------------------------------------
  // The shell still renders once a project OR a prior session exists — the
  // empty state is reserved for a truly fresh, project-less app.
  if (!projectPath && Object.keys(store.sessions).length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project selected.</p>
          <p className="route-empty-body">
            Pick a project folder from the sidebar to launch one of its Eidolons as a live session.
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // State 2 — the list<->detail shell
  // ------------------------------------------------------------------
  return (
    <div className="route-pane session-shell">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      <div className="session-shell-body">
        <SessionList
          sessions={store.sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onNewSession={() => setActiveSessionId(null)}
          onRemove={(id) => {
            void store.remove(id);
            if (id === activeSessionId) setActiveSessionId(null);
          }}
        />

        <div className="session-detail">
          {activeSessionId !== null && session.status !== "idle" ? (
            <DetailPane session={session} />
          ) : (
            <CreatePane
              authBlocked={Boolean(store.authStatus) && !loggedIn}
              authDetail={store.authStatus?.detail ?? ""}
              onRecheckAuth={() => store.checkAuth()}
              createError={createError}
              composer={
                <SessionComposer
                  mode="create"
                  canSend={false}
                  turnRunning={false}
                  onSend={() => {}}
                  onCancel={() => {}}
                  onCreate={(prompt, opts) => void handleCreate(prompt, opts)}
                  createReady={createReady}
                  cwdBlockedReason={cwdBlockedReason}
                  resolvedProjectPath={cwd.path}
                  eidolons={eidolons}
                  eidolonsLoaded={eidolonsLoaded}
                  selectedEidolon={selectedName}
                  onSelectEidolon={setSelectedName}
                  permissionModes={PERMISSION_MODES}
                  permissionMode={permissionMode}
                  onSelectPermissionMode={setPermissionMode}
                />
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreatePane — the empty/create detail state, centered on the composer
// ---------------------------------------------------------------------------

interface CreatePaneProps {
  authBlocked: boolean;
  authDetail: string;
  onRecheckAuth: () => void;
  createError: string | null;
  composer: React.ReactNode;
}

function CreatePane({
  authBlocked,
  authDetail,
  onRecheckAuth,
  createError,
  composer,
}: CreatePaneProps) {
  return (
    <div className="session-create">
      <div className="session-create-intro">
        <span className="session-create-glyph" aria-hidden="true">
          ⬡
        </span>
        <p className="session-create-heading">Start a session</p>
        <p className="session-create-body">
          Type what you want to do and press <kbd>⌘↵</kbd> — the session opens on your first
          message. Pick a specific Eidolon under Options, or just send.
        </p>
      </div>

      {authBlocked && (
        <div className="session-auth-banner" data-tone="error" role="alert">
          <span className="session-auth-glyph" aria-hidden="true">
            ⚠
          </span>
          <div className="session-auth-text">
            <strong>Not logged in to claude.</strong>
            <span>
              {authDetail || "Run `claude` once in a terminal to log in."} Starting a session is
              disabled until the `claude` CLI reports a logged-in account.
            </span>
          </div>
          <button
            type="button"
            className="route-verb-btn"
            onClick={onRecheckAuth}
            aria-label="Re-check claude login"
          >
            Re-check
          </button>
        </div>
      )}

      {createError && (
        <p className="session-field-note" data-tone="warn">
          {createError}
        </p>
      )}

      {composer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailPane — transcript + composer for a live (or finished) session
// ---------------------------------------------------------------------------

interface DetailPaneProps {
  session: UseSessionResult;
}

function DetailPane({ session }: DetailPaneProps) {
  const { status, transcript, sessionInfo } = session;

  // Model + tools come from the `init` event once it lands.
  const init = useMemo(() => {
    const entry = transcript.find((e) => e.kind === "init" && e.parsed);
    if (!entry?.parsed) return null;
    return (entry.parsed as ParsedInit).Init;
  }, [transcript]);

  const turns = useMemo(() => groupByTurn(transcript), [transcript]);
  const toolResults = useMemo(() => indexToolResults(transcript), [transcript]);

  const eidolonName = sessionInfo?.eidolonName || "Eidolon";
  const turnRunning = status === "turn-running" || status === "launching";
  const canSend = status === "awaiting-input";
  // The Eidolon role line is not carried on `SessionInfo` — left blank here
  // (the v0.3.0 pre-launch panel sourced it from the picked `ProjectEidolon`,
  // which the list<->detail shell no longer threads into the detail pane).
  const eidolonRole = "";

  return (
    <div className="session-detail-inner">
      <SessionCard
        eidolonName={eidolonName}
        role={eidolonRole}
        permissionMode={sessionInfo?.permissionMode ?? "default"}
        model={init?.model ?? null}
        tools={init?.tools ?? []}
        status={status}
      />

      <div className="session-transcript">
        {turns.map((group) => (
          <div className="session-turn" key={group.turn}>
            <div className="session-turn-marker">Turn {group.turn}</div>
            {group.entries.map((entry, idx) => (
              <TranscriptRow
                key={`${group.turn}-${idx}-${entry.ts}`}
                entry={entry}
                eidolonName={eidolonName}
                toolResults={toolResults}
              />
            ))}
          </div>
        ))}
        {turnRunning && (
          <div className="session-pending" aria-live="polite" aria-busy="true">
            <span className="session-pending-glyph" aria-hidden="true">
              ⬡
            </span>
            <span>{eidolonName} is working…</span>
          </div>
        )}
      </div>

      <RawNdjsonToggle transcript={transcript} />

      <SessionComposer
        mode="detail"
        canSend={canSend}
        turnRunning={turnRunning}
        onSend={(prompt) => session.sendTurn(prompt)}
        onCancel={() => session.cancel()}
        // create-mode props are unused in detail mode — supplied inert.
        onCreate={() => {}}
        createReady={false}
        cwdBlockedReason=""
        resolvedProjectPath={null}
        eidolons={[]}
        eidolonsLoaded={true}
        selectedEidolon=""
        onSelectEidolon={() => {}}
        permissionModes={PERMISSION_MODES}
        permissionMode="default"
        onSelectPermissionMode={() => {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TranscriptRow — render one transcript entry as the appropriate card
// ---------------------------------------------------------------------------

interface TranscriptRowProps {
  entry: TranscriptEntry;
  eidolonName: string;
  toolResults: Map<string, { text: string; isError: boolean }>;
}

function TranscriptRow({ entry, eidolonName, toolResults }: TranscriptRowProps) {
  // stderr — a diagnostics line.
  if (entry.source === "stderr") {
    return <pre className="session-stderr-line">{entry.line}</pre>;
  }

  // Switch on the stable lowercase `kind` discriminator (NOT the enum tag).
  switch (entry.kind) {
    case "assistant": {
      const content = (entry.parsed as ParsedAssistant)?.Assistant?.content ?? [];
      return content.map((block, i) => (
        <AssistantBlock
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional within a stable message
          key={i}
          block={block}
          eidolonName={eidolonName}
          toolResults={toolResults}
        />
      ));
    }
    case "result": {
      const r = (entry.parsed as ParsedResult)?.Result;
      if (!r) return null;
      return (
        <ResultCard
          subtype={r.subtype ?? ""}
          isError={r.isError}
          totalCostUsd={r.totalCostUsd ?? null}
          numTurns={r.numTurns ?? null}
          durationMs={r.durationMs ?? null}
        />
      );
    }
    case "user":
      // `user` events carry tool_result blocks — they are surfaced inline on
      // the paired ToolUseChip, so the row itself renders nothing.
      return null;
    default:
      // init / streamEvent / apiRetry / unknown — not rendered as cards;
      // the raw NDJSON toggle covers them for debugging.
      return null;
  }
}

/** Render one content block of an assistant message. */
function AssistantBlock({
  block,
  eidolonName,
  toolResults,
}: {
  block: ContentBlock;
  eidolonName: string;
  toolResults: Map<string, { text: string; isError: boolean }>;
}) {
  switch (block.blockType) {
    case "text":
      return block.text ? <AssistantText eidolonName={eidolonName} text={block.text} /> : null;
    case "thinking":
      return block.thinking ? <ThinkingBlock thinking={block.thinking} /> : null;
    case "tool_use":
      return (
        <ToolUseChip
          name={block.name ?? "tool"}
          input={block.input}
          result={block.id ? toolResults.get(block.id) : undefined}
        />
      );
    default:
      return null;
  }
}
