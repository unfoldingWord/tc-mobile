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
//
// `--short=7` pins the length: `git rev-parse --short HEAD` alone varies with
// a repo's `core.abbrev`, and `scripts/check-deploy.mjs`'s consumer side
// (`resolveExpectedSha()`, plus the `compareDeployed` comparison it feeds)
// matches against this value — two correct call sites producing
// different-length short SHAs for the same commit was a false FAIL waiting to
// happen (round-1 George G3). Keep this in sync with `SHA_LENGTH` there.
const buildSha = (() => {
  try {
    return execSync("git rev-parse --short=7 HEAD", {
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

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  build: {
    rollupOptions: {
      // `main.tsx` dynamically imports the Playwright smoke harness (#251),
      // gated on `import.meta.env.MODE === "e2e"`. That runtime guard alone
      // would NOT keep it out of a real build: Rollup discovers a dynamic
      // `import()` target from the module graph regardless of a surrounding
      // condition, so `src/app/e2e-harness.ts` would still be bundled as a
      // reachable (if never actually reached) chunk in `staging`/`main`'s
      // build. Marking it EXTERNAL for every mode but `"e2e"` is what
      // actually excludes it — Rollup then never resolves or bundles the
      // module at all. Verified directly against `dist/`'s output, not
      // inferred (see the PR's local run notes).
      external: mode === "e2e" ? [] : [/\/e2e-harness(\.tsx?)?$/],
    },
  },
  plugins: [
    react(),
    versionJsonPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      // `dev-dist` lets us verify offline behaviour in `vite dev` instead of
      // discovering service-worker problems only after a deploy.
      devOptions: { enabled: true, type: "module" },
      workbox: {
        // Audio lives in IndexedDB, not the Cache API. The OBS thumbnails
        // (public/obs/thumbs — 598 files, 2.5 MB) are temporarily excluded from
        // the precache: no shipped screen reads them yet (`thumbUrl` in
        // src/lib/obs/catalog.ts has no importer), so precaching them made a
        // first install fetch ~2.6 MB of pictures nothing draws — ~80% of the
        // bytes and 98% of the entries — and Workbox's atomic install meant a
        // single failed fetch restarted the whole set. Dropping `jpg` removes
        // them from the manifest; the files still ship in the bundle.
        //
        // End state (ADR 0006, 2026-09-04 amendment): when a screen reads OBS
        // frame imagery — imports/calls `thumbUrl`, or otherwise references
        // the `/obs/thumbs/` path (the Template Library, #33) — RESTORE `jpg`
        // here so the set is precached for offline first-run again. This is a
        // reader-gated exception, NOT a move to runtime-caching, which ADR
        // 0006 rejected for its stranding risk. See #177;
        // tests/precache-manifest.test.ts pins the allowlist so `jpg` (and any
        // broader glob) cannot return unnoticed.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // No single precached asset exceeds the 2 MiB default (the largest is
        // the ~552 KB entry chunk); the former 4 MiB override existed only for
        // the now-excluded thumbnails, which were individually tiny anyway.
        navigateFallback: "index.html",
        // `version.json` is deliberately outside globPatterns (comment above
        // `versionJsonPlugin`) so a `fetch()` always reaches the origin, never
        // a cached copy. But Workbox's navigateFallback intercepts *every*
        // same-origin navigation request, not just missing routes — without
        // this denylist entry, a browser *navigating* to /version.json
        // (typed in the address bar, opened as a link) on an installed PWA
        // would still be served the cached index.html shell. AGENTS.md's
        // "Confirming a deploy" claim that fetching it always reaches the
        // origin is about `check:deploy`'s Node fetch (not navigation-mode,
        // never intercepted); this keeps that true for a browser navigation
        // too (round-3 George #2).
        //
        // Workbox matches this against the request URL's `pathname + search`,
        // so the pattern must tolerate a query string: `check-deploy.mjs`
        // fetches `/version.json?t=<timestamp>` to bust intermediate caches,
        // and a `$`-anchored `/^\/version\.json$/` did not match that at all
        // — the exact URL form this entry exists for was still falling
        // through to the shell (round-5 George G-F2). `(\?|$)` matches the
        // bare path and the query form while still rejecting a different file
        // that merely starts the same way (`/version.jsonfoo`).
        // tests/precache-manifest.test.ts pins that behaviour against this
        // literal.
        navigateFallbackDenylist: [/^\/version\.json(\?|$)/],
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
}));
