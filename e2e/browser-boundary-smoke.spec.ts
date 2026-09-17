import { expect, test } from "@playwright/test";

/**
 * Headless-Chromium smoke for the browser-only paths (#251), assertions 2-4.
 *
 * Every path here is exercised in Node today only through a fake: the worker
 * round-trip through `FakeWorker` (`tests/mp3-codec.test.ts`,
 * `tests/encoder-lane.test.ts`), `decodeAudioData` never at all (`lib/`
 * cannot see it by construction — AGENTS.md), and IndexedDB's `blocked`/
 * `versionchange` dance against `fake-indexeddb`, which is its own
 * implementation of the spec, not the browser's. A fake that agrees with the
 * reasoning proves the reasoning, not the browser — this file is the cheapest
 * evidence between that and someone's phone.
 *
 * Assertion 1 (the service worker's precache install) is NOT here: it needs no
 * harness, so it runs against the real `dist/` build in
 * `service-worker-precache.spec.ts`. This file needs `window.__e2e`, which
 * only `dist-e2e/` carries.
 *
 * Deliberately NOT a UI test suite: no screenshots, and no clicking through
 * Books → Segments → Recorder. `src/app/e2e-harness.ts` (shipped only by
 * `vite build --mode e2e`, see `vite.config.ts`) calls the exact modules those
 * screens call — `hooks/mp3-codec.ts`'s real Worker, `lib/storage/db.ts`'s
 * real `getDb`, `lib/audio/mp3-align.ts`'s real `fitMp3Decode` — so what is
 * proven is the same code the screens run, without a fake microphone or a
 * simulated tap driving fragile UI timing.
 *
 * The issue's fix-shape step 3 also asked for "at least one `progress` message
 * before `done`". That heartbeat did not exist when this spec was written; #166
 * (PR #279) added it, and the heartbeat describe below asserts it — and more
 * than its existence: that a BUSY worker's heartbeat actually reaches the main
 * thread well inside the silence deadline, over an encode long enough for that
 * to matter (George R4 residual 1 on #279).
 */

/**
 * Ten minutes of canonical PCM — the "ten-minute segment" #175's memory figures
 * are written about. Three minutes was tried first: it encoded in 1.2 s on the
 * dev container, which is only two or three heartbeat intervals (the worker
 * throttles to one every 500 ms) and too thin a margin for a gap measurement
 * to mean much. Ten minutes gives several intervals even on a fast machine and
 * still keeps two encodes to seconds. The measured timings are logged, so a
 * slower runner shows up in the output rather than as a mystery.
 */
const HEARTBEAT_CLIP_FRAMES = 44_100 * 600;

/** Samples per MPEG-1 Layer III granule (`lib/audio/mp3-align.ts`). */
const MP3_GRANULE = 1152;
/** A standard decoder's own delay, which some decoders trim and some do not. */
const MP3_DECODER_DELAY = 529;

