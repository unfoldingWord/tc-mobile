import { expect, test, type Page } from "@playwright/test";

/**
 * A real browser decode of a joined chapter MP3 (#1004 residual 4, "Part of
 * #1004").
 *
 * PR #1050 taught Share Chapter to build an all-Finished chapter's MP3 by
 * copying stored MP3 frames (`lib/audio/mp3-join.ts`) instead of decoding and
 * re-encoding them. That module and `lib/export/chapter.ts` are unit-tested
 * in Node against a FAKE `AudioCodec` — nothing in this repo has ever handed
 * the joined bytes to a real MP3 decoder. This is that check.
 *
 * `window.__e2e!.buildAndDecodeJoinedChapter` (`src/app/e2e-harness.ts`, only
 * shipped by `vite build --mode e2e`) does the setup a UI walkthrough would,
 * without one: it builds Finished segments the same way the transcode sweep
 * does (a real PCM take, encoded through the app's own worker lane, landed
 * with the real `commitTranscode`), exports the chapter through the real
 * `exportChapterMp3`, and decodes the result with the browser's own
 * `AudioContext.decodeAudioData` — not the app's `decodeMp3ToCanonical`
 * wrapper, so this stands on its own. Runs against `dist-e2e/`
 * (`chromium-harness` in `playwright.config.ts`), the only build that ships
 * the harness.
 *
 * Each segment is a phase-aligned tone (period 100 samples: 44 100 / 441 Hz)
 * at a distinct length, so it starts and ends at the same point in its cycle
 * — a segment's own edge has no discontinuity for the codec to introduce one
 * at. Three segments (two gaps) is enough to catch a join that drops a gap,
 * merges two pieces, or scrambles their order without the run time of a long
 * chapter.
 *
 * What this does NOT prove: Safari/iOS decoding (`decodeAudioData` behaves
 * differently there per `hooks/audio-io.ts`'s own notes) or Android WebView.
 * Chromium only.
 */

/** Frames per segment; each a multiple of the tone's 100-sample period. */
const SEGMENT_FRAME_COUNTS = [40_000, 30_000, 50_000] as const;

/**
 * Ideal digital silence (`silentMp3Frame`) decodes to exact zero; this is a
 * generous floor above decoder noise/quantization and far below the tone's
 * own RMS (~0.13 of full scale at the harness's chosen amplitude) — so a gap
 * that is actually part of a segment (a dropped gap) reads far above it,
 * and genuine silence reads far below.
 */
const GAP_SILENCE_RMS_MAX = 0.002;

/**
 * The tone's own steady-state sample-to-sample step is about 0.0115 (an
 * amplitude of 0.183 of full scale, at 441 Hz / 44 100 Hz). This is over 4x
 * that — enough headroom for real MP3-domain ringing near a transition —
 * and still well under half the jump a genuinely broken join would produce
 * (two mismatched samples meeting at up to ~0.37 apart, or a segment start
 * landing away from its zero crossing at up to ~0.18).
 */
const BOUNDARY_MAX_ABS_DELTA = 0.05;

/** The harness attaches `window.__e2e` from a `<script type="module">`; wait for it. */
async function waitForHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.__e2e !== "undefined");
}

test.describe("joined chapter MP3 decodes in a real browser (#1004 residual 4)", () => {
  test("an all-Finished chapter's joined MP3 decodes cleanly: right length, silent gaps, no clicks at the joins", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarness(page);

    const result = await page.evaluate(
      (frames) => window.__e2e!.buildAndDecodeJoinedChapter(frames),
      SEGMENT_FRAME_COUNTS
    );
    console.log(
      `[joined-mp3-decode] segments=${result.segments} missing=${result.missing} ` +
        `joined=${result.joined} mp3Bytes=${result.mp3ByteLength} ` +
        `sampleRate=${result.sampleRate} decodedLength=${result.decodedLength} ` +
        `expectedTotal=${result.expectedTotal} gapCount=${result.gapCount}/${result.expectedGapCount} ` +
        `gapRms=${JSON.stringify(result.gapRms)} ` +
        `boundaryMaxAbsDelta=${JSON.stringify(result.boundaryMaxAbsDelta)}`
    );

    // The premise this spec depends on: three Finished, all-MP3 segments and
    // a chapter export that actually took the join path (#1004) rather than
    // falling back to decode-and-re-encode. If this is false, everything
    // below describes the fallback instead of the thing #1004 residual 4 asks
    // about.
    expect(result.segments).toBe(SEGMENT_FRAME_COUNTS.length);
    expect(result.missing).toBe(0);
    expect(result.joined).toBe(true);
    expect(result.sampleRate).toBe(44_100);

    // (a) It decodes without error. Reaching this line at all is most of the
    // claim — `buildAndDecodeJoinedChapter` throws if `decodeAudioData`
    // rejects — and a non-empty decode is the rest of it.
    expect(result.decodedLength).toBeGreaterThan(0);

    // (b) The decoded duration is within one MP3 frame of the segments plus
    // gaps, per mp3-join's own timing contract (`lib/audio/mp3-join.ts`'s
    // header: a joined segment starts within half a granule of where a single
    // whole-chapter encode would put it, and the error does not accumulate).
    expect(
      Math.abs(result.decodedLength - result.expectedTotal)
    ).toBeLessThanOrEqual(result.toleranceFrames);

    // (c) The gap regions are near-silent. `gapCount` matching the expected
    // count is itself a claim: it says the envelope found exactly
    // `segments - 1` quiet stretches between the first and last loud block —
    // not zero (segments run together), and not more (a segment audible only
    // faintly, or a real gap split in two).
    expect(result.gapCount).toBe(result.expectedGapCount);
    for (const rms of result.gapRms) {
      expect(rms).toBeLessThan(GAP_SILENCE_RMS_MAX);
    }

    // (d) No large sample discontinuity at any join boundary — two per gap,
    // entering it and leaving it.
    expect(result.boundaryMaxAbsDelta.length).toBe(result.gapCount * 2);
    for (const delta of result.boundaryMaxAbsDelta) {
      expect(delta).toBeLessThan(BOUNDARY_MAX_ABS_DELTA);
    }
  });
});
