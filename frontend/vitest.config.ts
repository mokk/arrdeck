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
    },
  },
});
