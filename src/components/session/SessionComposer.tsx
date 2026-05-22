// SessionComposer.tsx — the follow-up-turn input for a live session.
//
// A textarea + Send affordance. Enabled only when the session is
// `awaiting-input` (a turn is not in flight); while a turn runs, the composer
// is disabled and a Cancel control is offered instead.

import { type KeyboardEvent, useState } from "react";

interface SessionComposerProps {
  /** Whether the session is ready to accept a new turn. */
  canSend: boolean;
  /** Whether a turn is currently in flight (enables Cancel). */
  turnRunning: boolean;
  /** Send a follow-up turn with the composed prompt. */
  onSend: (prompt: string) => void;
  /** Cancel the in-flight turn. */
  onCancel: () => void;
}

export function SessionComposer({ canSend, turnRunning, onSend, onCancel }: SessionComposerProps) {
  const [draft, setDraft] = useState("");

  function handleSend() {
    const prompt = draft.trim();
    if (!prompt || !canSend) return;
    onSend(prompt);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends — newline stays the default Enter behaviour.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="session-composer">
      <textarea
        className="session-composer-input"
        placeholder={
          canSend ? "Reply to the Eidolon… (⌘↵ to send)" : "Waiting for the current turn…"
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!canSend}
        rows={3}
        aria-label="Follow-up turn prompt"
      />
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
          onClick={handleSend}
          disabled={!canSend || draft.trim().length === 0}
          aria-label="Send follow-up turn"
        >
          Send
        </button>
      </div>
    </div>
  );
}
