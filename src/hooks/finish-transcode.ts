/**
 * Transcode on Finished (B8, D3) — the sweep.
 *
 * Marking a segment Finished is a real state transition: its PCM is transcoded
 * to MP3 and dropped, ~10x smaller (#12). Rather than chase every place the
 * transition can happen (the row menu, the recorder's checkbox on close, a take
 * saved with the mark, a retry of that save), the work is a SWEEP: find every
 * finished segment whose clip is still PCM (`listPcmFinishedSegments`), encode
 * each in the worker, and land it with `commitTranscode`. Any transition simply
 * asks for a sweep. The sweep is idempotent — a segment that no longer qualifies
 * by the time its commit runs is skipped there — so asking twice is harmless,
 * and so is dying half-way: the PCM is still there and the next launch's sweep
 * (App mounts one) picks the segment up again. That is what makes the drop safe
 * to do in the background at all.
 *
 * One sweep at a time, module-wide. A request during a run flags one more pass
 * after it, so a transition that lands while the worker is busy is not missed
 * and two sweeps never encode the same clip concurrently. Module state rather
 * than hook state on purpose: the callers are hooks on different screens, and
 * the guarantee has to hold across all of them (`audio-io.ts` holds its shared
 * `AudioContext` the same way).
 *
 * Memory: one segment's PCM at a time. Peaks are computed before the encode
 * because the encode CONSUMES the buffer (transferred to the worker).
 *
 * A failed segment is logged and left as PCM — no state is lost, the list keeps
 * drawing it, and the next sweep retries. Nothing is shown to the translator:
 * from where they stand nothing has changed, and there is no action to offer.
 */

import { encodeMp3OffThread } from "./mp3-codec";
import { computePeaks } from "@/lib/audio/peaks";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import { ROW_PEAK_BUCKETS } from "@/types/view";

let running: Promise<void> | null = null;
let requestedDuringRun = false;

/**
 * Ask for every finished-but-PCM segment to be transcoded. Returns the promise
 * of the sweep that will cover the request — the one in flight (which will run
 * once more when it finishes) or a fresh one. Never rejects: per-segment
 * failures are logged and skipped, and a failure to list is logged too.
 */
export function requestTranscodeSweep(): Promise<void> {
  if (running) {
    requestedDuringRun = true;
    return running;
  }
  running = (async () => {
    do {
      requestedDuringRun = false;
      await sweepOnce();
    } while (requestedDuringRun);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function sweepOnce(): Promise<void> {
  let owed: Awaited<ReturnType<typeof listPcmFinishedSegments>>;
  try {
    owed = await listPcmFinishedSegments();
  } catch (cause) {
    console.error("Could not list segments awaiting transcode", cause);
    return;
  }
  for (const { segmentId, clipId } of owed) {
    try {
      const audio = await loadSegmentClip(segmentId);
      // Changed since the list was taken (erased, re-recorded, already MP3):
      // not this clip's job any more; the commit would call it stale anyway.
      if (
        audio.kind !== "resolved" ||
        audio.clip.encoding !== "pcm" ||
        audio.clip.meta.id !== clipId
      )
        continue;
      const { samples } = audio.clip;
      // Before the encode: it transfers `samples` away.
      const peaks = computePeaks(samples, ROW_PEAK_BUCKETS);
      const mp3 = await encodeMp3OffThread(samples);
      await commitTranscode(segmentId, clipId, mp3, peaks);
    } catch (cause) {
      console.error(
        "Transcoding a finished segment failed; its PCM is kept",
        segmentId,
        cause
      );
    }
  }
}
