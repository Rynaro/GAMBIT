// MethodologyRoute.tsx — Browse installed Eidolon agent.md files.
// Left nav: list of installed Eidolons (discovered via .eidolons/*/agent.md).
// Right pane: full markdown render of the active Eidolon's agent.md
//             (react-markdown + remark-gfm; YAML front-matter stripped).

import { useState, useEffect } from "react";
import { readTextFile, readDir } from "@tauri-apps/plugin-fs";
import { RouteHeader } from "@/components/RouteHeader";
import { MarkdownView } from "@/components/MarkdownView";
import { getRoute } from "@/routes/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MethodologyRouteProps {
  projectPath: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ROUTE = getRoute("methodology");

export function MethodologyRoute({ projectPath }: MethodologyRouteProps) {
  const [eidolons, setEidolons] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  // Discover .eidolons/*/agent.md entries
  useEffect(() => {
    if (!projectPath) {
      setEidolons([]);
      setSelected(null);
      setContent(null);
      return;
    }

    let cancelled = false;
    setLoadingList(true);
    setListError(null);

    readDir(`${projectPath}/.eidolons`)
      .then(async (entries) => {
        if (cancelled) return;

        const names: string[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory) continue;
          // Check if agent.md exists
          try {
            await readTextFile(
              `${projectPath}/.eidolons/${entry.name}/agent.md`
            );
            names.push(entry.name ?? "");
          } catch {
            // no agent.md — skip this dir
          }
        }

        if (cancelled) return;
        const filtered = names.filter(Boolean).sort();
        setEidolons(filtered);
        if (filtered.length > 0 && !selected) {
          setSelected(filtered[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : String(err));
          setEidolons([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  // Load content when selected changes
  useEffect(() => {
    if (!projectPath || !selected) {
      setContent(null);
      return;
    }

    let cancelled = false;
    setLoadingContent(true);
    setContentError(null);

    readTextFile(`${projectPath}/.eidolons/${selected}/agent.md`)
      .then((raw) => {
        if (!cancelled) setContent(raw);
      })
      .catch((err) => {
        if (!cancelled) {
          setContentError(err instanceof Error ? err.message : String(err));
          setContent(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });

    return () => { cancelled = true; };
  }, [projectPath, selected]);

  if (!projectPath) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">No project selected.</p>
          <p className="route-empty-body">
            Pick a project to browse its installed Eidolon methodologies.
          </p>
        </div>
      </div>
    );
  }

  if (loadingList) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-loading">Scanning installed Eidolons…</div>
      </div>
    );
  }

  if (listError || eidolons.length === 0) {
    return (
      <div className="route-pane">
        <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
        <div className="route-empty">
          <p className="route-empty-heading">Nothing installed in this project yet.</p>
          <p className="route-empty-body">
            Sync first to see methodology. Run{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              eidolons sync
            </code>{" "}
            to install the declared members.
          </p>
          {listError && (
            <span className="route-empty-note" style={{ color: "var(--status-error)" }}>
              {listError}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="route-pane">
      <RouteHeader title={ROUTE.label} subtitle={ROUTE.subtitle} />
      <div className="methodology-layout">
        {/* Left nav */}
        <nav className="methodology-nav" aria-label="Installed Eidolons">
          {eidolons.map((name) => (
            <button
              key={name}
              type="button"
              className="methodology-nav-item"
              data-active={selected === name ? "true" : "false"}
              aria-current={selected === name ? "page" : undefined}
              onClick={() => setSelected(name)}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </nav>

        {/* Right pane */}
        <div className="methodology-content">
          {loadingContent ? (
            <div className="route-loading" style={{ padding: "var(--space-7) 0" }}>
              Loading agent.md…
            </div>
          ) : contentError ? (
            <div className="route-empty" style={{ padding: "var(--space-7) 0" }}>
              <p className="route-empty-body" style={{ color: "var(--status-error)" }}>
                {contentError}
              </p>
            </div>
          ) : content ? (
            <article className="methodology-article">
              <MarkdownView source={content} />
            </article>
          ) : (
            <div className="route-empty" style={{ padding: "var(--space-7) 0" }}>
              <p className="route-empty-body">Select an Eidolon to read its methodology.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
