// projectStore.ts — localStorage helpers for the user-picked project path.
// Pure TS; no Tauri imports. Vitest-safe.

const KEY = "gambit:projectPath";

/**
 * Returns the stored absolute path, or null if none is set / stored value is
 * empty.
 */
export function getProjectPath(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.trim() === "") return null;
    return raw;
  } catch {
    // localStorage unavailable (e.g. SSR / test env without setup)
    return null;
  }
}

/**
 * Persists the project path. Pass an absolute path string.
 */
export function setProjectPath(path: string): void {
  try {
    localStorage.setItem(KEY, path);
  } catch {
    // silently ignore (storage full / unavailable)
  }
}

/**
 * Clears the stored project path.
 */
export function clearProjectPath(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // silently ignore
  }
}
