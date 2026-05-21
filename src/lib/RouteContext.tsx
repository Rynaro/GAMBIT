// RouteContext.tsx — React context that exposes {activeRoute, setActiveRoute}
// to any component in the tree without prop-drilling.

import { createContext, useContext, type ReactNode } from "react";
import { useRoute, type UseRouteResult, type RouteId } from "@/lib/useRoute";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const RouteContext = createContext<UseRouteResult | null>(null);

// ---------------------------------------------------------------------------
// Provider — mount once at <App /> root
// ---------------------------------------------------------------------------

interface RouteProviderProps {
  children: ReactNode;
}

export function RouteProvider({ children }: RouteProviderProps) {
  const route = useRoute();
  return (
    <RouteContext.Provider value={route}>
      {children}
    </RouteContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useRouteContext(): UseRouteResult {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    throw new Error("useRouteContext must be used within a <RouteProvider>");
  }
  return ctx;
}

// Re-export RouteId for convenience
export type { RouteId };
