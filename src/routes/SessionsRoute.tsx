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
//
// Story S4 — cortex-default launch (TRANCE-lite): the picker's pre-selected
// default is the synthetic "Cortex (default)" entry. Creating a cortex session
// reads `.eidolons/cortex/EIDOLONS.md` (the routing descriptor) as the
// `appendSystemPrompt` and sets `isCortex: true` so `claude` self-routes across
// the project's Eidolons; picking a NAMED Eidolon instead is the explicit
// opt-in override (its `agent.md`, `isCortex: false`), exactly as S3 shipped.

import { RouteHeader } from "@/components/RouteHeader";
import { AssistantText } from "@/components/session/AssistantText";
import { ContextGauge } from "@/components/session/ContextGauge";
import { RawNdjsonToggle } from "@/components/session/RawNdjsonToggle";
import { ResultCard } from "@/components/session/ResultCard";
import { SessionCard } from "@/components/session/SessionCard";
import { SessionComposer } from "@/components/session/SessionComposer";
import { SessionList } from "@/components/session/SessionList";
import { ThinkingBlock } from "@/components/session/ThinkingBlock";
import { ToolUseChip } from "@/components/session/ToolUseChip";
import type { ProjectEidolon } from "@/lib/eidolon.types";
import { CORTEX_EIDOLON_NAME, readProjectRoster } from "@/lib/eidolonRoster";
import { getRailCollapsed, setRailCollapsed } from "@/lib/railStore";
import type {
  ContentBlock,
  ParsedAssistant,
  ParsedInit,
  ParsedResult,
  ParsedUser,
} from "@/lib/session.types";
import type { TranscriptEntry, UseSessionResult } from "@/lib/useSession";
import { useSession } from "@/lib/useSession";
import type { SessionLiveState, SessionSlice, UseSessionsResult } from "@/lib/useSessions";
import { getRoute } from "@/routes/index";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
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

  // P2: the `.session-detail` div is the `overflow-y:auto` scroll container —
  // `DetailPane` reads this ref for stick-to-bottom transcript autoscroll.
  const detailScrollRef = useRef<HTMLDivElement>(null);

  // The Roster "Launch" handoff name comes from the store (S2).
  const initialEidolonName = store.pendingEidolon;

  // Composer create-mode form state. The Eidolon picker + permission select
  // are now an optional disclosure inside the composer (story S3).
  //
  // S4: the roster's FIRST entry is always the synthetic "Cortex (default)"
  // option, and `selectedName` defaults to its sentinel — the zero-effort
  // type-and-send path. A Roster "Launch" handoff still overrides it.
  const [eidolons, setEidolons] = useState<ProjectEidolon[]>([]);
  const [eidolonsLoaded, setEidolonsLoaded] = useState(false);
  const [selectedName, setSelectedName] = useState<string>(
    initialEidolonName ?? CORTEX_EIDOLON_NAME,
  );
  const [permissionMode, setPermissionMode] = useState<string>("default");
  const [createError, setCreateError] = useState<string | null>(null);

  // R1: the left rail can collapse to a thin strip so the chat pane takes the
  // full width. The bit is persisted to `localStorage` (gambit: key prefix) so
  // the choice survives a reload — seeded lazily from the stored value.
  const [railCollapsed, setRailCollapsedState] = useState<boolean>(getRailCollapsed);

  /** Flip the rail collapsed bit and persist it. */
  function toggleRail() {
    setRailCollapsedState((prev) => {
      const next = !prev;
      setRailCollapsed(next);
      return next;
    });
  }

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
      setSelectedName(CORTEX_EIDOLON_NAME);
      return;
    }

    let cancelled = false;
    setEidolonsLoaded(false);
    // S4: the roster is Cortex-prepended — entry[0] is "Cortex (default)",
    // named project Eidolons follow as explicit opt-in overrides.
    readProjectRoster(rosterPath)
      .then((roster) => {
        if (cancelled) return;
        setEidolons(roster);
        // Prefer the Roster handoff name when it matches a project Eidolon,
        // else keep any prior selection, else fall back to the Cortex default
        // (always roster[0]) — never auto-pick a named Eidolon.
        const handoff =
          initialEidolonName && roster.some((e) => e.name === initialEidolonName)
            ? initialEidolonName
            : "";
        setSelectedName((prev) => handoff || prev || roster[0]?.name || CORTEX_EIDOLON_NAME);
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

    // The FRONTEND resolves the persona text. For a NAMED Eidolon this is its
    // `agent.md`; for the synthetic "Cortex (default)" entry it is the cortex
    // routing descriptor (`.eidolons/cortex/EIDOLONS.md`) — both reached via
    // `agentMdPath`, so a single `readTextFile` covers both (story S4).
    let appendSystemPrompt = "";
    let allowedTools: string[] = [];
    const eidolon = eidolons.find((e) => e.name === opts.eidolonName) ?? selectedEidolon;
    // `isCortex` keys the launch path off the chosen entry's marker — true
    // only for the synthetic Cortex entry, false for every named Eidolon.
    const isCortex = eidolon?.isCortex === true;

    // A cortex entry whose descriptor is missing must not start a session —
    // it would launch with an empty system prompt and no routing at all.
    if (isCortex && eidolon?.unavailable === true) {
      setCreateError(
        `Cannot start a Cortex session — ${eidolon.agentMdPath} not found. Pick a specific Eidolon under Options instead.`,
      );
      return;
    }

    if (eidolon) {
      // Cortex routing is dynamic — the routed Eidolons carry their own tool
      // contracts — so a cortex session takes claude's default (permissive)
      // tool posture: leave `allowedTools` empty rather than over-restrict.
      allowedTools = isCortex ? [] : eidolon.allowedTools;
      try {
        appendSystemPrompt = await readTextFile(eidolon.agentMdPath);
      } catch {
        // Persona/descriptor unreadable — surface a note. A cortex session
        // with no descriptor is pointless, so abort it; a named Eidolon may
        // still proceed with an empty persona (matches S3 behaviour).
        if (isCortex) {
          setCreateError(`Could not read ${eidolon.agentMdPath} — Cortex session not started.`);
          return;
        }
        setCreateError(
          `Could not read ${eidolon.agentMdPath} — launching without a persona prompt.`,
        );
      }
    }

    // `start` ADDS a session to the store and returns its id — select it so
    // the detail pane opens. The resolved cwd is pinned here, before turn 1.
    const newId = await store.start({
      projectPath: cwd.path,
      // A cortex session carries no named-Eidolon identity (eidolonName "").
      eidolonName: isCortex ? "" : (eidolon?.name ?? ""),
      permissionMode,
      appendSystemPrompt,
      allowedTools,
      firstPrompt: prompt,
      isCortex,
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

      <div className="session-shell-body" data-collapsed={String(railCollapsed)}>
        <SessionList
          sessions={store.sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelect}
          onNewSession={() => setActiveSessionId(null)}
          onRemove={(id) => {
            void store.remove(id);
            if (id === activeSessionId) setActiveSessionId(null);
          }}
          collapsed={railCollapsed}
        />

        <button
          type="button"
          className="session-rail-toggle"
          onClick={toggleRail}
          aria-label={railCollapsed ? "Expand the sessions rail" : "Collapse the sessions rail"}
          aria-expanded={!railCollapsed}
          title={railCollapsed ? "Expand sessions" : "Collapse sessions"}
        >
          <span className="session-rail-toggle-chevron" data-collapsed={String(railCollapsed)}>
            ‹
          </span>
        </button>

        <div className="session-detail" ref={detailScrollRef}>
          {activeSessionId !== null && session.status !== "idle" ? (
            <DetailPane
              session={session}
              slice={store.sessions[activeSessionId] ?? null}
              scrollRef={detailScrollRef}
            />
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
  /**
   * The raw store slice for the open session — the `ContextGauge` reads its
   * cumulative usage / cost off it (story S5). `null` is tolerated and renders
   * a neutral empty gauge.
   */
  slice: SessionSlice | null;
  /**
   * The `.session-detail` `overflow-y:auto` scroll container — P2 stick-to-
   * bottom autoscroll observes its scroll position and re-pins it.
   */
  scrollRef: React.RefObject<HTMLDivElement>;
}

/** Px from the bottom within which the transcript counts as "stuck to bottom". */
const STICK_THRESHOLD_PX = 80;

function DetailPane({ session, slice, scrollRef }: DetailPaneProps) {
  const { status, transcript, sessionInfo, live } = session;

  // P2: stick-to-bottom autoscroll. `atBottom` tracks whether the user is at
  // (or near) the bottom; while true the transcript follows new content, while
  // false a "jump to latest" pill re-engages it. Mirrors `LogPane.tsx`'s
  // auto-scroll-with-pause-on-scroll-up pattern (a scroll handler flips a
  // bit; an effect re-pins on content change).
  const [atBottom, setAtBottom] = useState(true);

  // Re-pin to the bottom whenever the transcript grows or the live buffer
  // streams — but only while the user has not scrolled up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: live.streamingText / toolCalls drive the streaming re-pin
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.length, live.streamingText, live.toolCalls, atBottom, scrollRef]);

  // Pause / resume autoscroll from the user's scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  /** Re-engage autoscroll — jump to the newest content. */
  function jumpToLatest() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }

  // Model + tools come from the `init` event once it lands.
  const init = useMemo(() => {
    const entry = transcript.find((e) => e.kind === "init" && e.parsed);
    if (!entry?.parsed) return null;
    return (entry.parsed as ParsedInit).Init;
  }, [transcript]);

  const turns = useMemo(() => groupByTurn(transcript), [transcript]);
  const toolResults = useMemo(() => indexToolResults(transcript), [transcript]);

  // S4: a cortex-routed session carries no named-Eidolon identity — label it
  // "Cortex" with a routing role rather than the generic "Eidolon" fallback.
  const isCortex = sessionInfo?.isCortex === true;
  const eidolonName = isCortex ? "Cortex" : sessionInfo?.eidolonName || "Eidolon";
  const turnRunning = status === "turn-running" || status === "launching";
  const canSend = status === "awaiting-input";
  // The Eidolon role line is not carried on `SessionInfo` — left blank for a
  // named Eidolon (the v0.3.0 pre-launch panel sourced it from the picked
  // `ProjectEidolon`, which the list<->detail shell no longer threads in). A
  // cortex session gets a static routing role so the header reads correctly.
  const eidolonRole = isCortex ? "Self-routing across the project's Eidolons" : "";

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

      {/* S5: always-visible context-temperature gauge — recomputes on each
          `result` (the slice's transcript changes); never polls. */}
      <ContextGauge slice={slice} />

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
          <LiveTurn live={live} eidolonName={eidolonName} toolResults={toolResults} />
        )}
      </div>

      {/* P2: jump-to-latest pill — shown only while autoscroll is paused
          (the user has scrolled up). Re-engages stick-to-bottom on click. */}
      {!atBottom && (
        <button
          type="button"
          className="session-jump-latest"
          onClick={jumpToLatest}
          aria-label="Jump to latest"
        >
          <span className="session-jump-latest-glyph" aria-hidden="true">
            ↓
          </span>
          Jump to latest
        </button>
      )}

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
// LiveTurn — the in-flight turn rendered from EPHEMERAL live state (story S6)
// ---------------------------------------------------------------------------

interface LiveTurnProps {
  /** The session's ephemeral live state for the in-flight turn. */
  live: SessionLiveState;
  eidolonName: string;
  /** `tool_result` index — a live chip resolves early if its result lands. */
  toolResults: Map<string, { text: string; isError: boolean }>;
}

/**
 * Render the in-flight turn from the store's EPHEMERAL `live` state: the
 * streaming assistant text (token-by-token) and the live `ToolUseChip`s
 * (spinner + elapsed time). On `session-turn-complete` the store CLEARS
 * `live`, and the persisted `assistant` / `user` cards re-render the turn —
 * so this component and the persisted cards never both show the same text.
 *
 * Self-routed-subagent tools (a non-null `parentToolUseId`) render NESTED
 * under a subagent group; top-level tools render flush. This is what makes
 * cortex / TRANCE self-routing visible mid-turn.
 */
function LiveTurn({ live, eidolonName, toolResults }: LiveTurnProps) {
  const calls = Object.values(live.toolCalls);
  const topLevel = calls.filter((c) => !c.parentToolUseId);
  const nested = calls.filter((c) => c.parentToolUseId);
  const hasText = live.streamingText.length > 0;
  const hasTools = calls.length > 0;

  // Nothing has streamed yet — keep the cozy "working…" affordance.
  if (!hasText && !hasTools) {
    return (
      <div className="session-pending" aria-live="polite" aria-busy="true">
        <span className="session-pending-glyph" aria-hidden="true">
          ⬡
        </span>
        <span>{eidolonName} is working…</span>
      </div>
    );
  }

  const renderChip = (call: SessionLiveState["toolCalls"][string]) => {
    // A live chip resolves early if its `tool_result` already landed in the
    // persisted transcript (the paired `user` event can arrive before the
    // turn completes).
    const result = toolResults.get(call.toolUseId);
    return (
      <ToolUseChip
        key={call.toolUseId}
        name={call.toolName}
        input={call.partialInput ? safeParse(call.partialInput) : undefined}
        result={result}
        running={!result}
        startedAt={call.startedAt}
        subagent={Boolean(call.parentToolUseId)}
      />
    );
  };

  return (
    <div className="session-turn session-turn-live" aria-live="polite" aria-busy="true">
      <div className="session-turn-marker">Turn {live.turn} · live</div>
      {hasText && (
        <AssistantText eidolonName={eidolonName} text={live.streamingText} streaming={true} />
      )}
      {topLevel.map(renderChip)}
      {nested.length > 0 && (
        <div className="session-subagent-group" aria-label="Self-routed subagent activity">
          <div className="session-subagent-label">Subagent activity</div>
          {nested.map(renderChip)}
        </div>
      )}
    </div>
  );
}

/** Best-effort JSON parse of an accumulated `partial_json` string. */
function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The streamed JSON may still be incomplete — show the raw fragment.
    return text;
  }
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
