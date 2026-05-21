// parseMcpLock.ts — typed parser for eidolons.mcp.lock (YAML).
// Real shape captured from live fixture:
//   tests/parsers/eidolons-mcp-lock.fixture.yaml
//
// Top-level keys: generated_at, eidolons_cli_version, catalogue_version, mcps (array).
// Each mcp entry: name, kind, version, source.repo, integrity.{algo,value},
//                 target, hosts_wired[], installed_at.

import { parse as parseYaml } from "yaml";

export interface McpEntrySource {
  repo?: string;
}

export interface McpEntryIntegrity {
  algo?: string;
  value?: string;
}

export interface McpEntry {
  name: string;
  kind?: string;
  version?: string;
  source?: McpEntrySource;
  integrity?: McpEntryIntegrity;
  target?: string;
  hosts_wired?: string[];
  installed_at?: string;
}

export interface McpLock {
  generated_at?: string;
  eidolons_cli_version?: string;
  catalogue_version?: string;
  mcps?: McpEntry[];
}

/** Parse raw YAML text into a typed McpLock. Returns null on empty/null input. */
export function parseMcpLock(raw: string): McpLock {
  return parseYaml(raw) as McpLock;
}

/** Find the Junction entry within a parsed McpLock. */
export function findJunctionEntry(lock: McpLock): McpEntry | undefined {
  return (lock.mcps ?? []).find((m) => m.name === "junction");
}
