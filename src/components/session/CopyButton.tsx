// CopyButton.tsx — a small hover-revealed "copy to clipboard" affordance.
//
// PRODUCTIVITY-GAP-6: assistant text, tool-result bodies, and code fences had
// no copy affordance — getting an Eidolon's answer out of GAMBIT meant manual
// text selection. This button copies a supplied string via
// `navigator.clipboard.writeText` (which works in the Tauri webview, so no
// Tauri clipboard plugin / capability change is needed) and shows a brief
// "Copied" affirmation on success.

import { useCallback, useRef, useState } from "react";
import "./CopyButton.css";

interface CopyButtonProps {
  /** The text placed on the clipboard when the button is clicked. */
  value: string;
  /** Accessible label — defaults to a generic "Copy". */
  label?: string;
  /** Extra class on the button, so each call site can position it. */
  className?: string;
}

/** How long the "Copied" affirmation stays up after a successful copy (ms). */
const AFFIRM_MS = 1400;

export function CopyButton({ value, label = "Copy", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), AFFIRM_MS);
      })
      .catch(() => {
        // Clipboard denied / unavailable — fail quietly, no affirmation.
      });
  }, [value]);

  return (
    <button
      type="button"
      className={`session-copy-btn${className ? ` ${className}` : ""}`}
      onClick={onCopy}
      data-copied={String(copied)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
