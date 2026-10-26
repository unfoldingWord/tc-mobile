import type { ClipMeta } from "@/types/audio";

/**
 * The stored PCM clip behind a buffer the recorder loaded, keyed by the
 * buffer itself (#1545), so a take whose `existing` IS that buffer can be held
 * with a `stored` base: the clip named, not copied (`encodePendingBase`).
 *
 * Identity is the "no cut or paste this session" signal. The editor's working
 * buffer is the loaded array until an edit runs: a cut or paste materialises a
 * new array (`useSegmentEditor`, `materialize`), and every save path passes the
 * working buffer as `existing`. So a buffer found here is the clip's bytes as
 * they were read, and any other buffer is not found and is held `inline`.
 *
 * Noted by every load, not only the one the recorder adopts: a cancelled
 * load's samples never become the editor's buffer, so they can never match a
 * take. A `WeakMap`, so a buffer nothing holds any longer takes its entry with
 * it. Only advice: the hold still checks the clip inside its own transaction
 * (`checkedSource` in `lib/storage/pending-takes.ts`) and writes `inline` if
 * it has changed or gone since this read.
 */
const loaded = new WeakMap<
  Int16Array,
  Pick<ClipMeta, "id" | "encoding" | "generation" | "frameCount">
>();

/**
 * Note that `samples` are the bytes of the stored clip `meta` describes, both
 * from one read. Only a PCM clip: a Finished segment's MP3 is decoded, and the
 * decoded buffer is not what `clipData` holds.
 */
export function noteLoadedClip(samples: Int16Array, meta: ClipMeta): void {
  if (meta.encoding !== "pcm") return;
  loaded.set(samples, {
    id: meta.id,
    encoding: meta.encoding,
    generation: meta.generation,
    frameCount: meta.frameCount,
  });
}

/** The stored clip `buffer` was loaded from, unchanged, or `null`. */
export function loadedClipSource(
  buffer: Int16Array
): Pick<ClipMeta, "id" | "encoding" | "generation" | "frameCount"> | null {
  return loaded.get(buffer) ?? null;
}
