import { execSync } from "node:child_process";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };
// Extension spelled out, unlike the `@/`-aliased imports inside `src/`. This
// specifier is resolved by the CONFIG loader, not by Vite's own bundler
// resolution, so extensionless lookup is not available to it: Vite already
// warns that `configLoader: 'native'` (planned to become the default) cannot
// resolve it, and `vite build --configLoader native` fails outright with
// ERR_MODULE_NOT_FOUND. `allowImportingTsExtensions` in tsconfig.node.json is
// what lets the `.ts` be named here (Frank R1, #697).
import { SHIPPED_LOCALE, withLocaleAttributes } from "./src/lib/locale.ts";

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
// happen (round-1 George G3). Keep this in sync with `SHA_LENGTH` there. The
// `WORKERS_CI_COMMIT_SHA?.slice(0, 7)` fallback below carries the same `7`
// for the same reason — round-3 George P3-3 found it was a second unshared
// literal `tests/check-deploy.test.ts`'s drift guard didn't cover; that test
// now pins both lines, not just the `execSync` call.
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

// `<html lang>`/`dir` from the one locale rather than from a literal in the
// document (#169). `index.html` ships the same two values statically so the
// file a human opens is not misleading, and `tests/locale.test.ts` pins the
// two together — but this hook is what actually decides them, in dev and in
// `build` alike, so the dev server and `dist/` cannot disagree. The transform
// itself is `lib/locale.ts`, DOM-free and unit-tested; this is only the seam
// that hands it the document. `order: "pre"` so it runs on the authored
// markup, before VitePWA injects the manifest link and the SW registration.
function localeHtmlPlugin(): Plugin {
  return {
    name: "locale-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => withLocaleAttributes(html, SHIPPED_LOCALE),
    },
  };
}

export default defineConfig(({ mode }) => {
  // Native-only build mode (`vite build --mode native`, `npm run
  // build:native`). Capacitor's WebView loads the bundle from local files
  // (`capacitor.config.ts`, `webDir: "dist"`), so a Workbox offline precache
  // adds nothing there — and a STALE one is the entirety of #923: an APK
  // upgraded in place kept running the old bundle because nothing stopped
  // the Workbox service worker vite-plugin-pwa injects for the web PWA from
  // also registering inside the Capacitor WebView, and Android's app-upgrade
  // path (unlike uninstall) preserves that registration and its Cache
  // Storage entries across the upgrade.
  const isNativeBuild = mode === "native";

  return {
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
      localeHtmlPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        // `dev-dist` lets us verify offline behaviour in `vite dev` instead of
        // discovering service-worker problems only after a deploy.
        devOptions: { enabled: true, type: "module" },
        // Web build: unchanged default ("auto" — vite-plugin-pwa's own
        // auto-injected `<script>` still registers `/sw.js` on `window`'s
        // `load`, exactly as today). Native build (#923): no injected
        // registration script at all, so nothing in a fresh native install can
        // create a service-worker registration through the default path —
        // `src/hooks/register-service-worker.ts` is the one place a native
        // build may choose to register, and it always chooses not to
        // (`isNativeShell()`). Explicit rather than left to the "auto" default
        // for BOTH builds: `injectRegister === "auto"` also happens to be what
        // makes vite-plugin-pwa set `workbox.skipWaiting`/`clientsClaim` for us
        // below (`node_modules/vite-plugin-pwa/dist/index.js`, the
        // `registerType === "autoUpdate"` branch) — setting those two
        // explicitly, rather than relying on that side effect, is what keeps
        // the web build's behaviour identical once `injectRegister` starts
        // varying by mode.
        injectRegister: isNativeBuild ? false : "auto",
        // Native build only (#923): swap the emitted `dist/sw.js` for
        // vite-plugin-pwa's own built-in self-unregistering, cache-clearing
        // worker (`generateServiceWorker`'s `selfDestroying` branch in
        // `node_modules/vite-plugin-pwa/dist/index.js`) instead of the normal
        // Workbox precache worker. This is what actually reaches a phone that
        // upgraded in place while still running an OLD worker: the browser's
        // OWN service-worker update check re-fetches the already-registered
        // `sw.js` script URL and byte-compares it — independent of whatever
        // JavaScript this build ships, so it works even on the very first
        // native launch after the upgrade, before any of this build's own code
        // has run. `src/hooks/register-service-worker.ts` is the runtime
        // belt-and-braces line for every launch after that.
        selfDestroying: isNativeBuild,
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
          // Explicit rather than left to `injectRegister === "auto"`'s side
          // effect (see the comment above `injectRegister`) — `true` either
          // way for the web build, which is what today's behaviour already is;
          // simply unused for the native build, since `selfDestroying: true`
          // skips `generateSW` (and so this whole `workbox` object) entirely.
          skipWaiting: true,
          clientsClaim: true,
        },
        manifest: {
          name: "translationCore Mobile",
          short_name: "tC Mobile",
          description:
            "Offline audio notebook and editor for oral Bible translation",
          // Same locale the document is labelled with, not a second copy of it
          // (#169). `dir` was absent entirely: a manifest with no direction
          // leaves the install prompt and the app-list entry laid out
          // left-to-right whatever language their text is in.
          lang: SHIPPED_LOCALE.tag,
          dir: SHIPPED_LOCALE.dir,
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          // `--p-cool-950`, which `--s-floor` resolves to in the dark theme.
          // Was #0b0f14 — a value no token in this app has ever had, so the
          // install splash and the task-switcher tint were two units off the
          // floor the body actually paints (#171). A manifest is read at install
          // time and cannot follow a runtime theme switch, so this necessarily
          // stays DARK even for a translator who has chosen the light screen;
          // what does follow them is `meta[name="theme-color"]`, repainted from
          // the computed token in `hooks/use-theme.ts`.
          background_color: "#0b1016",
          theme_color: "#0b1016",
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
  };
});
