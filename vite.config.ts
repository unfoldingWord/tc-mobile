import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { NATIVE_TEARDOWN_SW } from "./src/lib/service-worker-policy.ts";

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

// The same commit's FULL id, for the About screen's source links (#36): a
// link that must name one exact commit uses all 40 hex characters rather than
// the 7-character stamp above (Frank round 6 on #144). Emitted in
// version.json as `shaFull` so tests/dist-source-offer.test.ts can check the
// built links against it.
const buildShaFull = (() => {
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return process.env.WORKERS_CI_COMMIT_SHA ?? "dev";
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
              shaFull: buildShaFull,
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

// Build provenance (#36; Frank round 3 on #1019). The licence disclosure's
// completeness test walks the package-lock runtime closure, which cannot see
// code the BUILD writes into `dist/` from a dev dependency — a bundler
// runtime, a polyfill, a generated service worker. This records every such
// piece that lands in the output, with its owning package, in
// `dist/build-provenance.json` (outside the precache globPatterns, like
// version.json); tests/dist-source-offer.test.ts fails when it names a package
// the disclosure does not cover. Recorded:
// - every bundled module (app and worker builds) whose id is virtual (`\0…`,
//   owned by its first path segment's package) or resolves into a dev package,
// - every bare `@import`/`@plugin` a bundled stylesheet pulls from a dev
//   package (PostCSS inlines Tailwind's CSS outside the module graph),
// - every emitted `.js` no chunk accounts for and public/ did not supply
//   (vite-plugin-pwa's generateSW step), attributed by GENERATED_JS. An
//   unrecognised one gets a null package, which the gate fails on.
interface Provenance {
  module: string;
  package: string | null;
  version: string | null;
}

const GENERATED_JS: readonly (readonly [RegExp, string])[] = [
  [/^sw\.js$/, "workbox-build"],
  [/^workbox-[\w-]+\.js$/, "workbox-build"],
  [/^registerSW\.js$/, "vite-plugin-pwa"],
];

function buildProvenancePlugins(): { app: Plugin; worker: () => Plugin[] } {
  const root = import.meta.dirname;
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8")
  ) as { packages: Record<string, { dev?: boolean }> };
  const found = new Map<string, Provenance>();
  const chunks = new Set<string>();
  const pkgOf = (spec: string) =>
    spec
      .split("/")
      .slice(0, spec.startsWith("@") ? 2 : 1)
      .join("/");
  const record = (module: string, pkg: string | null, dir?: string) => {
    const file =
      pkg && path.join(root, dir ?? `node_modules/${pkg}`, "package.json");
    const version =
      file && existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as { version: string })
            .version
        : null;
    found.set(module, { module, package: version ? pkg : null, version });
  };
  const recordCss = (file: string, seen: Set<string>) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const css = readFileSync(file, "utf8");
    for (const [, spec] of css.matchAll(
      /@(?:import|plugin)\s+["']([^"']+)["']/g
    )) {
      if (spec!.startsWith(".")) {
        recordCss(path.resolve(path.dirname(file), spec!), seen);
      } else if (lock.packages[`node_modules/${pkgOf(spec!)}`]?.dev) {
        record(
          `@import "${spec}" in ${path.relative(root, file)}`,
          pkgOf(spec!)
        );
      }
    }
  };
  const recordModule = (rawId: string) => {
    if (rawId.startsWith("\0")) {
      record(rawId.replace("\0", "\\0"), pkgOf(rawId.slice(1)));
      return;
    }
    const id = rawId.split("?")[0]!;
    const rel = path.relative(root, id);
    if (!path.isAbsolute(id) || rel.startsWith("..")) return record(id, null);
    const at = rel.lastIndexOf("node_modules/");
    if (at === -1) {
      if (id.endsWith(".css")) recordCss(id, new Set());
      return;
    }
    const pkg = pkgOf(rel.slice(at + "node_modules/".length));
    const dir = rel.slice(0, at) + `node_modules/${pkg}`;
    if (lock.packages[dir]?.dev) record(rel, pkg, dir);
  };
  const collect = (name: string): Plugin => ({
    name,
    apply: "build",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        chunks.add(out.fileName);
        out.moduleIds.forEach(recordModule);
      }
    },
  });
  let outDir = "";
  let publicDir = "";
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : [path.relative(outDir, path.join(dir, e.name))]
    );
  const app: Plugin = {
    ...collect("build-provenance"),
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    // After vite-plugin-pwa's own closeBundle, which runs generateSW.
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        for (const file of walk(outDir)) {
          if (!/\.m?js$/.test(file) || chunks.has(file)) continue;
          if (publicDir && existsSync(path.join(publicDir, file))) continue;
          record(file, GENERATED_JS.find(([re]) => re.test(file))?.[1] ?? null);
        }
        const entries = [...found.values()].sort((a, b) =>
          a.module.localeCompare(b.module)
        );
        writeFileSync(
          path.join(outDir, "build-provenance.json"),
          JSON.stringify(entries, null, 2) + "\n"
        );
      },
    },
  };
  return { app, worker: () => [collect("build-provenance-worker")] };
}

const provenance = buildProvenancePlugins();

