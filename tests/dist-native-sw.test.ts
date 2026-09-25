import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDistGate } from "./dist-gate";

/**
 * The native build's `dist/sw.js` and `dist/index.html`, once `npm run
 * build:native` has produced them (#923) — the native counterpart of
 * `tests/precache-manifest.test.ts`'s build-dependent block.
 *
 * `npm run test:dist:native` (`scripts/test-dist-native.mjs`) is the one
 * sanctioned caller: it runs `npm run build:native` first, so by the time
 * this file executes, `dist/sw.js` is vite-plugin-pwa's `selfDestroying`
 * worker (`vite.config.ts`'s `isNativeBuild` branch), not the web build's
 * normal Workbox precache worker. Like `tests/precache-manifest.test.ts`,
 * artifact PRESENCE decides nothing on its own (#568) — only
 * `REQUIRE_DIST_BUILD`, set by the sanctioned caller, does; see
 * `./dist-gate`.
 *
 * Two limitations, named rather than left implicit:
 *
 *   1. This reads whichever build produced the `dist/` on disk. Anyone who
 *      runs `npm run build` (web) after `npm run build:native` and then this
 *      file directly, without going back through `npm run test:dist:native`,
 *      is reading the WRONG artifact — the gate cannot tell the two apart by
 *      content, only the sanctioned caller's ordering keeps them straight.
 *   2. What actually rescues a phone stuck on an old worker — the browser's
 *      own service-worker update check reaching this file's bytes on a real
 *      device — is unverified here and cannot be: this only proves the file
 *      vite-plugin-pwa emits has the shape that mechanism depends on
 *      (self-unregistering, cache-clearing, no precache manifest), not that
 *      an Android WebView or WKWebView actually runs it that way.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SW = path.join(ROOT, "dist", "sw.js");
const INDEX_HTML = path.join(ROOT, "dist", "index.html");

const GATE = resolveDistGate(
  existsSync(SW),
  "dist/sw.js (run `npm run build:native` first)"
);

describe.skipIf(GATE === "skip")(
  "the native build's dist/sw.js (requires a prior `npm run build:native`)",
  () => {
    const sw = readFileSync(SW, "utf8");

    it("self-unregisters on activate, rather than precaching anything", () => {
      // The exact behaviour a phone stuck on an OLD worker needs: this is
      // what the browser's own update check swaps in when it re-fetches the
      // already-registered sw.js URL and finds different bytes (#923).
      expect(sw).toMatch(/self\.registration\.unregister\(\)/);
      expect(sw).toMatch(/self\.skipWaiting\(\)/);
    });

    it("clears Cache Storage on activate", () => {
      expect(sw).toMatch(/self\.caches\.keys\(\)/);
      expect(sw).toMatch(/self\.caches\.delete\(/);
    });

    it("never precaches — no Workbox precache manifest", () => {
      // The one thing #923 identifies as actively harmful on native: an
      // offline precache the WebView never needs, serving a stale bundle
      // after the APK underneath it changes. `precacheAndRoute` is the call
      // Workbox's generateSW output always makes when it precaches anything
      // (see the non-native block `tests/precache-manifest.test.ts` reads);
      // its absence here is the native build's whole point.
      expect(sw).not.toMatch(/precacheAndRoute/);
    });

    it("never references IndexedDB", () => {
      // Belt-and-braces on top of `src/lib/service-worker-policy.ts`'s own
      // structural guarantee (its cleanup bridge has no IndexedDB access at
      // all): the emitted service-worker script itself must not name the
      // API the recordings live behind.
      expect(sw).not.toMatch(/indexedDB/i);
    });
  }
);

describe.skipIf(GATE === "skip")(
  "the native build's dist/index.html (requires a prior `npm run build:native`)",
  () => {
    it("ships no auto-injected service-worker registration script", () => {
      // vite.config.ts sets `injectRegister: false` for the native build
      // (isNativeBuild), so nothing in a fresh native install can create a
      // registration through vite-plugin-pwa's default path — only
      // `src/hooks/register-service-worker.ts` may register, and it never
      // does on native (`isNativeShell()`).
      const html = readFileSync(INDEX_HTML, "utf8");
      expect(html).not.toMatch(/vite-plugin-pwa:register-sw/);
      expect(html).not.toMatch(/registerSW\.js/);
    });
  }
);
