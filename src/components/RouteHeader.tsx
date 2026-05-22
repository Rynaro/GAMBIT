// RouteHeader.tsx — Shared chrome for every route pane.
// Renders title + subtitle + optional right-side verb buttons.

import type { ReactNode } from "react";
import "./RouteHeader.css";

interface RouteHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional verb buttons rendered flush-right. */
  actions?: ReactNode;
}

export function RouteHeader({ title, subtitle, actions }: RouteHeaderProps) {
  return (
    <header className="route-header">
      <div className="route-header-text">
        <h1 className="route-header-title">{title}</h1>
        {subtitle && <p className="route-header-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="route-header-actions">{actions}</div>}
    </header>
  );
}
