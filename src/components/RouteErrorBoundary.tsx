// RouteErrorBoundary.tsx — Error boundary that wraps the active route.
// A class component is required by React's error boundary API.
// Keyed by activeRoute in MainPane so navigation resets the error state.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  routeId?: string;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RouteErrorBoundary]", this.props.routeId, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="route-pane">
        <div className="route-card">
          <div className="route-empty">
            <p className="route-empty-heading">This route crashed.</p>
            <p className="route-empty-body">
              {this.props.routeId
                ? `The "${this.props.routeId}" route threw while rendering.`
                : "The active route threw while rendering."}{" "}
              Pick a different route from the sidebar, or fix the underlying error and reload.
            </p>
            <pre
              className="route-empty-note"
              style={{ whiteSpace: "pre-wrap", color: "var(--status-error)" }}
            >
              {this.state.error.message}
            </pre>
            <button
              type="button"
              className="route-verb-btn"
              onClick={this.reset}
              style={{ marginTop: 8 }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
