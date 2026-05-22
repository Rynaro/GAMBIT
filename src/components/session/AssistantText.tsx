// AssistantText.tsx — an assistant text block: the Eidolon "speaking".
//
// Rendered as a cozy card attributed to the Eidolon. Markdown-aware via
// MarkdownView so fenced code + emphasis read naturally in the transcript.
//
// Story S6 — liveness: while a turn streams, this same card renders the
// EPHEMERAL live text buffer (accumulated from `session-delta` text fragments)
// with `streaming` set, which adds a blinking caret affordance. On turn
// completion the live buffer is cleared and the persisted `assistant` event
// re-renders the same card WITHOUT `streaming` — so the text never
// double-renders.

import { MarkdownView } from "@/components/MarkdownView";
import { CopyButton } from "@/components/session/CopyButton";

interface AssistantTextProps {
  /** The Eidolon identity, used as the speaker attribution. */
  eidolonName: string;
  /** The assistant text payload. */
  text: string;
  /**
   * `true` while this is the live streaming buffer for an in-flight turn —
   * adds a blinking-caret affordance (story S6). Defaults to `false`.
   */
  streaming?: boolean;
}

export function AssistantText({ eidolonName, text, streaming = false }: AssistantTextProps) {
  return (
    <div
      className="session-assistant"
      data-streaming={String(streaming)}
      role="article"
      aria-label={`${eidolonName} says`}
      aria-busy={streaming || undefined}
    >
      <div className="session-assistant-attr">
        <span className="session-assistant-glyph" aria-hidden="true">
          ⬡
        </span>
        <span className="session-assistant-name">{eidolonName}</span>
        {/* P5: hover copy affordance — copies the raw assistant text. Hidden
            while the buffer is still streaming (the text is not yet final). */}
        {!streaming && <CopyButton value={text} label={`Copy ${eidolonName}'s message`} />}
      </div>
      <div className="session-assistant-body">
        <MarkdownView source={text} stripFrontMatter={false} />
        {streaming && <span className="session-assistant-caret" aria-hidden="true" />}
      </div>
    </div>
  );
}
