// SessionList.tsx — the Sessions-route left rail.
//
// Story S3 turns `SessionsRoute` into a list<->detail shell. This component is
// the persistent LIST half: every known session (live, persisted, or
// summary-only) rendered as a selectable row, plus a "New session" button at
// the top that drops the route into create mode.
//
// Each row shows the session's title, an Eidolon/cortex badge, a status dot,
// and a relative last-active time. A per-row delete affordance calls
// `store.remove(id)` (which deletes the on-disk record and drops it from the
// map). Rows are sorted most-recently-active first.

import type { SessionSlice } from "@/lib/useSessions";
import "./SessionList.css";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort display title for a session row.
 *
 * Prefers the persisted summary title; falls back to the synthesised
 * `SessionInfo` Eidolon name, then a generic label — a just-created session
 * has no summary until its first per-turn flush lands.
 */
function rowTitle(slice: SessionSlice): string {
  const t = slice.summary?.title?.trim();
  if (t) return t;
  const eidolon = slice.sessionInfo?.eidolonName?.trim();
  if (eidolon) return eidolon;
  return "New session";
}

/** The badge label — the cortex sentinel or the Eidolon identity. */
function rowBadge(slice: SessionSlice): string {
  const isCortex = slice.summary?.isCortex ?? slice.sessionInfo?.isCortex ?? false;
  if (isCortex) return "cortex";
  return slice.summary?.eidolonName || slice.sessionInfo?.eidolonName || "session";
}

/** Map a session's machine state to a status-dot tone. */
function statusTone(slice: SessionSlice): string {
  switch (slice.status) {
    case "turn-running":
    case "launching":
      return "running";
    case "failed":
      return "error";
    case "awaiting-input":
      return "ok";
    default:
      return "muted";
  }
}

/**
 * A compact relative-time label ("just now" / "5m" / "3h" / "2d") for the
 * row's last-active marker. Pure — takes `now` so it stays testable.
 */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const deltaSec = Math.max(0, Math.round((now - then) / 1000));
  if (deltaSec < 45) return "just now";
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

/** The timestamp a row sorts on — last-active, falling back to creation. */
function sortStamp(slice: SessionSlice): number {
  const iso =
    slice.summary?.lastActiveAt ?? slice.summary?.createdAt ?? slice.sessionInfo?.createdAt ?? "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The rail's display order — sessions sorted most-recently-active first.
 *
 * Exported so the route's ⌘/Ctrl+1..9 session-switch shortcut (P7) selects the
 * Nth session by the SAME order the rail renders, with no drift between the
 * keyboard index and the visible row.
 */
export function railOrder(sessions: Record<string, SessionSlice>): SessionSlice[] {
  return Object.values(sessions).sort((a, b) => sortStamp(b) - sortStamp(a));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SessionListProps {
  /** Every known session, keyed by id (the `useSessions` store's `sessions`). */
  sessions: Record<string, SessionSlice>;
  /** The currently-selected session id, or `null` in create mode. */
  activeSessionId: string | null;
  /** Select a session row — the route opens its detail view. */
  onSelect: (sessionId: string) => void;
  /** Clear the selection — the route enters composer create mode. */
  onNewSession: () => void;
  /** Remove a session — deletes its record and drops it from the store. */
  onRemove: (sessionId: string) => void;
  /**
   * When `true` the rail is a thin strip — only the (icon-only) "New session"
   * affordance shows; the full session list is hidden (R1). The route owns the
   * collapsed bit and the expand control; this prop just gates the body.
   */
  collapsed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNewSession,
  onRemove,
  collapsed = false,
}: SessionListProps) {
  // Most-recently-active first — the rail's natural ordering. The route's
  // ⌘1..9 shortcut reads the SAME `railOrder` so the index never drifts.
  const rows = railOrder(sessions);

  return (
    <aside className="session-rail" aria-label="Sessions" data-collapsed={String(collapsed)}>
      <button
        type="button"
        className="session-rail-new"
        onClick={onNewSession}
        aria-label="Start a new session"
        title={collapsed ? "Start a new session" : undefined}
        data-active={activeSessionId === null}
      >
        <span className="session-rail-new-glyph" aria-hidden="true">
          +
        </span>
        <span className="session-rail-new-label">New session</span>
      </button>

      {/* Collapsed = a thin strip: keep only the "New session" affordance. */}
      {collapsed ? null : rows.length === 0 ? (
        <p className="session-rail-empty">No sessions yet. Type into the composer to start one.</p>
      ) : (
        <ul className="session-rail-list">
          {rows.map((slice) => {
            const selected = slice.sessionId === activeSessionId;
            return (
              <li key={slice.sessionId} className="session-rail-row" data-selected={selected}>
                <button
                  type="button"
                  className="session-rail-entry"
                  onClick={() => onSelect(slice.sessionId)}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`Open session ${rowTitle(slice)}`}
                >
                  <span
                    className="session-rail-dot"
                    data-tone={statusTone(slice)}
                    aria-hidden="true"
                  />
                  <span className="session-rail-body">
                    <span className="session-rail-title">{rowTitle(slice)}</span>
                    <span className="session-rail-meta">
                      <span className="session-rail-badge">{rowBadge(slice)}</span>
                      <span className="session-rail-time">
                        {relativeTime(slice.summary?.lastActiveAt)}
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="session-rail-remove"
                  onClick={() => onRemove(slice.sessionId)}
                  aria-label={`Delete session ${rowTitle(slice)}`}
                  title="Delete session"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
