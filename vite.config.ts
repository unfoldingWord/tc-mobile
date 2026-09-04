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
        // (public/obs/thumbs — 598 files, 2.5 MB) are deliberately excluded
        // from the precache: no shipped screen reads them yet (`thumbUrl` in
        // src/lib/obs/catalog.ts has no importer), so precaching them made a
        // first install fetch ~2.6 MB of pictures nothing draws — ~80% of the
        // bytes and 98% of the entries — and Workbox's atomic install meant a
        // single failed fetch restarted the whole set, stranding a facilitator
        // installing over a slow link. Dropping `jpg` removes them from the
        // manifest; the files still ship in the bundle and can be
        // runtime-cached once the Template Library (#33) gives them a reader.
        // See #177. tests/precache-manifest.test.ts guards against re-adding.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // No single precached asset exceeds the 2 MiB default (the largest is
        // the ~552 KB entry chunk); the former 4 MiB override existed only for
        // the now-excluded thumbnails, which were individually tiny anyway.
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
