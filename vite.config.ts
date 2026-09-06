import { execSync } from "node:child_process";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// The exact commit a build came from, for the footer stamp (with the version).
// git works in the Cloudflare Workers build (it clones the repo) and in local
// dev; the env var is a belt-and-braces fallback, then a literal so a build
// never fails for want of a SHA.
const buildSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? "dev";
  }
})();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // `dev-dist` lets us verify offline behaviour in `vite dev` instead of
      // discovering service-worker problems only after a deploy.
      devOptions: { enabled: true, type: "module" },
      workbox: {
        // Audio lives in IndexedDB, not the Cache API. The OBS thumbnails
        // (public/obs/thumbs — 598 files, 2.5 MB) were temporarily excluded
        // from the precache by #177: no shipped screen read `thumbUrl`
        // (src/lib/obs/catalog.ts) yet, so precaching them made a first
        // install fetch ~2.6 MB of pictures nothing drew — ~80% of the bytes
        // and 98% of the entries — and Workbox's atomic install meant a
        // single failed fetch restarted the whole set.
        //
        // Restored here (ADR 0006, 2026-09-04 amendment): the Template
        // Library picker (#246, B7's #33) now reads `thumbUrl` — a story's
        // first-frame thumbnail is the row's non-reader handle — so the set
        // is precached again for offline first-run. This is the reader-gated
        // exception ADR 0006 always intended, NOT a move to runtime-caching,
        // which it rejected for its stranding risk. See #177;
        // tests/precache-manifest.test.ts pins the allowlist so a broader
        // glob (or `jpg` returning without a reader) cannot land unnoticed.
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,woff2}"],
        // No single precached asset exceeds the 2 MiB default: the largest is
        // the ~552 KB entry chunk, and the restored thumbnails top out
        // around 5.5 KB each (598 files, ~2.5 MB total) — no size-limit
        // override needed for them.
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
