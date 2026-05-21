// pathUtils.ts — tiny path utilities that work in both browser and test envs
// without importing Node's `path` module.

/**
 * Returns the last path segment of an absolute or relative path.
 * Works on both POSIX (/a/b/c → c) and Windows (\a\b\c → c) separators.
 */
export function basename(p: string): string {
  // Normalize separators, strip trailing slashes
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}
