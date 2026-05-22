import { describe, expect, it } from "vitest";
import { stripFrontMatter } from "../../src/lib/stripFrontMatter";

// ---------------------------------------------------------------------------
// stripFrontMatter unit tests
// ---------------------------------------------------------------------------

describe("stripFrontMatter", () => {
  it("strips YAML front-matter and returns the body", () => {
    const input = `---
name: atlas
version: "1.0"
---
# ATLAS

Body text here.
`;
    const result = stripFrontMatter(input);
    expect(result).toBe("# ATLAS\n\nBody text here.\n");
    expect(result).not.toContain("name: atlas");
    expect(result).not.toContain("---");
  });

  it("returns the source unchanged when no front-matter is present", () => {
    const input = "# Heading\n\nSome content without front-matter.\n";
    const result = stripFrontMatter(input);
    expect(result).toBe(input);
  });

  it("returns the source unchanged when there is only an opening --- (no closing)", () => {
    const input = `---
name: partial
# No closing delimiter below
# This is body content
`;
    const result = stripFrontMatter(input);
    expect(result).toBe(input);
  });

  it("handles CRLF line endings (Windows)", () => {
    const input = "---\r\nname: atlas\r\nversion: 1\r\n---\r\n# ATLAS\r\n\r\nBody.\r\n";
    const result = stripFrontMatter(input);
    // Front-matter should be gone; body should start with # ATLAS
    expect(result).not.toContain("name: atlas");
    expect(result.trim().startsWith("# ATLAS")).toBe(true);
  });

  it("handles a minimal one-field front-matter block", () => {
    const input = "---\ntitle: test\n---\nContent starts here.\n";
    const result = stripFrontMatter(input);
    expect(result).toBe("Content starts here.\n");
  });
});
