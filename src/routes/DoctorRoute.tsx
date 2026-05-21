// DoctorRoute.tsx — STUB ONLY.
//
// The real Doctor dashboard ships in the parallel `feat/v0.1-doctor` branch:
//   - `eidolons doctor` invocation + 9-check stderr parser
//   - Per-check status grid with Fix verbs
//
// This stub exists solely to register the route and avoid a blank pane.
// The `feat/v0.1-doctor` branch will overwrite this file on merge.

import { RouteHeader } from "@/components/RouteHeader";
import { getRoute } from "@/routes/index";

const ROUTE = getRoute("doctor");

export function DoctorRoute() {
  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />

      <div className="route-card">
        <div className="route-empty">
          <span className="stub-pill">
            Stub — under construction
          </span>
          <p className="route-empty-heading">Doctor</p>
          <p className="route-empty-body">
            Doctor dashboard ships in the parallel{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              feat/v0.1-doctor
            </code>{" "}
            branch —{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              eidolons doctor
            </code>{" "}
            invocation + 9-check parser + status grid.
          </p>
          <span className="route-empty-note">
            This stub will be overwritten when feat/v0.1-doctor merges.
          </span>
        </div>
      </div>
    </div>
  );
}
