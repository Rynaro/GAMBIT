// platform.ts — detect OS once at startup and stamp a data attribute on <html>
// so CSS and JS can both branch on platform without repeated checks.

export type Platform = "macos" | "linux" | "windows" | "unknown";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux")) return "linux";
  if (ua.includes("windows")) return "windows";
  return "unknown";
}

/** Call once in main.tsx / App root before first render. */
export function setupPlatform(): Platform {
  const platform = detectPlatform();
  document.documentElement.dataset.platform = platform;
  return platform;
}

export function isMacOS(): boolean {
  return document.documentElement.dataset.platform === "macos";
}
