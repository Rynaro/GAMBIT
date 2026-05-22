// composerPrefs.ts — localStorage helper for the composer's Enter-to-send
// preference (P7). Pure TS; no Tauri imports. Vitest-safe. Mirrors
// `railStore.ts`'s `gambit:`-prefixed storage-key convention.
//
// When the preference is ON, a plain Enter sends the turn and Shift+Enter
// inserts a newline (the chat-app default). When OFF, the current behaviour
// holds: ⌘/Ctrl+Enter sends and a plain Enter is a newline. Default is OFF so
// existing muscle memory is never silently changed.

const KEY = "gambit:enterToSend";

/** Returns the persisted Enter-to-send bit; defaults to `false` (⌘↵ sends). */
export function getEnterToSend(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // localStorage unavailable (e.g. test env without setup)
    return false;
  }
}

/** Persists the Enter-to-send bit so the choice survives a reload. */
export function setEnterToSend(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // silently ignore (storage full / unavailable)
  }
}
