import { execSync } from "node:child_process";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
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

// A machine-checkable version signal alongside the human-read footer stamp
// (`components/build-stamp.tsx`). Emitted at build time, not committed, so it
// can never drift from the build that produced it — same inputs as the
// footer's __APP_VERSION__/__BUILD_SHA__. It is deliberately `.json`, not one
// of the PWA precache's globPatterns extensions, so a post-promotion check
// fetching it always hits the deployed origin rather than a cached copy.
function versionJsonPlugin(): Plugin {
  return {
    name: "version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source:
          JSON.stringify(
            {
              version: pkg.version,
              sha: buildSha,
              builtAt: new Date().toISOString(),
            },
            null,
            2
          ) + "\n",
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      // `dev-dist` lets us verify offline behaviour in `vite dev` instead of
      // discovering service-worker problems only after a deploy.
      devOptions: { enabled: true, type: "module" },
      // The three home-screen icons already match `globPatterns` below (they
      // live under `public/`), so the plugin's own manifest-icons injection
      // would precache each one a second time under an identical URL (#161).
      includeManifestIcons: false,
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
