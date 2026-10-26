import { expect, test, type Page } from "@playwright/test";

/**
 * Normalize-on-Finished in a real browser (#1433, the browser half; "Part of
 * #1433").
 *
 * Node covers the chain (`lib/audio/loudness.ts`) and the sweep's choice of
 * what to encode against fakes. Nothing there runs the chain inside the real
 * MP3 worker, through the real `commitTranscode`, and then decodes the stored
 * MP3 the way a phone does. `window.__e2e!.finishQuietSegment`
 * (`src/app/e2e-harness.ts`, shipped only by `vite build --mode e2e`) seeds a
 * quiet Finished PCM segment, sets the preference, runs the app's own
 * `requestTranscodeSweep`, reads the stored clip back and measures the decoded
 * MP3 with the app's own `LoudnessMeter`. Runs against `dist-e2e/`
 * (`chromium-harness` in `playwright.config.ts`).
 *
 * The band is measured, not exact: the chain's static gain lands the take on
 * its target before MP3 encoding, and the lossy round trip moves the measure a
 * little. What this does NOT settle: whether -19 LUFS sounds right on a phone
 * speaker. That listening test is still owed (#1433).
 */

/** The target, restated here on purpose: moving `LOUDNESS_TARGET` should fail this. */
const TARGET_LUFS = -19;
/** Half-width of the band the stored MP3's measure must land in, in LU. */
const BAND_LU = 1.5;
/** A tone at this fraction of full scale measures about -29 LUFS: inside the 20 dB gain cap, under the ceiling after gain. */
const AMPLITUDE = 0.05;
const SECONDS = 6;

/**
 * The result shape, declared here and not on `Window.__e2e`: that ambient
 * declaration lives in `browser-boundary-smoke.spec.ts`, which this lane does
 * not own, so the call below casts to this instead.
 */
interface QuietSegmentResult {
  encoding: string;
  processing: {
    stages: { id: string; version: number }[];
    measuredLufs: number | null;
    measuredTruePeakDbtp: number | null;
    appliedGainDb: number;
  } | null;
  sourceLufs: number | null;
  storedLufs: number | null;
}

async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__e2e !== "undefined");
}

async function run(page: Page, normalize: boolean) {
  await page.goto("/");
  await waitForHarness(page);
  const result: QuietSegmentResult = await page.evaluate(
    ([on, amplitude, seconds]) =>
      (
        window.__e2e as unknown as {
          finishQuietSegment: (
            normalize: boolean,
            amplitude: number,
            seconds: number
          ) => Promise<QuietSegmentResult>;
        }
      ).finishQuietSegment(on, amplitude, seconds),
    [normalize, AMPLITUDE, SECONDS] as const
  );
  console.log(
    `[normalize-on-finished] normalize=${normalize} ` +
      `sourceLufs=${result.sourceLufs} storedLufs=${result.storedLufs} ` +
      `processing=${JSON.stringify(result.processing)}`
  );
  return result;
}

test.describe("normalize on Finished, real worker and decode (#1433)", () => {
  test("preference on: the stored MP3 measures near the target and the record names the stages", async ({
    page,
  }) => {
    const r = await run(page, true);
    expect(r.encoding).toBe("mp3");
    // The premise: the seed really was quiet, well below the target.
    expect(r.sourceLufs).not.toBeNull();
    expect(r.sourceLufs!).toBeLessThan(TARGET_LUFS - 5);
    expect(r.processing).not.toBeNull();
    expect(r.processing!.stages.map((s) => s.id)).toEqual([
      "hpf",
      "loudness",
      "limiter",
    ]);
    expect(r.processing!.appliedGainDb).toBeGreaterThan(5);
    expect(r.processing!.measuredLufs).toBeCloseTo(r.sourceLufs!, 0);
    expect(r.storedLufs).not.toBeNull();
    expect(Math.abs(r.storedLufs! - TARGET_LUFS)).toBeLessThanOrEqual(BAND_LU);
  });

  test("preference off: the stored MP3 stays quiet and the record is the no-stages one", async ({
    page,
  }) => {
    const r = await run(page, false);
    expect(r.encoding).toBe("mp3");
    expect(r.processing).toEqual({
      stages: [],
      measuredLufs: null,
      measuredTruePeakDbtp: null,
      appliedGainDb: 0,
    });
    expect(r.storedLufs).not.toBeNull();
    // Untouched: within the lossy round trip of the source, far from the target.
    expect(Math.abs(r.storedLufs! - r.sourceLufs!)).toBeLessThanOrEqual(1);
    expect(r.storedLufs!).toBeLessThan(TARGET_LUFS - 5);
  });
});
