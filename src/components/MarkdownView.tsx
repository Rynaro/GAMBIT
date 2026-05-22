// MarkdownView.tsx — Renders a markdown string using react-markdown + remark-gfm.
// Applies GAMBIT design-token CSS classes. Strips YAML front-matter by default.

import { CopyButton } from "@/components/session/CopyButton";
import { stripFrontMatter } from "@/lib/stripFrontMatter";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./MarkdownView.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively gather the raw text of a hast node tree — used to recover the
 * literal source of a fenced code block so it can be copied verbatim (P5).
 */
function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text" && typeof n.value === "string") return n.value;
  if (Array.isArray(n.children)) return n.children.map(nodeText).join("");
  return "";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarkdownViewProps {
  /** Raw markdown source — front-matter may still be present. */
  source: string;
  /** Strip YAML front-matter before rendering. Default: true. */
  stripFrontMatter?: boolean;
}

// ---------------------------------------------------------------------------
// Component renderers
// ---------------------------------------------------------------------------

const components: Components = {
  // Headings
  h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="md-h4">{children}</h4>,

  // Paragraph
  p: ({ children }) => <p className="md-p">{children}</p>,

  // Links — open externally; Tauri 2 intercepts via default link handler.
  a: ({ href, children }) => (
    <a
      className="md-a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        // In Tauri 2 webviews, target="_blank" links don't open by default.
        // Intercept and delegate to window.open so the OS default browser
        // handles them.  This is a v0.1-acceptable approach; a
        // @tauri-apps/plugin-opener integration can replace it in v0.2.
        if (href) {
          e.preventDefault();
          window.open(href, "_blank");
        }
      }}
    >
      {children}
    </a>
  ),

  // Inline code vs block code
  code: ({ children, className, ...rest }) => {
    // If a parent `pre` wraps this, react-markdown passes a className like
    // "language-<lang>".  Inline code has no className.
    const isBlock = Boolean(className);
    if (isBlock) {
      // Block code — let <pre> carry the styling.
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return <code className="md-code-inline">{children}</code>;
  },

  // Pre (fenced code block wrapper) — P5: a hover copy button copies the
  // fence's literal source, recovered from the hast `node`.
  pre: ({ children, node }) => {
    const source = nodeText(node);
    return (
      <div className="md-code-block-wrap">
        {source && (
          <CopyButton
            value={source}
            label="Copy code block"
            className="session-copy-btn--overlay"
          />
        )}
        <pre className="md-code-block">{children}</pre>
      </div>
    );
  },

  // Blockquote
  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,

  // Lists
  ul: ({ children }) => <ul className="md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="md-ol">{children}</ol>,
  li: ({ children }) => <li className="md-li">{children}</li>,

  // Tables
  table: ({ children }) => (
    <div className="md-table-wrapper">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,
  tr: ({ children }) => <tr className="md-tr">{children}</tr>,

  // Horizontal rule
  hr: () => <hr className="md-hr" />,
};

// ---------------------------------------------------------------------------
// MarkdownView
// ---------------------------------------------------------------------------

export function MarkdownView({ source, stripFrontMatter: shouldStrip = true }: MarkdownViewProps) {
  const rendered = shouldStrip ? stripFrontMatter(source) : source;

  return (
    <div className="markdown-view">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {rendered}
      </ReactMarkdown>
    </div>
  );
}
