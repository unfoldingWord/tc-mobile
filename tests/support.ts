import { vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import {
  MP3_GRANULE,
  MP3_TOTAL_DELAY,
  mp3GranuleCount,
} from "@/lib/audio/mp3-align";
import { closeDb, getDb } from "@/lib/storage/db";
import type { AudioCodec, Clip } from "@/types/audio";

/**
 * Shared test plumbing for the storage and export suites.
 *
 * Nothing here is a fixture of product behaviour — it is the codec seam filled
 * in for Node and two small readers the suites would otherwise each re-declare.
 */

/**
 * An `AudioCodec` for Node: the real synchronous encoder behind the async seam
 * `lib/` takes (the browser runs it in a worker, B8), and a decoder the test
 * supplies — or one that REFUSES, so a suite that never expects an MP3 clip fails
 * loudly if one is decoded rather than silently getting zeros. Both are `vi.fn`s
 * so a test can assert the encode was (not) reached or what the decoder was fed.
 */
export function testCodec(
  decodeMp3: AudioCodec["decodeMp3"] = () =>
    Promise.reject(new Error("no MP3 clip was expected in this test"))
) {
  return {
    encodeMp3: vi.fn(async (samples: Int16Array) => encodeMp3(samples)),
    decodeMp3: vi.fn(decodeMp3),
  };
}

/** A PCM clip's samples, failing the test if the clip is absent or MP3. */
export function samplesOf(clip: Clip | undefined): Int16Array {
  if (!clip) throw new Error("expected a stored clip, found none");
  if (clip.encoding !== "pcm")
    throw new Error(`expected a PCM clip, got ${clip.encoding}`);
  return clip.samples;
}

/**
 * Reset the database between cases by clearing every object store.
 *
 * Not `deleteDatabase`: that blocks indefinitely while any connection is open,
 * and a harness that resolves on `onblocked` silently carries the previous
 * test's data forward — which is exactly the flake this replaced. Clearing is
 * deterministic and needs no connection juggling. (AGENTS.md, Testing.)
 */
export async function clearAllStores(): Promise<void> {
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
}

/**
 * A ramp of `n` samples, 1..n scaled into the Int16 range, offset by `base`.
 * Never constant, so a fit that keeps the wrong end of a buffer is caught —
 * the fixture shape round 2 of PR #136 asked for.
 */
export function ramp(n: number, base = 0): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = base + 1 + (i % 30_000);
  return out;
}

/**
 * What a decoder that returns every granule hands back for `mp3`, the encode
 * of `pcm`: 1105 samples of priming, the recording, then granule padding to the
 * stream's emitted length. The two facts this models — head offset and total
 * length — were measured in Chromium (`decodeAudioData`) for five input
 * lengths; this is that decoder, minus the codec noise.
 */
export function noTrimDecode(pcm: Int16Array, mp3: Uint8Array): Int16Array {
  const out = new Int16Array(mp3GranuleCount(mp3) * MP3_GRANULE);
  out.set(pcm, MP3_TOTAL_DELAY);
  return out;
}
