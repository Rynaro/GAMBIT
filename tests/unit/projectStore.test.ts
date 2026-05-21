// projectStore.test.ts — unit tests for the localStorage project-path helpers.
// Environment: jsdom (localStorage is available).

import { describe, it, expect, beforeEach } from "vitest";
import {
  getProjectPath,
  setProjectPath,
  clearProjectPath,
} from "@/lib/projectStore";

// Clear localStorage before each test to guarantee isolation.
beforeEach(() => {
  localStorage.clear();
});

describe("projectStore", () => {
  describe("getProjectPath", () => {
    it("returns null when nothing is stored", () => {
      expect(getProjectPath()).toBeNull();
    });

    it("returns null for an empty string value", () => {
      localStorage.setItem("gambit:projectPath", "");
      expect(getProjectPath()).toBeNull();
    });

    it("returns null for a whitespace-only value", () => {
      localStorage.setItem("gambit:projectPath", "   ");
      expect(getProjectPath()).toBeNull();
    });

    it("returns the stored path when valid", () => {
      localStorage.setItem("gambit:projectPath", "/Users/alice/my-project");
      expect(getProjectPath()).toBe("/Users/alice/my-project");
    });
  });

  describe("setProjectPath", () => {
    it("stores the path and getProjectPath returns it", () => {
      setProjectPath("/home/bob/work");
      expect(getProjectPath()).toBe("/home/bob/work");
    });

    it("overwrites a previously stored path", () => {
      setProjectPath("/first");
      setProjectPath("/second");
      expect(getProjectPath()).toBe("/second");
    });
  });

  describe("clearProjectPath", () => {
    it("removes the stored path so getProjectPath returns null", () => {
      setProjectPath("/Users/alice/proj");
      clearProjectPath();
      expect(getProjectPath()).toBeNull();
    });

    it("is a no-op when nothing is stored", () => {
      expect(() => clearProjectPath()).not.toThrow();
      expect(getProjectPath()).toBeNull();
    });
  });

  describe("set / get / clear roundtrip", () => {
    it("set → get → clear → get returns null", () => {
      setProjectPath("/roundtrip/path");
      expect(getProjectPath()).toBe("/roundtrip/path");
      clearProjectPath();
      expect(getProjectPath()).toBeNull();
    });
  });
});
