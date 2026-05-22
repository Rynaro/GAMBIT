import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    setupFiles: [],
  },
  server: {
    port: 5173,
    // Required for Tauri: prevents vite from obscuring rust errors
    strictPort: true,
  },
  // Required for Tauri: prevents vite from clearing the terminal
  clearScreen: false,
  // Tauri expects a fixed port; fail if it is not available
  build: {
    // Tauri supports es2021
    target: "es2021",
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
