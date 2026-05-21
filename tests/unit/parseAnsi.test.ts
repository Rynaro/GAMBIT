// parseAnsi.test.ts — Unit tests for the ANSI parser wrapper.
// Vitest. No Tauri deps. Pure function — straightforward to test.

import { describe, it, expect } from "vitest";
import { parseAnsi } from "@/lib/parseAnsi";

describe("parseAnsi", () => {
  it("empty string returns a single empty token", () => {
    const tokens = parseAnsi("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual({ text: "", class: "" });
  });

  it("plain text with no escapes returns a single unstyled token", () => {
    const tokens = parseAnsi("hello world");
    // All tokens concatenated should equal the original string
    const reconstructed = tokens.map((t) => t.text).join("");
    expect(reconstructed).toBe("hello world");
    // No token should carry an ansi class
    for (const token of tokens) {
      expect(token.class).toBe("");
    }
  });

  it("single ANSI red escape produces a token with ansi-red-fg class", () => {
    // ESC[31m = red foreground; ESC[0m = reset
    const line = "[31mERROR[0m";
    const tokens = parseAnsi(line);
    const redToken = tokens.find((t) => t.text === "ERROR");
    expect(redToken).toBeDefined();
    expect(redToken?.class).toContain("ansi-red-fg");
  });

  it("bold escape wraps text with ansi-bold class", () => {
    const line = "[1mBold text[0m";
    const tokens = parseAnsi(line);
    const boldToken = tokens.find((t) => t.text === "Bold text");
    expect(boldToken).toBeDefined();
    expect(boldToken?.class).toContain("ansi-bold");
  });

  it("nested colour+bold escape carries multiple classes", () => {
    // ESC[32;1m = green + bold
    const line = "[32;1mSuccess[0m";
    const tokens = parseAnsi(line);
    const styledToken = tokens.find((t) => t.text === "Success");
    expect(styledToken).toBeDefined();
    // Should carry both green and bold class names
    expect(styledToken?.class).toContain("ansi-green-fg");
    expect(styledToken?.class).toContain("ansi-bold");
  });

  it("malformed/unsupported escape returns tokens without throwing", () => {
    // A truncated escape sequence that anser should tolerate
    const line = "before[999mafter";
    let tokens: ReturnType<typeof parseAnsi> | undefined;
    expect(() => {
      tokens = parseAnsi(line);
    }).not.toThrow();
    // Reconstructed text should at least contain "before" and "after"
    const text = tokens!.map((t) => t.text).join("");
    expect(text).toContain("before");
    expect(text).toContain("after");
  });
});
