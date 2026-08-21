// Separate from vite.config.ts so the PWA plugin (and its service-worker build)
// stays out of the test run.
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    // jsdom 29 has no Storage implementation; the setup file supplies one
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text"],
      include: ["src/**/*.{ts,tsx}"],
      // generated types, the entry module and the service worker are not
      // exercised by unit tests
      exclude: ["src/api/generated/**", "src/main.tsx", "src/sw.ts", "src/**/*.test.*"],
      // A floor, not a target: the backend has had one since phase D of the last
      // round and the frontend has been able to slide freely. Set just under
      // where the dashboard and detail tests leave it, so a real regression
      // fails CI while ordinary work does not.
      thresholds: {
        statements: 34,
        branches: 78,
        functions: 42,
        lines: 34,
      },
    },
  },
});
