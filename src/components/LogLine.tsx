// LogLine.tsx — Renders a single ANSI-parsed log line.
//
// Memoised with React.memo so the virtualizer only re-renders rows that
// actually changed (the array is append-only in practice).

import { memo } from "react";
import { parseAnsi } from "@/lib/parseAnsi";
import type { SyncLine } from "@/lib/useSync";

interface LogLineProps {
  line: SyncLine;
}

export const LogLine = memo(function LogLine({ line }: LogLineProps) {
  const tokens = parseAnsi(line.text);

  return (
    <div
      className={`log-line log-line--${line.stream}`}
      aria-label={line.text}
    >
      {tokens.map((token, i) =>
        token.class ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
          <span key={i} className={token.class}>
            {token.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
          <span key={i}>{token.text}</span>
        )
      )}
    </div>
  );
});
