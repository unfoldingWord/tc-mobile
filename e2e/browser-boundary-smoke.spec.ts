import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Headless-Chromium smoke for the browser-only paths (#251).
 *
 * Every path here is exercised in Node today only through a fake: the worker
 * round-trip through `FakeWorker` (`tests/mp3-codec.test.ts`,
 * `tests/encoder-lane.test.ts`), `decodeAudioData` never at all (`lib/`
 * cannot see it by construction — AGENTS.md), the service worker's atomic
 * precache install asserted only by grepping `vite.config.ts`'s source
 * (`tests/precache-manifest.test.ts`), and IndexedDB's `blocked`/
 * `versionchange` dance against `fake-indexeddb`, which is its own
 * implementation of the spec, not the browser's. A fake that agrees with the
 * reasoning proves the reasoning, not the browser — this file is the cheapest
 * evidence between that and someone's phone.
 *
 * Deliberately NOT a UI test suite: no screenshots, and no clicking through
 * Books → Segments → Recorder. `src/app/e2e-harness.ts` (shipped only by
 * `vite build --mode e2e`, see `vite.config.ts`) calls the exact modules those
 * screens call — `hooks/mp3-codec.ts`'s real Worker, `lib/storage/db.ts`'s
 * real `getDb`, `lib/audio/mp3-align.ts`'s real `fitMp3Decode` — so what is
 * proven is the same code the screens run, without a fake microphone or a
 * simulated tap driving fragile UI timing.
 *
 * Scope cut, disclosed: the issue's fix-shape step 3 also asks for "at least
 * one `progress` message before `done`". On `develop` HEAD, `mp3.worker.ts`'s
 * protocol is one request → one `done`/`error` — no `progress` message exists
 * yet. That heartbeat is added by #207 (open, draft, unmerged as of this PR).
 * Asserting it here would either fabricate a pass against code that doesn't
 * emit it, or require implementing #207's deadline feature inside a smoke-test
 * PR — out of scope for #251. The round-trip itself (a real MP3 comes back
 * from the real worker) is asserted in full below; once #207 merges, extending
 * this spec to also assert the heartbeat is a small, separate follow-up.
 */

const DIST_E2E = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-e2e"
);

/**
 * The number of DISTINCT cache entries the built `sw.js` will actually put
 * into Cache Storage — not the raw manifest array length, and not hardcoded,
 * so this stays correct as the app's own asset count changes.
 *
 * `sw.js` is minified to one line; workbox's own export name
 * (`precacheAndRoute`) survives minification because it is a property key on
 * the imported `workbox-*.js` module, not a local identifier renamed. Entries
 * are extracted with a regex rather than parsed as JSON/eval'd, since they use
 * unquoted keys (`{url:"...",revision:...}`) — never a security boundary
 * here, since the file is this build's own output.
 *
 * MUST dedupe by `url + revision`, not count raw array entries: this build's
 * manifest lists each of the three PWA icons TWICE — once because
 * `globPatterns` matches the file directly under `public/icons`, once because
 * `vite-plugin-pwa` also lists every `manifest.icons` entry — with the SAME
 * url and the SAME content-hash revision both times (observed directly
 * against `dist-e2e/sw.js`: 14 raw entries, 3 exact `{url,revision}`
 * duplicates). Workbox's precache controller computes ONE cache key per
 * `{url,revision}` pair (revision-tagged as `?__WB_REVISION__=<hash>` when the
 * url itself carries no content hash), so `cache.put()` for the second
 * duplicate silently overwrites the first — real Chromium's `caches` ends up
 * with 11 entries for a 14-entry manifest, not 14. A first draft of this
 * assertion asserted raw length and failed against a genuine headless-Chromium
 * run for exactly this reason — precisely the class of gap this issue exists
 * to catch, so the assertion is deliberately shaped around it rather than
 * loosened to whatever the browser happened to return.
 */
function distinctPrecacheEntryCount(): number {
  const sw = readFileSync(path.join(DIST_E2E, "sw.js"), "utf8");
  const match = sw.match(/precacheAndRoute\((\[[^\]]*\])/);
  if (!match?.[1]) {
    throw new Error("could not find a precacheAndRoute(...) manifest in sw.js");
  }
  const entries = [
    ...match[1].matchAll(/\{url:"([^"]*)",revision:(null|"[^"]*")\}/g),
  ];
  if (entries.length === 0) {
    throw new Error("matched precacheAndRoute(...) but parsed zero entries");
  }
  const keys = new Set(entries.map((m) => `${m[1]}|${m[2]}`));
  return keys.size;
}

