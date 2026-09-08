/**
 * Browser-only smoke-test harness for the Playwright suite (#251).
 *
 * NEVER shipped in a real build. `main.tsx` dynamically imports this module
 * behind `import.meta.env.MODE === "e2e"`, but that guard alone would not
 * keep it out of `dist/` — Rollup discovers a dynamic `import()` target from
 * the module graph regardless of a surrounding runtime condition. What
 * actually excludes it is `vite.config.ts`'s `build.rollupOptions.external`,
 * which marks this file external for every mode but `"e2e"`, so a plain
 * `npm run build` (what `staging`/`main` ship) never resolves or bundles it
 * at all — genuinely absent from `dist/`, not a dead branch shipped and
 * skipped. `npm run build:e2e` (`vite build --mode e2e`) is the only build
 * that includes it. `knip.json` lists this file under `entry` for the same
 * reason: a normal build's graph has no importer of it at all.
 *
 * Exposes the app's REAL browser-boundary modules on `window.__e2e` — the
 * encoder lane (`hooks/mp3-codec.ts`, the real Worker), the MP3 decode
 * (`hooks/audio-io.ts`'s `decodeAudioData`, via the same codec), and the
 * storage layer's `getDb` (`lib/storage/db.ts`, the real IndexedDB open) — so
 * Playwright can drive them directly. Deliberately NOT a UI walkthrough: the
 * issue is explicit that clicking through Books → Segments → Recorder proves
 * nothing here that calling the same functions the screens call doesn't, and
 * a fake-microphone UI flow would be far more brittle than this.
 */

import { withEncoder } from "@/hooks/mp3-codec";
import { getDb, type TcMobileDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  fitMp3Decode,
  mp3GranuleCount,
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
} from "@/lib/audio/mp3-align";
import type { IDBPDatabase } from "idb";

export interface EncodeDecodeResult {
  /** Bytes of the MP3 the worker returned. */
  readonly mp3Length: number;
  /**
   * The length `decodeAudioData` ACTUALLY returned, before `fitToFrames`
   * truncates or zero-pads it. This is the only number in this result that
   * says what the browser's decoder did; the fitted length below cannot,
   * because `fitToFrames` returns exactly `frames` in all three of its
   * branches (`lib/audio/edit.ts`).
   */
  readonly rawDecodedFrameCount: number;
  /**
   * `mp3GranuleCount(mp3) * MP3_GRANULE` — the length a decoder that trims
   * nothing returns, walked out of the real stream's own frame headers. The
   * reference `rawDecodedFrameCount` is measured against.
   */
  readonly emittedFrameCount: number;
  /** What `fitMp3Decode` returns — always `expectedFrameCount`, by construction. */
  readonly fittedFrameCount: number;
  /** The frame count fed in. */
  readonly expectedFrameCount: number;
  /** Samples each RMS below is taken over: the decoder priming, 1105 samples. */
  readonly rmsWindow: number;
  /** RMS of the fitted decode's FIRST `rmsWindow` samples. */
  readonly fittedHeadRms: number;
  /** RMS of the fitted decode's LAST `rmsWindow` samples. */
  readonly fittedTailRms: number;
  /** RMS of the same window of the PCM fed in — the scale to compare against. */
  readonly sourceRms: number;
}

/** A synthetic tone, not silence — a real encoder path, not an all-zero edge case. */
function syntheticPcm(frameCount: number): Int16Array {
  const out = new Int16Array(frameCount);
  const freq = 440;
  for (let i = 0; i < frameCount; i++) {
    out[i] = Math.round(
      Math.sin((2 * Math.PI * freq * i) / CANONICAL_SAMPLE_RATE) * 8_000
    );
  }
  return out;
}

/** Root-mean-square of `count` samples starting at `from`. Silence reads ~0. */
function rms(samples: Int16Array, from: number, count: number): number {
  const end = Math.min(samples.length, from + count);
  if (end <= from) return 0;
  let sum = 0;
  for (let i = from; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (end - from));
}

/**
 * Encode `frameCount` synthetic samples through the REAL worker round-trip
 * (`withEncoder` → the shared `mp3.worker.ts`), then decode the resulting MP3
 * through the REAL `decodeAudioData` boundary and align it with `fitMp3Decode`
 * — the same two steps every Share and every Finished transcode perform.
 *
 * Reports the RAW decode length and the fitted decode's head/tail energy, not
 * just the fitted length: `fitToFrames` returns exactly `frames` whatever
 * `fitMp3Decode` chose for its head skip, so a fitted-length check alone is
 * true by construction and proves nothing about the alignment. The raw length
 * says which decoder branch this browser landed in, and the head/tail RMS says
 * the chosen skip actually landed on the recording — a skip that is too small
 * leaves the decoder's ~1105 samples of priming SILENCE at the head, and one
 * that is too large runs off the end of the recording into the tail padding.
 */
async function encodeAndDecode(
  frameCount: number
): Promise<EncodeDecodeResult> {
  const samples = syntheticPcm(frameCount);
  const window = MP3_TOTAL_DELAY;
  // BEFORE the encode: `encodeMp3` TRANSFERS the PCM's ArrayBuffer to the
  // worker (`hooks/mp3-codec.ts`), which detaches it here — a read of
  // `samples` afterwards sees a zero-length array, and this reference RMS
  // would silently be 0. Found by this assertion failing on its first run.
  const sourceRms = rms(samples, 0, window);
  const mp3 = await withEncoder(undefined, (codec) => codec.encodeMp3(samples));
  const decoded = await withEncoder(undefined, (codec) => codec.decodeMp3(mp3));
  const rawDecodedFrameCount = decoded.length;
  const fitted = fitMp3Decode(decoded, mp3, frameCount);
  return {
    mp3Length: mp3.length,
    rawDecodedFrameCount,
    emittedFrameCount: mp3GranuleCount(mp3) * MP3_GRANULE,
    fittedFrameCount: fitted.length,
    expectedFrameCount: frameCount,
    rmsWindow: window,
    fittedHeadRms: rms(fitted, 0, window),
    fittedTailRms: rms(fitted, Math.max(0, fitted.length - window), window),
    sourceRms,
  };
}

/** Open the app's real IndexedDB connection through its real singleton. */
async function openDb(): Promise<{ name: string; version: number }> {
  const db = await getDb();
  window.__e2e!.db = db;
  return { name: db.name, version: db.version };
}

/** Has the real connection opened by `openDb()` seen a native `versionchange`? */
function watchVersionChange(): void {
  const db = window.__e2e?.db;
  if (!db) throw new Error("call openDb() before watchVersionChange()");
  window.__e2e!.versionChangeFired = false;
  db.addEventListener("versionchange", () => {
    window.__e2e!.versionChangeFired = true;
  });
}

declare global {
  interface Window {
    __e2e?: {
      encodeAndDecode: typeof encodeAndDecode;
      openDb: typeof openDb;
      watchVersionChange: typeof watchVersionChange;
      db?: IDBPDatabase<TcMobileDb>;
      versionChangeFired?: boolean;
    };
  }
}

window.__e2e = { encodeAndDecode, openDb, watchVersionChange };
