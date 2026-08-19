import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "arrdeck",
        short_name: "arrdeck",
        description: "Control panel for the media server stack",
        theme_color: "#0f1219",
        background_color: "#0f1219",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // long-press the home-screen icon; honoured on Android and desktop,
        // ignored by iOS
        shortcuts: [
          { name: "Downloads", url: "/downloads", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
          { name: "Add", url: "/add", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
          { name: "Calendar", url: "/calendar", icons: [{ src: "/pwa-192.png", sizes: "192x192" }] },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3500",
    },
  },
});
