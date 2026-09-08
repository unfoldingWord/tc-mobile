import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Service-worker install + precache, against the SHIPPED build (#251
 * assertion 1).
 *
 * Deliberately its own file and its own Playwright project. The other spec
 * needs `src/app/e2e-harness.ts` on `window`, which only `vite build --mode
 * e2e` ships (`dist-e2e/`) — but that build's module graph is NOT the one
 * `staging`/`main` deploy: it carries an extra harness chunk, so its precache
 * manifest has one more entry than `dist/`'s. Asserting the service worker
 * against `dist-e2e/` would therefore assert a graph nobody installs (round-1
 * George G3). This assertion touches no harness, so it can and does run
 * against a plain `vite preview` of `dist/` — the real thing.
 *
 * `playwright.config.ts` stands up both previews on separate ports; separate
 * ports are separate origins, so each build's service worker and Cache Storage
 * are isolated from the other's.
 */

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist"
);

/**
 * The number of DISTINCT cache entries the built `sw.js` will actually put
 * into Cache Storage — not the raw manifest array length, and not hardcoded,
 * so this stays correct as the app's own asset count changes.
 *
 * `sw.js` is normally minified to one line; workbox's own export name
 * (`precacheAndRoute`) survives minification because it is a property key on
 * the imported `workbox-*.js` module, not a local identifier renamed. Entries
 * are extracted with a regex rather than parsed as JSON/eval'd — never a
 * security boundary here, since the file is this build's own output.
 *
 * The entry regex accepts BOTH shapes the manifest can be written in: the
 * minified, unquoted-key form (`{url:"...",revision:...}`) and a
 * pretty-printed, quoted-key one (`{ "url": "...", "revision": ... }`). Which
 * one a build emits depends on the environment's `NODE_ENV`, so a regex that
 * only understood the minified form would throw "parsed zero entries" on a
 * developer's machine while passing in CI — a failure mode that defeats local
 * reproduction of a CI result (round-1 R1). The second test below pins both
 * shapes against the parser directly, so the tolerance cannot rot unnoticed
 * on whichever shape this environment happens not to emit.
 *
 * MUST dedupe by `url + revision`, not count raw array entries: this build's
 * manifest lists each of the three PWA icons TWICE — once because
 * `globPatterns` matches the file directly under `public/icons`, once because
 * `vite-plugin-pwa` also lists every `manifest.icons` entry — with the SAME
 * url and the SAME content-hash revision both times. Workbox's precache
 * controller computes ONE cache key per `{url,revision}` pair (revision-tagged
 * as `?__WB_REVISION__=<hash>` when the url itself carries no content hash),
 * so `cache.put()` for the second duplicate silently overwrites the first —
 * real Chromium's `caches` ends up with fewer entries than the manifest lists.
 * A first draft of this assertion asserted raw length and failed against a
 * genuine headless-Chromium run for exactly this reason — precisely the class
 * of gap this issue exists to catch, so the assertion is deliberately shaped
 * around it rather than loosened to whatever the browser happened to return.
 */
function distinctPrecacheEntryCount(swSource: string): number {
  const match = swSource.match(/precacheAndRoute\(\s*(\[[^\]]*\])/);
  if (!match?.[1]) {
    throw new Error("could not find a precacheAndRoute(...) manifest in sw.js");
  }
  const entries = [
    ...match[1].matchAll(
      /\{\s*"?url"?\s*:\s*"([^"]*)"\s*,\s*"?revision"?\s*:\s*(null|"[^"]*")\s*\}/g
    ),
  ];
  if (entries.length === 0) {
    throw new Error("matched precacheAndRoute(...) but parsed zero entries");
  }
  return new Set(entries.map((m) => `${m[1]}|${m[2]}`)).size;
}

test.describe("service worker install + precache (#251 assertion 1)", () => {
  test("installs and precaches exactly the shipped build's manifest", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);

    const cachedEntryCount = await page.evaluate(async () => {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        total += (await cache.keys()).length;
      }
      return total;
    });

    const expected = distinctPrecacheEntryCount(
      readFileSync(path.join(DIST, "sw.js"), "utf8")
    );
    expect(cachedEntryCount).toBe(expected);
  });

  // Pure, no browser: the parser above is the only thing under test, and the
  // point is the shape this environment does NOT emit. Running it here rather
  // than in the Node suite keeps it beside the regex it guards, and beside the
  // only consumer of that regex.
  test("the manifest parser reads both the minified and the pretty-printed shape", () => {
    const minified =
      'precacheAndRoute([{url:"index.html",revision:"a1"},' +
      '{url:"assets/app.js",revision:null},' +
      '{url:"icons/icon-192.png",revision:"c3"},' +
      '{url:"icons/icon-192.png",revision:"c3"}],{})';
    const pretty = `precacheAndRoute([
      { "url": "index.html", "revision": "a1" },
      { "url": "assets/app.js", "revision": null },
      { "url": "icons/icon-192.png", "revision": "c3" },
      { "url": "icons/icon-192.png", "revision": "c3" }
    ], {})`;

    // Four raw entries, one exact {url,revision} duplicate → three cache keys.
    expect(distinctPrecacheEntryCount(minified)).toBe(3);
    expect(distinctPrecacheEntryCount(pretty)).toBe(3);
  });
});
