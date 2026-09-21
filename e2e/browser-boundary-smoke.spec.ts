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

/**
 * One minute of canonical PCM for the #192 purge spec.
 *
 * The clip has one job: be long enough that the encode cannot possibly finish
 * before the abort. One SECOND was tried first and is not — it encodes in a few
 * milliseconds on this container, so `done` could beat the abort and the spec
 * would flake on `aborted` (George R1 P3-6). The harness no longer guesses at
 * the timing either: it waits for the PCM buffer to be detached, which is the
 * transfer itself. A minute keeps the whole spec well under a second while
 * leaving a margin of two orders of magnitude.
 */
const PURGE_CLIP_FRAMES = 44_100 * 60;

/** Samples per MPEG-1 Layer III granule (`lib/audio/mp3-align.ts`). */
const MP3_GRANULE = 1152;
/** A standard decoder's own delay, which some decoders trim and some do not. */
const MP3_DECODER_DELAY = 529;

/** Mirrors `StageLevels` in `src/app/e2e-harness.ts`. */
interface StageLevels {
  frames: number;
  peak: number;
  rms: number;
  clipped: number;
}

declare global {
  interface Window {
    __e2e?: {
      encodeAndDecode: (
        frameCount: number,
        amplitude?: number
      ) => Promise<{
        mp3Length: number;
        rawDecodedFrameCount: number;
        emittedFrameCount: number;
        fittedFrameCount: number;
        expectedFrameCount: number;
        rmsWindow: number;
        fittedHeadRms: number;
        fittedTailRms: number;
        sourceRms: number;
        source: StageLevels;
        rawDecoded: StageLevels;
        fitted: StageLevels;
      }>;
      measureCanonicalise: (
        frameCount: number,
        amplitude?: number
      ) => Promise<{
        source: StageLevels;
        downmixed: StageLevels;
        renderBranchTaken: boolean;
        resampleSource: StageLevels;
        resampled: StageLevels;
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
        transferred: boolean;
        aborted: boolean;
        chunkRequestsBefore: number;
        chunkRequestsAfter: number;
        mp3Length: number;
      }>;
      measureWorkerReady: () => Promise<{
        readyMs: number;
        deadlineMs: number;
      }>;
      workerSnapshotReady: () => boolean;
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

/**
 * Amplitude levels for the #555 spike, in Int16 units.
 *
 * Two probes, because one cannot answer both questions. The quiet probe is the
 * harness's existing ~-12 dBFS tone, where a linear gain change is unambiguous
 * and nothing is near the rails. The hot probe sits just under full scale,
 * where a lossy decode's overshoot is CLAMPED by `floatToInt16` — the only way
 * the "loud and dirty" half of the reported symptom can show up in numbers at
 * all, and it shows up as a clipped-sample count, not as a peak.
 *
 * A tone, not speech: this is a linear-gain question, and a tone makes a gain
 * change unambiguous and the measurement reproducible. It is deliberately the
 * WRONG probe for a perceptual-loudness question, and this spike does not ask
 * one.
 */
const QUIET_TONE = 8_000;
const HOT_TONE = 32_000;

/**
 * THE THRESHOLDS, named before anything was measured, so the result cannot be
 * read to taste afterwards.
 *
 * Beyond 3 dB of whole-clip RMS loss is a real finding and would be a
 * candidate cause of "very quiet" (#555). Under 1 dB is not the reported field
 * symptom under any reading — "very quiet" on a phone in a village is an order
 * of magnitude, not a percent. Between the two is inconclusive and would need a
 * device.
 */
const REAL_FINDING_DB = 3;
const NOT_THE_SYMPTOM_DB = 1;

const INT16_FULL_SCALE = 32_767;

/** dBFS of an Int16 magnitude. Digital silence prints as a sentinel, never NaN. */
function dbfs(magnitude: number): string {
  return magnitude > 0
    ? `${(20 * Math.log10(magnitude / INT16_FULL_SCALE)).toFixed(2)}`
    : "-inf";
}

/**
 * `20*log10(value / reference)`, with the two degenerate cases kept out of the
 * division (the `!(x > 0)` guard shape `lib/audio/display-gain.ts` already
 * uses).
 *
 * Both sentinels are FAIL-CLOSED against the bounds below: `Math.abs()` of
 * either is less than nothing, so a stage that measured silence, or that had
 * no scale to be measured against, fails the assertion rather than passing it.
 */
function deltaDb(value: number, reference: number): number {
  if (!(reference > 0)) return Number.NaN;
  if (!(value > 0)) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(value / reference);
}

function stageRow(name: string, stage: StageLevels, source: StageLevels) {
  return (
    `  ${name.padEnd(22)} ${String(stage.frames).padStart(8)} frames  ` +
    `peak ${dbfs(stage.peak).padStart(7)} dBFS  ` +
    `rms ${dbfs(stage.rms).padStart(7)} dBFS  ` +
    `Δrms ${deltaDb(stage.rms, source.rms).toFixed(2).padStart(6)} dB  ` +
    `clipped ${stage.clipped}`
  );
}

test.describe("audio LEVEL across the store/decode round trip (#555 spike)", () => {
  /**
   * The measurement the #555 hypothesis asks for, on the one stage where level
   * can legitimately move: PCM → the real worker `encodeMp3` → the real
   * `decodeAudioData` → `fitMp3Decode`. That is what a Finished segment's row
   * Play sounds (`hooks/use-audio-session.ts`'s `playTake`), and the
   * hypothesis is that it comes back several dB below the capture buffer that
   * record-mode Play sounds.
   *
   * EVIDENCE ONLY. Nothing here is a fix, and the bound is deliberately the
   * pre-committed "real finding" threshold rather than the tightest number
   * that happens to pass: this test's job is to be able to SEE an attenuation
   * of the size being hunted, and to say plainly when there is none.
   *
   * That it can see one is not assumed. Scaling the PCM handed to the encoder
   * by 0.5 inside `encodeAndDecode` makes both assertions below report -6.02 dB
   * and fail — run before they were written, per AGENTS.md's "a gate is tested
   * in both states". Without that step a harness blind to attenuation and a
   * clean pipeline produce the same green.
   */
  test("the MP3 round trip returns the level it was given, at two amplitudes", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    const frameCount = 44_100 * 3;
    for (const amplitude of [QUIET_TONE, HOT_TONE]) {
      const r = await page.evaluate(
        ([n, a]) => window.__e2e!.encodeAndDecode(n!, a!),
        [frameCount, amplitude]
      );
      console.log(
        `[levels] 3 s tone at amplitude ${amplitude} (${dbfs(amplitude)} dBFS), ` +
          `mp3 ${r.mp3Length} bytes\n` +
          stageRow("capture PCM", r.source, r.source) +
          "\n" +
          stageRow("decodeAudioData raw", r.rawDecoded, r.source) +
          "\n" +
          stageRow("fitMp3Decode (played)", r.fitted, r.source)
      );

      // What playback actually receives, against what the encoder was given.
      // This is the number a fix would be scoped from.
      expect(Math.abs(deltaDb(r.fitted.rms, r.source.rms))).toBeLessThan(
        REAL_FINDING_DB
      );
      // And the raw decode, so a loss can be attributed to the decoder rather
      // than to the alignment if one ever appears.
      expect(Math.abs(deltaDb(r.rawDecoded.rms, r.source.rms))).toBeLessThan(
        REAL_FINDING_DB
      );
      // The source really is where it was asked to be — a probe that silently
      // came back quiet would make every delta above meaningless.
      expect(r.source.peak).toBeGreaterThan(amplitude * 0.99);
    }
  });

  /**
   * `toCanonical`'s OfflineAudioContext render (`hooks/audio-io.ts`), which the
   * #555 hypothesis names first and which the round-trip test above never
   * reaches: the shared context is pinned to 44.1 kHz and the app's MP3s are
   * 44.1 kHz mono, so `alreadyCanonical` is true and the render is skipped.
   * Reporting "the round trip is clean" without this would be stepping around
   * the named suspect.
   *
   * `renderBranchTaken` is asserted rather than assumed, for the same reason
   * `encodeAfterAbortRebuild` asserts `transferred`: if this browser handed
   * back an already-canonical buffer, the downmix number measured the unity
   * branch and proves nothing about the render.
   */
  test("the canonicalisation render is unity, on both halves of the branch", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    const r = await page.evaluate(
      ([n, a]) => window.__e2e!.measureCanonicalise(n!, a!),
      [44_100 * 3, QUIET_TONE]
    );
    console.log(
      `[levels] toCanonical render (branch taken: ${r.renderBranchTaken})\n` +
        stageRow("tone in", r.source, r.source) +
        "\n" +
        stageRow("2ch→1ch downmix", r.downmixed, r.source) +
        "\n" +
        stageRow("48k→44.1k resample", r.resampled, r.resampleSource)
    );

    // The app's own render really ran.
    expect(r.renderBranchTaken).toBe(true);
    // Web Audio's 2 → 1 downmix is 0.5*(L+R); identical channels make it
    // unity, so this is held to the "not the symptom" bound, not the looser
    // finding bound — there is no lossy step here to excuse a percent.
    expect(Math.abs(deltaDb(r.downmixed.rms, r.source.rms))).toBeLessThan(
      NOT_THE_SYMPTOM_DB
    );
    // The resample PRIMITIVE, not the app's call site: with the rate pin
    // honoured, `toCanonical`'s render can never be a resample, because
    // `decodeAudioData` already delivered at the context's rate. This is what
    // the fallback path (Safari < 14.1, which throws on the `sampleRate`
    // option) would do, measured on the same node graph `toCanonical` builds.
    expect(
      Math.abs(deltaDb(r.resampled.rms, r.resampleSource.rms))
    ).toBeLessThan(NOT_THE_SYMPTOM_DB);
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
  test("the app's real connection sees a native versionchange and yields, so a concurrent delete proceeds", async ({
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

      // FLIPPED, deliberately, by the PR that superseded #236/#240 — which is
      // the change this assertion was written to wait for, in as many words:
      // "Once #236/#240 land and `db.ts` closes on `versionchange`, this
      // assertion is expected to flip to `success` — updating it then is that
      // change's job, not a regression in this one."
      //
      // `db.ts` now attaches `blocking()`. Both documents have the app mounted,
      // so both have registered an upgrade coordinator, and with nothing held
      // both answer "yield": each closes its own connection when the delete's
      // native `versionchange` reaches it, and the delete proceeds instead of
      // sitting on `onblocked`.
      //
      // This is the one piece of REAL-BROWSER evidence behind #221's P2. Node
      // and `fake-indexeddb` can show that the close is reached synchronously
      // inside the handler; only this can show that a real Chromium connection
      // really lets go and that the operation waiting on it really proceeds.
      // What it does NOT prove is the strict "before the handler returns"
      // property — a close deferred by a microtask would very likely also
      // satisfy a delete — and that half stays pinned by `tests/db-open.test.ts`,
      // "gives up the connection inside the handler".
      expect(outcome).toBe("success");

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

test.describe("how long the worker takes to say ready (#192, George R2 P2)", () => {
  test("a worker evaluates its whole chunk and answers far inside the handshake window", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    const result = await page.evaluate(
      async () => await window.__e2e!.measureWorkerReady()
    );
    // Logged, not just asserted: the number is the point. `ENCODER_READY_TIMEOUT_MS`
    // has to cover evaluation of the whole chunk — lamejs included, since `ready`
    // is posted at the foot of the module — and until this ran, the constant rested
    // on reasoning about that rather than on a measurement of it.
    console.log(
      `[ready] worker construction → ready: ${result.readyMs.toFixed(1)} ms ` +
        `(window ${result.deadlineMs} ms)`
    );

    // It answered at all, which is the load-bearing half: a worker that never
    // posts `ready` would hang this evaluate and fail the test.
    expect(result.readyMs).toBeGreaterThan(0);
    // And with room to spare. A tenth of the window is a deliberately loose
    // bound — this is one engine on one machine, and a phone may be an order of
    // magnitude slower, which is exactly why the window is freeze-aware and
    // forgives one expiry rather than simply being long.
    expect(result.readyMs).toBeLessThan(result.deadlineMs / 10);
  });
});

test.describe("the worker chunk's blob snapshot survives a purge (#192)", () => {
  test("an abort-driven rebuild still encodes after the chunk URL is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    // Wait until the snapshot EXISTS. Purging before it does would leave nothing
    // to rebuild from, and the assertion below would fail for a reason that has
    // nothing to do with the fix. This asks the codec for `snapshotUrl` itself;
    // it used to watch for the chunk's fetch in the resource timeline, which
    // fires a `response.text()` and a `createObjectURL` too early and cannot see
    // a non-ok response at all (George R1 P3-5).
    //
    // The `message` is not decoration. `captureWorkerSnapshot` is gated on
    // `import.meta.env.PROD`, which Vite derives from NODE_ENV — so a shell that
    // exports `NODE_ENV=development` (this dev container does) compiles the whole
    // snapshot path out of the build and this poll times out on a bare "expected
    // true, received false" that says nothing about why. CI sets no NODE_ENV, so
    // it does not hit this; a laptop can.
    await expect
      .poll(() => page.evaluate(() => window.__e2e!.workerSnapshotReady()), {
        timeout: 10_000,
        message:
          "captureWorkerSnapshot never produced a blob URL. It is gated on " +
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
      async (frames) => await window.__e2e!.encodeAfterAbortRebuild(frames),
      PURGE_CLIP_FRAMES
    );

    // The abort really terminated an in-flight encode. Without this the warm
    // worker was never dropped, no rebuild happened, and the MP3 below would be
    // the ORIGINAL worker's — green for the wrong reason (#270: a gate has to be
    // able to fail).
    //
    // Two claims, and each can fail on its own (Frank R3 P2). The PCM buffer
    // was detached, so an encode was genuinely in flight when the abort landed:
    // the harness waits for that with a deadline, and reports the deadline
    // expiring rather than carrying on as if it had not.
    expect(result.transferred).toBe(true);
    // And the job rejected with THIS signal's reason — not with a worker error
    // or a stall, which reject too and leave a different worker behind.
    expect(result.aborted).toBe(true);
    // The rebuild fetched nothing. A worker built from the chunk URL would have
    // issued another request — and the route would have failed it.
    expect(result.chunkRequestsAfter).toBe(result.chunkRequestsBefore);
    // And a real MP3 came back, so the blob worker genuinely ran the encoder.
    expect(result.mp3Length).toBeGreaterThan(0);
  });
});
