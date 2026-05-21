/**
 * platform.ts — Detect the host OS via Tauri 2 and stamp it onto the root
 * element as `data-platform`. CSS can then target platform-specific surfaces:
 *
 *   :root[data-platform="macos"]   .sidebar  { background: transparent; }
 *   :root[data-platform="linux"]   .sidebar  { background: var(--bg-canvas); }
 *   :root[data-platform="windows"] .sidebar  { background: var(--bg-canvas); }
 *
 * Called once on app mount from App.tsx via useEffect.
 */

import { platform as tauriPlatform } from "@tauri-apps/api/os";

export async function detectAndStampPlatform(): Promise<void> {
  try {
    const p = await tauriPlatform();
    // p is "macos" | "linux" | "windows" | "android" | "ios"
    document.documentElement.dataset.platform = p;
  } catch {
    // Fallback: if the Tauri runtime is unavailable (e.g. browser preview),
    // attempt a best-effort sniff from the user-agent.
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac os")) {
      document.documentElement.dataset.platform = "macos";
    } else if (ua.includes("linux")) {
      document.documentElement.dataset.platform = "linux";
    } else if (ua.includes("win")) {
      document.documentElement.dataset.platform = "windows";
    }
  }
}
