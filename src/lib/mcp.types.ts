// mcp.types.ts — TypeScript interfaces for the eidolons mcp surface.
//
// Derived verbatim from the live fixture at:
//   gambit/.junction/threads/e9cadae1-ca03-4229-aba2-71096babf139/input/mcp-list.fixture.json
//
// Field notes:
//   - `installed`: empty string ("") when not installed — NOT null.
//   - `kind`: "oci-image" | "binary" observed; typed as open union for safety.
//   - `update`: "no" | "install" | "upgrade" | "downgrade" per mcp list --help.
//   - `scope`: "system" | "eidolon:<name>" per documentation.
//   - Top-level output of `eidolons mcp list --json` is a bare JSON array.

export type McpUpdateState =
  | "no"
  | "install"
  | "upgrade"
  | "downgrade"
  | string;

export type McpKind = "oci-image" | "binary" | string;

/** "system" or "eidolon:<name>" */
export type McpScope = "system" | string;

export interface McpListEntry {
  name: string;
  scope: McpScope;
  kind: McpKind;
  /** Empty string ("") when not installed — never null. */
  installed: string;
  latest: string;
  update: McpUpdateState;
}

export type McpAction = "install" | "uninstall";

export interface McpCompletePayload {
  exitCode: number;
  action: McpAction;
  name: string;
}