declare global {
  interface Window {
    __e2e?: {
      encodeAndDecode: (frameCount: number) => Promise<{
        mp3Length: number;
        rawDecodedFrameCount: number;
        emittedFrameCount: number;
        fittedFrameCount: number;
        expectedFrameCount: number;
        rmsWindow: number;
        fittedHeadRms: number;
        fittedTailRms: number;
        sourceRms: number;
      }>;
      encodeWithHeartbeat: (frameCount: number) => Promise<{
        frameCount: number;
        codecMp3Length: number;
        codecEncodeMs: number;
        stalledName: string | null;
        progressCount: number;
        directEncodeMs: number;
        maxGapMs: number;
        deadlineMs: number;
      }>;
      encodeAfterAbortRebuild: (frameCount: number) => Promise<{
        aborted: boolean;
        chunkRequestsBefore: number;
        chunkRequestsAfter: number;
        mp3Length: number;
      }>;
      workerSnapshotFetched: () => boolean;
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

test.describe("worker MP3 encode round-trip + decodeAudioData (#251 assertions 2-3)", () => {
  test("a real worker encode returns an MP3, and a real decodeAudioData lands on the recording", async ({
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
    // identify which of the three known decoder behaviours this browser's
    // `decodeAudioData` used and align to it.
    //
    // What is NOT asserted, and why: the FITTED length. `fitMp3Decode` ends in
    // `fitToFrames`, which returns exactly `frames` in all three of its
    // branches (`lib/audio/edit.ts`) — so `fitted.length === frameCount` holds
    // whatever head skip the alignment picked, including a wrong one. Round 1
    // asserted exactly that and proved nothing (round-1 Frank C1). It is kept
    // below only as a cheap invariant on `fitToFrames`, not as evidence of
    // alignment.
    expect(result.fittedFrameCount).toBe(result.expectedFrameCount);

    // The RAW decode length is what actually says what the browser did. It
    // must be one of the three lengths `fitMp3Decode` knows how to align:
    // every granule emitted (trimmed nothing), that minus the decoder's own
    // 529 (trimmed its own delay), or exactly the fed-in count (trimmed both,
    // honouring a tag lamejs does not write). Any other length means this
    // browser is a decoder the module has never met and is being handled by
    // its clamped best-effort fallback — which is precisely the thing a Node
    // fake cannot tell us, so it is asserted rather than assumed.
    expect(result.emittedFrameCount).toBeGreaterThanOrEqual(frameCount);
    expect([
      result.emittedFrameCount,
      result.emittedFrameCount - MP3_DECODER_DELAY,
      frameCount,
    ]).toContain(result.rawDecodedFrameCount);
    // The emitted length is whole granules of a real stream's frame headers.
    expect(result.emittedFrameCount % MP3_GRANULE).toBe(0);

    // And the alignment must land on the RECORDING, not on the priming or the
    // padding. The harness feeds a 440 Hz tone at amplitude 8000, so every
    // window of the recording has an RMS near 8000/√2; the decoder's ~1105
    // samples of priming, and the encoder's tail padding, are silence. A head
    // skip that is too small leaves priming at the front, one that is too
    // large runs off the end into padding — either way one of these two windows
    // reads ~0 while a fitted-length check stays green. Bounds are loose (half
    // to 1.5x the source's own RMS over the same window) because a 64 kbps
    // lossy round-trip is not sample-exact; the failure being caught is
    // silence, which is an order of magnitude away, not a few percent.
    expect(result.sourceRms).toBeGreaterThan(1_000);
    expect(result.fittedHeadRms).toBeGreaterThan(result.sourceRms * 0.5);
    expect(result.fittedHeadRms).toBeLessThan(result.sourceRms * 1.5);
    expect(result.fittedTailRms).toBeGreaterThan(result.sourceRms * 0.5);
    expect(result.fittedTailRms).toBeLessThan(result.sourceRms * 1.5);
  });
});

test.describe("the encoder heartbeat through a real busy worker (#166, #279 George R4 residual 1)", () => {
  test("a multi-minute encode completes under the deadline, and its heartbeat gaps stay far inside it", async ({
    page,
  }) => {
    // Two multi-minute encodes; generous, and logged below.
    test.setTimeout(180_000);
    await page.goto("/");
    await waitForHarness(page);

    const r = await page.evaluate(
      (n) => window.__e2e!.encodeWithHeartbeat(n),
      HEARTBEAT_CLIP_FRAMES
    );
    console.log(
      `[heartbeat] ${r.frameCount / 44_100}s clip: codec encode ${Math.round(r.codecEncodeMs)} ms; ` +
        `instrumented encode ${Math.round(r.directEncodeMs)} ms, ` +
        `${r.progressCount} progress messages, max gap ${Math.round(r.maxGapMs)} ms ` +
        `(deadline ${r.deadlineMs} ms)`
    );

    // (a) Through the app's real lane, deadline armed: no stall, real bytes.
    expect(r.stalledName).toBeNull();
    expect(r.codecMp3Length).toBeGreaterThan(100_000);

    // The measurement only means something if the encode outlasted several
    // heartbeat intervals. If a much faster machine ever finishes in under a
    // second, this fails loudly and the clip length needs raising — rather than
    // passing on a gap that was never given the chance to grow.
    expect(r.directEncodeMs).toBeGreaterThan(2_000);

    // (b) The busy worker's heartbeat reaches the main thread while it works —
    // not one beat, but a steady stream across the encode.
    expect(r.progressCount).toBeGreaterThanOrEqual(3);

    // (c) The longest silence the main thread saw — request to first message,
    // beat to beat, last beat to `done` — is far inside the deadline. A fifth
    // of it leaves room for a phone several times slower than this runner. If
    // this fails, the deadline design is wrong, not this bound.
    expect(r.maxGapMs).toBeLessThan(r.deadlineMs / 5);
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
      // BOTH documents hold a live `getDb()` connection, not just page A:
      // mounting the app runs `App.tsx`'s transcode sweep and `BooksScreen`'s
      // `useBooks`, each of which calls the same singleton. Settle page B's
      // own open BEFORE deleting, or the delete races this test's own fixture
      // rather than the thing under test (round-2 George G-4). `openDb()` here
      // opens nothing extra — `getDb()` is a memoized promise, so awaiting it
      // just waits for the connection the mount already started. This matters
      // most when #236/#240 land and the expected outcome flips to
      // `"success"`: an in-flight open with no `versionchange` handler yet
      // attached would keep the result `"blocked"` for the wrong reason.
      await waitForHarness(pageB);
      await pageB.evaluate(() => window.__e2e!.openDb());

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
      // regression in this one. `.github/workflows/ci.yml`'s paths gate
      // covers `src/lib/storage/` so that PR cannot land without running this.
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

test.describe("the worker chunk's blob snapshot survives a purge (#192)", () => {
  test("an abort-driven rebuild still encodes after the chunk URL is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    // Wait for `captureWorkerSnapshot`'s OWN fetch of the chunk to land. Purging
    // before the snapshot exists would leave nothing to rebuild from, and the
    // assertion below would fail for a reason that has nothing to do with the
    // fix. Asked of the page's resource timeline rather than Playwright's
    // request events, so the whole test reads one clock.
    //
    // The `message` is not decoration. `captureWorkerSnapshot` is gated on
    // `import.meta.env.PROD`, which Vite derives from NODE_ENV — so a shell that
    // exports `NODE_ENV=development` (this dev container does) compiles the whole
    // snapshot path out of the build and this poll times out on a bare "expected
    // true, received false" that says nothing about why. CI sets no NODE_ENV, so
    // it does not hit this; a laptop can.
    await expect
      .poll(() => page.evaluate(() => window.__e2e!.workerSnapshotFetched()), {
        timeout: 10_000,
        message:
          "captureWorkerSnapshot never fetched the worker chunk. It is gated on " +
          "import.meta.env.PROD — if NODE_ENV is set to development in this " +
          "shell, Vite builds with PROD=false and the snapshot path is compiled " +
          "out. Re-run with NODE_ENV unset.",
      })
      .toBe(true);

    // The purge. The harness build is served over HTTP with no service worker
    // evicting anything, so it is simulated the only way a test can: every
    // later request for the hashed chunk fails, exactly as a
    // `cleanupOutdatedCaches` eviction leaves it for an offline page.
    await page.route(/assets\/mp3\.worker-.*\.js$/, (route) => route.abort());

    const result = await page.evaluate(
      async () => await window.__e2e!.encodeAfterAbortRebuild(44_100)
    );

    // The abort really terminated an in-flight encode. Without this the warm
    // worker was never dropped, no rebuild happened, and the MP3 below would be
    // the ORIGINAL worker's — green for the wrong reason (#270: a gate has to be
    // able to fail).
    expect(result.aborted).toBe(true);
    // The rebuild fetched nothing. A worker built from the chunk URL would have
    // issued another request — and the route would have failed it.
    expect(result.chunkRequestsAfter).toBe(result.chunkRequestsBefore);
    // And a real MP3 came back, so the blob worker genuinely ran the encoder.
    expect(result.mp3Length).toBeGreaterThan(0);
  });
});
