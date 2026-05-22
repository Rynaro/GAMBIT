// markdownView.test.tsx — smoke test for rehype-highlight integration.
// Asserts that a fenced Rust code block is annotated with the expected
// language-rust and hljs classes that rehype-highlight emits.

import { MarkdownView } from "@/components/MarkdownView";
import { render } from "@testing-library/react";

it("applies language-rust hljs class to fenced rust block", () => {
  const { container } = render(<MarkdownView source={"```rust\nfn main() {}\n```"} />);
  expect(container.innerHTML).toContain("language-rust");
  expect(container.innerHTML).toContain("hljs");
});
