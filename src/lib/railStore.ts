// railStore.ts — localStorage helper for the Sessions rail collapsed bit.
// Pure TS; no Tauri imports. Vitest-safe. Mirrors `projectStore.ts` /
// `useRoute.ts`'s `gambit:`-prefixed storage-key convention.

const KEY = "gambit:sessionsRailCollapsed";

/** Returns the persisted rail-collapsed bit; defaults to `false` (expanded). */
export function getRailCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // localStorage unavailable (e.g. test env without setup)
    return false;
  }
}

/** Persists the rail-collapsed bit so the choice survives a reload. */
export function setRailCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, String(collapsed));
  } catch {
    // silently ignore (storage full / unavailable)
  }
}
