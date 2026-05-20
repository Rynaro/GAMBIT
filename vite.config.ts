import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
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