declare global {
  interface Window {
    __e2e?: {
      encodeAndDecode: (frameCount: number) => Promise<{
        mp3Length: number;
        decodedFrameCount: number;
        expectedFrameCount: number;
      }>;
      openDb: () => Promise<{ name: string; version: number }>;
      watchVersionChange: () => void;
      versionChangeFired?: boolean;
    };
  }
}

/** The harness attaches `window.__e2e` from a `<script type="module">`; wait for it. */
async function waitForHarness(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => typeof window.__e2e !== "undefined");
}

test.describe("service worker install + precache (#251 assertion 1)", () => {
  test("installs and precaches exactly this build's manifest", async ({
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

    expect(cachedEntryCount).toBe(distinctPrecacheEntryCount());
  });
});

test.describe("worker MP3 encode round-trip + decodeAudioData (#251 assertions 2-3)", () => {
  test("a real worker encode returns an MP3, and a real decodeAudioData recovers the frame count", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    // 3 s of synthetic PCM at the canonical rate, per the issue's fix shape.
    const frameCount = 44_100 * 3;
    const result = await page.evaluate(
      (n) => window.__e2e!.encodeAndDecode(n),
      frameCount
    );

    // Assertion 2: the real mp3.worker.ts round-trip returns real MP3 bytes.
    // An MPEG-1 Layer III frame header is at least a few bytes; a genuine 3 s
    // encode at 64 kbps is on the order of tens of KB, so this floor rules out
    // an empty or truncated result without pinning an exact byte count that
    // would break on every encoder tuning change.
    expect(result.mp3Length).toBeGreaterThan(10_000);

    // Assertion 3: decodeAudioData is a real browser API call here, not
    // `lib/`'s injected fake — `fitMp3Decode` (`lib/audio/mp3-align.ts`) must
    // correctly identify which of the three known decoder behaviours this
    // browser's `decodeAudioData` used and align to it. `fitToFrames` always
    // returns exactly the requested length, so equality (not a tolerance
    // window) is the meaningful assertion: it can only hold if the alignment
    // branch matched what Chromium's decoder actually did.
    expect(result.decodedFrameCount).toBe(result.expectedFrameCount);
  });
});

test.describe("two-tab IndexedDB blocked/versionchange (#251 assertion 4)", () => {
  test("the app's real connection sees a native versionchange; a concurrent delete stays blocked", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const pageA = await context.newPage();
      const pageB = await context.newPage();

      await pageA.goto("/");
      await waitForHarness(pageA);
      // Opens the app's REAL getDb() singleton and keeps the connection alive.
      await pageA.evaluate(() => window.__e2e!.openDb());
      await pageA.evaluate(() => window.__e2e!.watchVersionChange());

      // Same-origin, so it shares the IndexedDB the app just opened. Loading
      // the app here too (rather than a blank page) matches what a second
      // real tab of this PWA looks like.
      await pageB.goto("/");

      const outcome = await pageB.evaluate(
        () =>
          new Promise<"blocked" | "success" | "error" | "timeout">(
            (resolve) => {
              const req = indexedDB.deleteDatabase("tc-mobile");
              const timer = setTimeout(() => resolve("timeout"), 5_000);
              req.onblocked = () => {
                clearTimeout(timer);
                resolve("blocked");
              };
              req.onsuccess = () => {
                clearTimeout(timer);
                resolve("success");
              };
              req.onerror = () => {
                clearTimeout(timer);
                resolve("error");
              };
            }
          )
      );

      // `src/lib/storage/db.ts` on `develop` HEAD attaches no `blocking()`
      // handler (that lands in #236/#240, both open drafts, unmerged as of
      // this PR) — so the app's own connection never closes itself on a
      // native `versionchange`, and a concurrent delete from another tab
      // stays genuinely `blocked` rather than proceeding. This is real
      // Chromium IndexedDB behaviour through the app's real connection, not
      // an inference from `fake-indexeddb`. Once #236/#240 land and `db.ts`
      // closes on `versionchange`, this assertion is expected to flip to
      // `"success"` — updating it then is that change's job, not a
      // regression in this one.
      expect(outcome).toBe("blocked");

      const versionChangeFired = await pageA.evaluate(
        () => window.__e2e!.versionChangeFired
      );
      expect(versionChangeFired).toBe(true);
    } finally {
      // Closes pageA's connection too, letting the pending delete request
      // (if any observer were still waiting on it) proceed — good hygiene
      // even though nothing here awaits that completion.
      await context.close();
    }
  });
});
