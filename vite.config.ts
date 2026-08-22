import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // `dev-dist` lets us verify offline behaviour in `vite dev` instead of
      // discovering service-worker problems only after a deploy.
      devOptions: { enabled: true, type: "module" },
      workbox: {
        // Audio lives in IndexedDB, not the Cache API. The OBS thumbnails do
        // get precached (598 files, 2.5 MB): a facilitator installs this over
        // wifi and then goes to the field, so waiting for a story to be
        // browsed once before its pictures cache would strand them.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,jpg}"],
        // 598 thumbnails push the precache past the 2 MiB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "translationCore Mobile",
        short_name: "tC Mobile",
        description:
          "Offline audio notebook and editor for oral Bible translation",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