// Native build only (#923): overwrite the `sw.js` vite-plugin-pwa's
// `selfDestroying` branch just wrote with `NATIVE_TEARDOWN_SW`, whose teardown
// is bound to the activate event's lifetime via `waitUntil` — the plugin's own
// script is not (see that constant's docblock). `closeBundle` is where the
// plugin writes its worker; `order: "post"` + `sequential` runs this after it.
// `selfDestroying` stays on so the plugin still skips Workbox's generateSW.
function nativeTeardownSwPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "native-teardown-sw",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        writeFileSync(path.join(outDir, "sw.js"), NATIVE_TEARDOWN_SW, "utf8");
      },
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
      __BUILD_SHA_FULL__: JSON.stringify(buildShaFull),
    },
    build: {
      // Pinned to the app's stated floor (#1017 open question 1) rather than
      // left to Vite 8's own default, `"baseline-widely-available"` — a
      // rolling snapshot (`ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET` in
      // `node_modules/vite/dist/node/chunks/node.js`) that is bumped on every
      // Vite major and today resolves to `safari16.4`/`ios16.4`, above even
      // this floor. `chrome111`/`edge111`/`firefox114` are carried over
      // unchanged from that same default: the Android floor
      // (`android/variables.gradle`'s `minSdkVersion = 24`, Android 7.0) is
      // stated everywhere (this file's own draft wording,
      // `docs/native/system-requirements.md`) as conditional on Android
      // System WebView being kept up to date, so nothing found this build
      // checking called for lowering those three.
      //
      // The Safari/iOS entries are **15.4, not the app's original 15.0**
      // floor. #1051 found that the
      // O4 CSS (`src/app/styles/o4/menus.css`, `sheets.css`, `motion.css`)
      // ships a `:has()` selector that needs Safari/iOS 15.4 (caniuse-lite's
      // `data/features/css-has.js`) — a real gap against 15.0 that no
      // `build.target`/`cssTarget` setting can close (verified: LightningCSS
      // passes `:has()` through unchanged and warning-free at any target;
      // there is no downlevel transform for a CSS selector). #1052 gave the
      // DRI two options — raise the floor, or rewrite 13 `:has()` sites — and
      // the decision (2026-09-26, "Raise floor to 15.4 (Recommended)") was
      // the former, so the JS/CSS build target here now matches the raised
      // documented floor. Note: `ios/App/App.xcodeproj/project.pbxproj`'s
      // `IPHONEOS_DEPLOYMENT_TARGET` still reads `15.0` in this tree — this
      // change only raises what the requirements doc and this build target
      // state; moving the actual Xcode deployment target (and the store
      // listings) is separate, out-of-scope work for whoever picks up
      // #1052's other side. See `docs/native/system-requirements.md` for the
      // full resolution and that residual.
      //
      // This is otherwise a forward guard, not a fix for something broken
      // today: a build-artifact scan (`tests/build-target-floor.test.ts`,
      // gated on `dist/` the same way `tests/dist-css.test.ts` is) found no
      // JS syntax in the current `dist/` that the OLD Vite default wouldn't
      // already have shipped safely to iOS 15.4 — but nothing pinned that, so
      // a future dependency or source change using e.g. a class static
      // initialization block (needs Safari/iOS 16.4 per
      // `@babel/compat-data`'s `data/plugins.json`,
      // `transform-class-static-block`) would have shipped untranspiled and
      // silently broken below 16.4. Pinning the target here means Vite's own
      // `vite:esbuild-transpile` `renderChunk` pass (real esbuild, not just
      // rolldown's bundler pass — `resolveEsbuildTranspileOptions` in the
      // same vite chunk) downlevels or fails the build on such syntax instead
      // of shipping it untouched. `build.cssTarget` (LightningCSS's
      // `targets`, the active CSS minifier here since `cssMinify` defaults to
      // `true` for a non-`lib` build) derives from this same value
      // (`cssTarget: merged.cssTarget ?? merged.target`), so one setting
      // covers both.
      target: ["chrome111", "edge111", "firefox114", "safari15.4", "ios15.4"],
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
    worker: { plugins: provenance.worker },
    plugins: [
      react(),
      versionJsonPlugin(),
      localeHtmlPlugin(),
      provenance.app,
      ...(isNativeBuild ? [nativeTeardownSwPlugin()] : []),
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
        // Native build only (#923): skip the normal Workbox precache worker.
        // The plugin's `selfDestroying` branch writes its own teardown script,
        // which `nativeTeardownSwPlugin` above then replaces with
        // `NATIVE_TEARDOWN_SW` (lifetime-bound via `waitUntil`). The emitted
        // `dist/sw.js` is what actually reaches a phone that
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
          //
          // `txt` precaches the licence texts under `public/licenses/` (#36) so
          // the LGPL notice resolves offline in the field, same as the app shell
          // — small files (the largest is the ~42 KB LGPL text), unrelated to the
          // thumbnail exclusion above.
          globPatterns: ["**/*.{js,css,html,svg,png,woff2,txt}"],
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
          // The licence texts (#36) are real files, not app routes: keep the SPA
          // navigate-fallback from answering a `/licenses/*.txt` miss with the app
          // shell instead of the licence (George G1). The About panel reads them
          // by fetch, not navigation, so this only hardens the edge.
          navigateFallbackDenylist: [/^\/version\.json(\?|$)/, /\.txt$/],
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
