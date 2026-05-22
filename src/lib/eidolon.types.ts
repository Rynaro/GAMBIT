// eidolon.types.ts — typed shape for a project-installed Eidolon.
//
// One ProjectEidolon describes a single Eidolon installed under
// `.eidolons/<name>/`, with identity sourced from its `agent.md`
// YAML front-matter (name, description, role, methodology,
// methodology_version, allowed-tools, handoffs).
//
// Permissive types on purpose: `role`/`methodology` etc. are plain
// `string`, not string-literal unions, so newer Eidolon front-matter
// shapes load without a type-level breaking change. Stated project
// convention — forward-compat over precision here.

export interface ProjectEidolon {
  /** Member name from `eidolons.yaml` (and `agent.md` front-matter `name`). */
  name: string;
  /** Free-text `description` from front-matter; "" when absent. */
  description: string;
  /** `role` line from front-matter; "" when absent. */
  role: string;
  /** `methodology` identifier (e.g. "ATLAS"); "" when absent. */
  methodology: string;
  /** `methodology_version` from front-matter; "" when absent. */
  methodologyVersion: string;
  /** `allowed-tools` parsed into a list; [] when absent. */
  allowedTools: string[];
  /** `handoffs` parsed into a list of Eidolon names; [] when absent. */
  handoffs: string[];
  /** Absolute path to the `agent.md` this identity was read from. */
  agentMdPath: string;
  /**
   * `true` for the SYNTHETIC "Cortex (default)" roster entry (story S4) — a
   * named-Eidolon roster member is always `false`/absent. When `true`, the
   * launcher feeds the cortex routing descriptor (`.eidolons/cortex/
   * EIDOLONS.md`, the path carried in `agentMdPath`) as `--append-system-prompt`
   * so `claude` self-routes across the project's Eidolons (TRANCE-lite,
   * FORGE option (c)). NOT a real Eidolon — never sourced from `eidolons.yaml`.
   */
  isCortex?: boolean;
  /**
   * `true` when the synthetic Cortex entry's descriptor file is absent in this
   * project — the picker shows it disabled with a clear note rather than
   * crashing. Always absent on a real roster member.
   */
  unavailable?: boolean;
}
