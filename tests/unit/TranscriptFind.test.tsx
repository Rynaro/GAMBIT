// TranscriptFind.test.tsx — Vitest tests for the in-transcript find UI
// components (story P10): `HighlightedText` and `TranscriptFindBar`.
//
// The pure match logic is covered by `transcriptFind.test.ts`; these tests
// cover the rendering: `HighlightedText` wraps query matches in `<mark>`, and
// `TranscriptFindBar` shows the `current/total` count and steps matches.
//
// Hermetic: props only, no Tauri, no store.

import { HighlightedText } from "@/components/session/HighlightedText";
import { TranscriptFindBar } from "@/components/session/TranscriptFindBar";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("HighlightedText (P10)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders plain text when the query is empty", () => {
    const { container } = render(<HighlightedText text="hello world" query="" />);
    expect(container.textContent).toBe("hello world");
    expect(container.querySelector("mark")).toBeNull();
  });

  it("wraps case-insensitive matches in <mark>", () => {
    const { container } = render(<HighlightedText text="the Auth and auth flow" query="auth" />);
    const marks = container.querySelectorAll("mark.session-find-hit");
    expect(marks).toHaveLength(2);
    // The full text is preserved across the highlighted + plain runs.
    expect(container.textContent).toBe("the Auth and auth flow");
  });
});

describe("TranscriptFindBar (P10)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a current/total match count", () => {
    render(
      <TranscriptFindBar
        query="auth"
        onQueryChange={vi.fn()}
        matchCount={3}
        activeIndex={1}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // activeIndex is 0-based; the label is 1-based.
    expect(screen.getByText("2/3")).toBeTruthy();
  });

  it("reads 0/0 for a query that matches nothing", () => {
    render(
      <TranscriptFindBar
        query="zzz"
        onQueryChange={vi.fn()}
        matchCount={0}
        activeIndex={-1}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("0/0")).toBeTruthy();
  });

  it("steps matches via the next / prev buttons", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <TranscriptFindBar
        query="auth"
        onQueryChange={vi.fn()}
        matchCount={2}
        activeIndex={0}
        onNext={onNext}
        onPrev={onPrev}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Next match"));
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("Enter steps next, Escape closes", () => {
    const onNext = vi.fn();
    const onClose = vi.fn();
    render(
      <TranscriptFindBar
        query="auth"
        onQueryChange={vi.fn()}
        matchCount={2}
        activeIndex={0}
        onNext={onNext}
        onPrev={vi.fn()}
        onClose={onClose}
      />,
    );
    const input = screen.getByLabelText("Find in transcript");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
