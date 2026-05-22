// SessionsRoute.tsx — the user-facing "Sessions" surface.
//
// Drives a live Eidolon session through `useSession` (S6) and renders three
// states:
//
//   1. No project       — empty state, mirrors sibling routes.
//   2. No active session — a PRE-LAUNCH panel: an Eidolon picker populated via
//      `readProjectEidolons` (S3), a `--permission-mode` select, a first-prompt
//      textarea, and a Launch button. R1: the chosen Eidolon's allow-list is
//      shown with a clear "headless mode aborts on an out-of-list tool call"
//      warning. R2: `checkAuth()` gates Launch — a not-logged-in `claude`
//      disables it.
//   3. Active session   — the transcript as Eidolon-themed cards grouped by
//      turn, plus a SessionComposer for follow-up turns.
//
// The FRONTEND supplies the persona text: Launch reads the chosen Eidolon's
// `agent.md` and passes its full content as `appendSystemPrompt` — Rust never
// re-reads it (per S3 / session.types.ts).

import { RouteHeader } from "@/components/RouteHeader";
import { AssistantText } from "@/components/session/AssistantText";
import { RawNdjsonToggle } from "@/components/session/RawNdjsonToggle";
import { ResultCard } from "@/components/session/ResultCard";
import { SessionCard } from "@/components/session/SessionCard";
import { SessionComposer } from "@/components/session/SessionComposer";
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
import type { TranscriptEntry } from "@/lib/useSession";
import { useSession } from "@/lib/useSession";
import { getRoute } from "@/routes/index";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useState } from "react";
import "@/components/session/session.css";
import "./SessionsRoute.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTE = getRoute("sessions");

