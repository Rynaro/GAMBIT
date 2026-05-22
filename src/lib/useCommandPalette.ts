// useCommandPalette.ts — React hook for global ⌘K / Ctrl+K palette toggle.

import { isMacOS } from "@/lib/platform";
import { useCallback, useEffect, useState } from "react";

export interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function useCommandPalette(): CommandPaletteState {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const mac = isMacOS();
    const trigger = mac ? e.metaKey && e.key === "k" : e.ctrlKey && e.key === "k";
    if (!trigger) return;
    e.preventDefault();
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { open, setOpen };
}
