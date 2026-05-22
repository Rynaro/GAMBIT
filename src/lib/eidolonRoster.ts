// eidolonRoster.ts — loader for the PROJECT's installed Eidolons.
//
// Reads `${projectPath}/eidolons.yaml` for the `members:` list, then for
// each member reads `${projectPath}/.eidolons/<name>/agent.md` and parses
// its YAML front-matter into a ProjectEidolon. This is the identity data a
// future Sessions launcher (S7/S8) needs.
//
// Real shapes (captured from the live repo):
//
//   eidolons.yaml:
//     members:
//       - name: atlas
//         version: "^1.5.3"
//         source: github:Rynaro/ATLAS
//
//   .eidolons/<name>/agent.md front-matter (delimited by `---`):
//     ---
//     name: atlas
//     description: ...
//     allowed-tools: view_file list_dir search_text ...   ← space-separated
//     methodology: ATLAS
//     methodology_version: "1.0"
//     role: Explorer/Scout — read-only codebase intelligence
//     handoffs: [spectra, apivr]                           ← flow seq
//     ---
//
// Graceful: a missing or unparseable `agent.md` for one member does not
// throw — that member is returned with empty identity fields (matching how
// the rest of the app degrades on partial data, e.g. HarnessRoute).
//
// Story S4 adds the synthetic "Cortex (default)" roster entry — `readProject
// Roster` prepends it to `readProjectEidolons`. It is shaped as a
// `ProjectEidolon` whose `agentMdPath` points at `.eidolons/cortex/
// EIDOLONS.md` (the routing descriptor) and whose `isCortex` flag marks the
// TRANCE-lite launch path; an absent descriptor yields `unavailable: true`.

import type { ProjectEidolon } from "@/lib/eidolon.types";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// eidolons.yaml — members list
// ---------------------------------------------------------------------------

/**
 * Extract the ordered `members:` names from `eidolons.yaml` raw text.
 * Hand-parsed (rather than full YAML) so we only need the well-known
 * `members:` → `  - name: <value>` shape and stay tolerant of the file's
 * surrounding comments and other top-level keys.
 */