/** `--permission-mode` options surfaced in the pre-launch select. */
const PERMISSION_MODES = ["default", "plan", "acceptEdits", "dontAsk", "bypassPermissions"];

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
   * S8 — optional Eidolon name to pre-select in the pre-launch picker, set by
   * the Roster's "Launch" handoff. When absent, the picker behaves exactly as
   * S7 shipped it (auto-selects the first project Eidolon).
   */
  initialEidolonName?: string | null;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function SessionsRoute({ projectPath, initialEidolonName }: SessionsRouteProps) {
  const session = useSession();
  const { status, authStatus } = session;

  // Pre-launch panel form state. `selectedName` seeds from the S8 Roster
  // handoff (`initialEidolonName`) when present, else stays empty for the
  // roster-load to auto-select the first Eidolon (S7 behaviour).
  const [eidolons, setEidolons] = useState<ProjectEidolon[]>([]);
  const [eidolonsLoaded, setEidolonsLoaded] = useState(false);
  const [selectedName, setSelectedName] = useState<string>(initialEidolonName ?? "");
  const [permissionMode, setPermissionMode] = useState<string>("default");
  const [firstPrompt, setFirstPrompt] = useState<string>("");
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Load the project's Eidolons + run the auth pre-flight when a project opens.
  useEffect(() => {
    if (!projectPath) {
      setEidolons([]);
      setEidolonsLoaded(false);
      setSelectedName("");
      return;
    }

    let cancelled = false;
    setEidolonsLoaded(false);
    readProjectEidolons(projectPath)
      .then((roster) => {
        if (cancelled) return;
        setEidolons(roster);
        // Prefer the S8 handoff name when it matches a project Eidolon, else
        // keep any prior selection, else auto-select the first (S7 behaviour).
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

    // R2: pre-flight the `claude` login so the Launch gate is ready.
    session.checkAuth();

    return () => {
      cancelled = true;
    };
    // session.checkAuth is a stable useCallback; projectPath drives the reload.
    // initialEidolonName re-runs the load so a fresh S8 handoff re-seeds the pick.
  }, [projectPath, initialEidolonName]);

  const selectedEidolon = useMemo(
    () => eidolons.find((e) => e.name === selectedName) ?? null,
    [eidolons, selectedName],
  );

  // R2: a not-logged-in `claude` disables Launch.
  const loggedIn = authStatus?.loggedIn === true;
  const canLaunch =
    Boolean(projectPath) && Boolean(selectedEidolon) && firstPrompt.trim().length > 0 && loggedIn;

  async function handleLaunch() {
    if (!projectPath || !selectedEidolon) return;
    setLaunchError(null);

    // The FRONTEND resolves the persona text — read the chosen Eidolon's
    // agent.md and pass its full content as appendSystemPrompt.
    let appendSystemPrompt = "";
    try {
      appendSystemPrompt = await readTextFile(selectedEidolon.agentMdPath);
    } catch {
      // agent.md unreadable — proceed with an empty persona rather than abort;
      // surface a soft note so the user knows the persona did not load.
      setLaunchError(
        `Could not read ${selectedEidolon.agentMdPath} — launching without a persona prompt.`,
      );
    }

    session.start({
      projectPath,
      eidolonName: selectedEidolon.name,
      permissionMode,
      appendSystemPrompt,
      allowedTools: selectedEidolon.allowedTools,
      firstPrompt: firstPrompt.trim(),
    });
  }

  // ------------------------------------------------------------------
  // State 1 — no project
  // ------------------------------------------------------------------
  if (!projectPath) {
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
  // State 3 — an active (or just-failed) session: transcript + composer
  // ------------------------------------------------------------------
  const hasSession = status !== "idle";
  if (hasSession) {
    return (
      <ActiveSession session={session} eidolon={selectedEidolon} permissionMode={permissionMode} />
    );
  }

  // ------------------------------------------------------------------
  // State 2 — no active session: the PRE-LAUNCH panel
  // ------------------------------------------------------------------
  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      <div className="session-prelaunch">
        {/* R2 — auth gate */}
        {authStatus && !loggedIn && (
          <div className="session-auth-banner" data-tone="error" role="alert">
            <span className="session-auth-glyph" aria-hidden="true">
              ⚠
            </span>
            <div className="session-auth-text">
              <strong>Not logged in to claude.</strong>
              <span>
                {authStatus.detail || "Run `claude` once in a terminal to log in."} Launch is
                disabled until the `claude` CLI reports a logged-in account.
              </span>
            </div>
            <button
              type="button"
              className="route-verb-btn"
              onClick={() => session.checkAuth()}
              aria-label="Re-check claude login"
            >
              Re-check
            </button>
          </div>
        )}
        {authStatus && loggedIn && (
          <div className="session-auth-banner" data-tone="ok">
            <span className="session-auth-glyph" aria-hidden="true">
              ✓
            </span>
            <div className="session-auth-text">
              <span>{authStatus.detail || "Logged in to claude."}</span>
            </div>
          </div>
        )}

        {/* Eidolon picker */}
        <div className="session-field">
          <label className="session-field-label" htmlFor="session-eidolon-select">
            Eidolon
          </label>
          {eidolonsLoaded && eidolons.length === 0 ? (
            <p className="session-field-note">
              No Eidolons found in this project. Add members to <code>eidolons.yaml</code> first.
            </p>
          ) : (
            <select
              id="session-eidolon-select"
              className="session-select"
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              aria-label="Select an Eidolon to launch"
            >
              {!eidolonsLoaded && <option value="">Loading…</option>}
              {eidolons.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                  {e.role ? ` — ${e.role}` : ""}
                </option>
              ))}
            </select>
          )}
          {selectedEidolon?.description && (
            <p className="session-field-note">{selectedEidolon.description}</p>
          )}
        </div>

        {/* R1 — allow-list + headless-abort warning */}
        {selectedEidolon && (
          <div className="session-allowlist" role="note">
            <div className="session-allowlist-head">
              <span className="session-allowlist-title">Allowed tools</span>
              <span className="session-allowlist-count">
                {selectedEidolon.allowedTools.length} tool
                {selectedEidolon.allowedTools.length === 1 ? "" : "s"}
              </span>
            </div>
            {selectedEidolon.allowedTools.length > 0 ? (
              <div className="session-allowlist-tags">
                {selectedEidolon.allowedTools.map((tool) => (
                  <span key={tool} className="session-tool-tag">
                    {tool}
                  </span>
                ))}
              </div>
            ) : (
              <p className="session-field-note">
                This Eidolon declares no tools — it will run text-only.
              </p>
            )}
            <p className="session-allowlist-warn">
              <span aria-hidden="true">⚠ </span>
              Headless mode: a tool call <strong>outside this allow-list aborts the run</strong>.
              There is no interactive approval in v0.3 — widen the Eidolon's{" "}
              <code>allowed-tools</code> in its <code>agent.md</code> if a turn needs more.
            </p>
          </div>
        )}

        {/* Permission mode */}
        <div className="session-field">
          <label className="session-field-label" htmlFor="session-mode-select">
            Permission mode
          </label>
          <select
            id="session-mode-select"
            className="session-select"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value)}
            aria-label="Select the permission mode"
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>

        {/* First prompt */}
        <div className="session-field">
          <label className="session-field-label" htmlFor="session-first-prompt">
            First prompt
          </label>
          <textarea
            id="session-first-prompt"
            className="session-composer-input"
            placeholder="What should the Eidolon do first?"
            value={firstPrompt}
            onChange={(e) => setFirstPrompt(e.target.value)}
            rows={4}
            aria-label="First prompt for the session"
          />
        </div>

        {launchError && (
          <p className="session-field-note" data-tone="warn">
            {launchError}
          </p>
        )}

        {/* Launch */}
        <div className="session-prelaunch-actions">
          <button
            type="button"
            className="session-send-btn"
            onClick={() => void handleLaunch()}
            disabled={!canLaunch}
            aria-label="Launch the Eidolon session"
          >
            Launch session
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveSession — transcript + composer for a live (or finished) session
// ---------------------------------------------------------------------------

interface ActiveSessionProps {
  session: ReturnType<typeof useSession>;
  eidolon: ProjectEidolon | null;
  permissionMode: string;
}

function ActiveSession({ session, eidolon, permissionMode }: ActiveSessionProps) {
  const { status, transcript, sessionInfo } = session;

  // Model + tools come from the `init` event once it lands.
  const init = useMemo(() => {
    const entry = transcript.find((e) => e.kind === "init" && e.parsed);
    if (!entry?.parsed) return null;
    return (entry.parsed as ParsedInit).Init;
  }, [transcript]);

  const turns = useMemo(() => groupByTurn(transcript), [transcript]);
  const toolResults = useMemo(() => indexToolResults(transcript), [transcript]);

  const eidolonName = sessionInfo?.eidolonName ?? eidolon?.name ?? "Eidolon";
  const turnRunning = status === "turn-running" || status === "launching";
  const canSend = status === "awaiting-input";

  return (
    <div className="route-pane">
      <div className="session-active-head">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <button
          type="button"
          className="route-verb-btn"
          onClick={() => session.clear()}
          aria-label="End the session and return to the launcher"
        >
          End session
        </button>
      </div>

      <SessionCard
        eidolonName={eidolonName}
        role={eidolon?.role ?? ""}
        permissionMode={sessionInfo?.permissionMode ?? permissionMode}
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
        canSend={canSend}
        turnRunning={turnRunning}
        onSend={(prompt) => session.sendTurn(prompt)}
        onCancel={() => session.cancel()}
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
