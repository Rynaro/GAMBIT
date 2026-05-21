// useRoute.ts — Active route hook with localStorage persistence.
// Pure TS; no Tauri imports. Vitest-safe.

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Route IDs — single source of truth; must match sidebar DESTINATIONS and
// the route registry in src/routes/index.ts.
// ---------------------------------------------------------------------------

export type RouteId =
  | "roster"
  | "project"
  | "mcp-store"
  | "harness"
  | "doctor"
  | "methodology"
  | "settings";

const STORAGE_KEY = "gambit:activeRoute";
const DEFAULT_ROUTE: RouteId = "project";

function readStoredRoute(): RouteId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isRouteId(raw)) return raw as RouteId;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_ROUTE;
}

function persistRoute(id: RouteId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // silently ignore
  }
}

function isRouteId(value: string): boolean {
  return [
    "roster",
    "project",
    "mcp-store",
    "harness",
    "doctor",
    "methodology",
    "settings",
  ].includes(value);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseRouteResult {
  activeRoute: RouteId;
  setActiveRoute: (id: RouteId) => void;
}

export function useRoute(): UseRouteResult {
  const [activeRoute, setActiveRouteState] = useState<RouteId>(readStoredRoute);

  const setActiveRoute = useCallback((id: RouteId) => {
    setActiveRouteState(id);
    persistRoute(id);
  }, []);

  return { activeRoute, setActiveRoute };
}