export function parseMemberNames(raw: string): string[] {
  const names: string[] = [];
  const lines = raw.split("\n");
  let inMembers = false;

  for (const line of lines) {
    // Detect the `members:` top-level key.
    if (/^members\s*:/.test(line)) {
      inMembers = true;
      continue;
    }

    // Any other top-level key (no indentation, not a list item) ends the block.
    if (inMembers && /^[a-z_][\w-]*\s*:/.test(line)) {
      inMembers = false;
    }

    if (!inMembers) continue;

    // A member entry starts with `  - name: <value>`.
    const nameItem = line.match(/^\s+-\s+name\s*:\s*(.+)/);
    if (nameItem) {
      const name = nameItem[1].trim().replace(/^['"]|['"]$/g, "");
      if (name) names.push(name);
    }
  }

  return names;
}

// ---------------------------------------------------------------------------
// agent.md — YAML front-matter
// ---------------------------------------------------------------------------

/** Extract the raw YAML front-matter block from an `agent.md` document. */
function extractFrontMatter(source: string): string | null {
  const normalised = source.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
}

/**
 * Coerce a front-matter value into a `string[]`.
 *
 * `agent.md` carries two list conventions:
 *   - `allowed-tools: a b c`   → space-separated scalar string
 *   - `handoffs: [a, b]`       → real YAML flow sequence (parsed as array)
 * Both — plus block sequences — collapse to a trimmed string list here.
 */
function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/\s+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

/** Normalise a scalar front-matter value into a trimmed string. */
function toStr(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Parse an `agent.md` document into the identity portion of a ProjectEidolon.
 * Returns empty fields (rather than throwing) when front-matter is absent or
 * unparseable.
 */
export function parseAgentMd(
  source: string,
  fallbackName: string,
): Omit<ProjectEidolon, "agentMdPath"> {
  const empty: Omit<ProjectEidolon, "agentMdPath"> = {
    name: fallbackName,
    description: "",
    role: "",
    methodology: "",
    methodologyVersion: "",
    allowedTools: [],
    handoffs: [],
  };

  const block = extractFrontMatter(source);
  if (block === null) return empty;

  let fm: Record<string, unknown>;
  try {
    const parsed = parseYaml(block);
    if (parsed === null || typeof parsed !== "object") return empty;
    fm = parsed as Record<string, unknown>;
  } catch {
    // Unparseable front-matter — degrade to empty identity, do not throw.
    return empty;
  }

  return {
    name: toStr(fm.name) || fallbackName,
    description: toStr(fm.description),
    role: toStr(fm.role),
    methodology: toStr(fm.methodology),
    methodologyVersion: toStr(fm.methodology_version),
    allowedTools: toStringList(fm["allowed-tools"]),
    handoffs: toStringList(fm.handoffs),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Read the project's installed Eidolons.
 *
 * Reads `${projectPath}/eidolons.yaml` for the member list, then each
 * member's `${projectPath}/.eidolons/<name>/agent.md` front-matter. A
 * missing/unparseable `agent.md` for one member yields a ProjectEidolon
 * with empty identity fields rather than aborting the whole roster. If
 * `eidolons.yaml` itself is missing/unreadable, returns `[]`.
 */
export async function readProjectEidolons(projectPath: string): Promise<ProjectEidolon[]> {
  let memberNames: string[];
  try {
    const manifest = await readTextFile(`${projectPath}/eidolons.yaml`);
    memberNames = parseMemberNames(manifest);
  } catch {
    // No manifest — no project Eidolons to report.
    return [];
  }

  const eidolons: ProjectEidolon[] = [];

  for (const name of memberNames) {
    const agentMdPath = `${projectPath}/.eidolons/${name}/agent.md`;
    let identity: Omit<ProjectEidolon, "agentMdPath">;
    try {
      const raw = await readTextFile(agentMdPath);
      identity = parseAgentMd(raw, name);
    } catch {
      // agent.md absent/unreadable — keep the member with empty identity.
      identity = {
        name,
        description: "",
        role: "",
        methodology: "",
        methodologyVersion: "",
        allowedTools: [],
        handoffs: [],
      };
    }
    eidolons.push({ ...identity, agentMdPath });
  }

  return eidolons;
}

// ---------------------------------------------------------------------------
// Cortex (default) — the synthetic TRANCE-lite roster entry (story S4)
// ---------------------------------------------------------------------------

/**
 * The sentinel `name` of the synthetic "Cortex (default)" roster entry.
 *
 * It is intentionally NOT a name `eidolons.yaml` can ever carry (the leading
 * `@` is illegal in a member name) so a real Eidolon can never collide with
 * the sentinel. The composer pre-selects this name; `handleCreate` keys the
 * `isCortex` launch path off it.
 */
export const CORTEX_EIDOLON_NAME = "@cortex";

/** Human-facing label for the synthetic Cortex entry in the picker. */
export const CORTEX_DISPLAY_NAME = "Cortex (default)";

/**
 * Absolute path to a project's cortex routing descriptor.
 *
 * FORGE fixed TRANCE-in-GAMBIT as option (c): feed this file as the session's
 * `--append-system-prompt` so `claude` self-routes across the project's
 * Eidolons. The file is read with the SAME `readTextFile(agentMdPath)` pattern
 * a named Eidolon's `agent.md` uses — so the launcher needs no extra branch.
 */
export function cortexDescriptorPath(projectPath: string): string {
  return `${projectPath}/.eidolons/cortex/EIDOLONS.md`;
}

/**
 * Build the synthetic "Cortex (default)" roster entry for a project.
 *
 * Shaped as a `ProjectEidolon` so the composer's existing `<select>` and
 * `handleCreate`'s `readTextFile(eidolon.agentMdPath)` resolution work
 * unchanged — `agentMdPath` points at `.eidolons/cortex/EIDOLONS.md` and
 * `isCortex` marks it the cortex launch path. `allowedTools` is left EMPTY
 * on purpose: cortex routing is dynamic, so the session takes `claude`'s
 * default permissive tool posture (the routed Eidolons carry their own
 * contracts) rather than an over-restricted allow-list.
 *
 * Graceful degradation: when `${projectPath}/.eidolons/cortex/EIDOLONS.md` is
 * absent the entry is returned with `unavailable: true` so the picker can
 * disable it with a note instead of the launch crashing.
 */
export async function readCortexRosterEntry(projectPath: string): Promise<ProjectEidolon> {
  const agentMdPath = cortexDescriptorPath(projectPath);
  let unavailable = false;
  try {
    // A presence probe — the launcher re-reads the content at create time,
    // matching the agent.md flow. An empty file still counts as present.
    await readTextFile(agentMdPath);
  } catch {
    unavailable = true;
  }

  return {
    name: CORTEX_EIDOLON_NAME,
    description: unavailable
      ? "Cortex routing descriptor (.eidolons/cortex/EIDOLONS.md) not found in this project."
      : "Self-routing default — claude routes work across the project's Eidolons.",
    role: "Routing cortex",
    methodology: "TRANCE",
    methodologyVersion: "",
    allowedTools: [],
    handoffs: [],
    agentMdPath,
    isCortex: true,
    unavailable,
  };
}

/**
 * Read a project's roster with the synthetic "Cortex (default)" entry
 * PREPENDED — the zero-effort launch default (story S4).
 *
 * The Cortex entry is always first so the composer can pre-select it without
 * inspecting the list; named project Eidolons follow in `eidolons.yaml` order
 * as explicit opt-in overrides.
 */
export async function readProjectRoster(projectPath: string): Promise<ProjectEidolon[]> {
  const [cortex, eidolons] = await Promise.all([
    readCortexRosterEntry(projectPath),
    readProjectEidolons(projectPath),
  ]);
  return [cortex, ...eidolons];
}
