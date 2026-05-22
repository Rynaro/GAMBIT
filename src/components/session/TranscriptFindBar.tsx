// TranscriptFindBar.tsx — the in-transcript find bar (story P10).
//
// Opened by a button or ⌘/Ctrl+F while the Sessions route is active, the find
// bar searches the visible transcript's text and steps through the matches
// with a count. The match logic is pure (`transcriptFind.ts`); this component
// is just the controlled UI: an input, a `current / total` count, prev / next
// steppers, and a close button. Esc closes it.
//
// The bar is CONTROLLED by `DetailPane` — it owns the query, the active match
// index, and the open/closed bit so the ⌘F binding and the transcript
// highlighting stay in one place.

import { type KeyboardEvent, useEffect, useRef } from "react";

interface TranscriptFindBarProps {
  /** The current search query. */
  query: string;
  /** Update the search query. */
  onQueryChange: (query: string) => void;
  /** Total number of matches for the current query. */
  matchCount: number;
  /** 0-based index of the active match (`-1` when there are none). */
  activeIndex: number;
  /** Step to the next match (wraps). */
  onNext: () => void;
  /** Step to the previous match (wraps). */
  onPrev: () => void;
  /** Close the find bar. */
  onClose: () => void;
}

export function TranscriptFindBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onNext,
  onPrev,
  onClose,
}: TranscriptFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input the moment the bar mounts so the user can type at once.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  /** Enter / Shift+Enter step the matches; Esc closes. */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const hasQuery = query.trim().length > 0;
  // `current / total` — 1-based for display; a no-match query reads "0/0".
  const countLabel = !hasQuery ? "" : matchCount === 0 ? "0/0" : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="session-find-bar">
      <input
        ref={inputRef}
        type="search"
        className="session-find-input"
        placeholder="Find in transcript…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Find in transcript"
      />
      {countLabel && (
        <span
          className="session-find-count"
          data-empty={hasQuery && matchCount === 0}
          aria-live="polite"
        >
          {countLabel}
        </span>
      )}
      <button
        type="button"
        className="session-find-step"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        ↑
      </button>
      <button
        type="button"
        className="session-find-step"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        ↓
      </button>
      <button
        type="button"
        className="session-find-close"
        onClick={onClose}
        aria-label="Close find"
        title="Close (Esc)"
      >
        ×
      </button>
    </div>
  );
}
