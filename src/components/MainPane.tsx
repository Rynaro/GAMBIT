import { BRAND } from "@/lib/brand";

export function MainPane() {
  return (
    <main className="main-pane">
      <div className="welcome-state">
        <h1 className="welcome-heading">Welcome to {BRAND.display}</h1>
        <p className="welcome-lineage">
          Eidolons answer the call. Junction is where they bind. MATERIA is where you equip them.
        </p>
        <footer className="welcome-footer">
          <span className="welcome-ff-origin">{BRAND.ffOrigin}</span>
        </footer>
      </div>
    </main>
  );
}
