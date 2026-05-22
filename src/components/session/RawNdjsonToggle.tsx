// RawNdjsonToggle.tsx — debug drawer revealing the raw NDJSON transcript.
//
// Replaces the rejected PTY escape hatch: instead of dropping to a terminal,
// the user can peek the verbatim `claude` stream-json lines (and stderr) the
// session produced. `session-stderr` lines may carry ANSI, so they are run
// through parseAnsi for faithful colour.

import { parseAnsi } from "@/lib/parseAnsi";
import type { TranscriptEntry } from "@/lib/useSession";
import { useState } from "react";

interface RawNdjsonToggleProps {
  /** The full append-only transcript — every event + stderr line. */
  transcript: TranscriptEntry[];
}

export function RawNdjsonToggle({ transcript }: RawNdjsonToggleProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="session-raw">
      <button
        type="button"
        className="session-raw-toggle"
        onClick={() => setShow((prev) => !prev)}
        aria-expanded={show}
      >
        {show ? "Hide raw NDJSON" : "View raw NDJSON"}
      </button>
      {show && (
        <pre className="session-raw-body" aria-label="Raw session NDJSON">
          {transcript.map((entry, i) => {
            const tokens = parseAnsi(entry.line);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only and stable
              <div key={i} className="session-raw-line" data-source={entry.source}>
                <span className="session-raw-gutter">
                  {entry.source === "stderr" ? "err" : "evt"}
                </span>
                <span className="session-raw-text">
                  {tokens.map((token, t) =>
                    token.class ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
                      <span key={t} className={token.class}>
                        {token.text}
                      </span>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a stable line
                      <span key={t}>{token.text}</span>
                    ),
                  )}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
