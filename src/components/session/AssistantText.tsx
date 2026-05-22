// AssistantText.tsx — an assistant text block: the Eidolon "speaking".
//
// Rendered as a cozy card attributed to the Eidolon. Markdown-aware via
// MarkdownView so fenced code + emphasis read naturally in the transcript.

import { MarkdownView } from "@/components/MarkdownView";

interface AssistantTextProps {
  /** The Eidolon identity, used as the speaker attribution. */
  eidolonName: string;
  /** The assistant text payload. */
  text: string;
}

export function AssistantText({ eidolonName, text }: AssistantTextProps) {
  return (
    <div className="session-assistant" role="article" aria-label={`${eidolonName} says`}>
      <div className="session-assistant-attr">
        <span className="session-assistant-glyph" aria-hidden="true">
          ⬡
        </span>
        <span className="session-assistant-name">{eidolonName}</span>
      </div>
      <div className="session-assistant-body">
        <MarkdownView source={text} stripFrontMatter={false} />
      </div>
    </div>
  );
}
