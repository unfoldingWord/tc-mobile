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
import { fitMp3Decode } from "@/lib/audio/mp3-align";
import type { IDBPDatabase } from "idb";

export interface EncodeDecodeResult {
  /** Bytes of the MP3 the worker returned. */
  readonly mp3Length: number;
  /** The frame count `fitMp3Decode` recovers after a real `decodeAudioData`. */
  readonly decodedFrameCount: number;
  /** The frame count fed in — what `decodedFrameCount` is compared against. */
  readonly expectedFrameCount: number;
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

/**
 * Encode `frameCount` synthetic samples through the REAL worker round-trip
 * (`withEncoder` → the shared `mp3.worker.ts`), then decode the resulting MP3
 * through the REAL `decodeAudioData` boundary and align it with `fitMp3Decode`
 * — the same two steps every Share and every Finished transcode perform.
 */
async function encodeAndDecode(
  frameCount: number
): Promise<EncodeDecodeResult> {
  const samples = syntheticPcm(frameCount);
  const mp3 = await withEncoder(undefined, (codec) => codec.encodeMp3(samples));
  const decoded = await withEncoder(undefined, (codec) => codec.decodeMp3(mp3));
  const fitted = fitMp3Decode(decoded, mp3, frameCount);
  return {
    mp3Length: mp3.length,
    decodedFrameCount: fitted.length,
    expectedFrameCount: frameCount,
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
