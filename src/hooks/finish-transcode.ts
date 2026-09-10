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
 * Memory: one segment's PCM at a time, and never alongside a share's — every
 * encode in the app goes through `withEncoder`'s single lane, and the sweep
 * takes the lane before it loads a clip. Peaks are computed before the encode
 * because the encode CONSUMES the buffer (transferred to the worker).
 *
 * A failed segment is logged and left as PCM — no state is lost, the list keeps
 * drawing it, and the next sweep retries. Nothing is shown to the translator:
 * from where they stand nothing has changed, and there is no action to offer.
 */

import { EncoderStalledError, withEncoder } from "./mp3-codec";
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
  running = runSweeps();
  return running;
}

/**
 * Sweep, and sweep again for every request that arrived while sweeping.
 *
 * `running` is cleared in the `finally`, in the SAME synchronous step that ends
 * the `do/while` — there is no `await` between the loop's last check of the flag
 * and the clear. So a request either lands during a `sweepOnce` (the flag is set
 * while `running` is still non-null, `requestTranscodeSweep` joins this promise,
 * and the loop makes one more pass) or after the clear (it starts a fresh run).
 * There is no in-between window a joiner can fall into and be dropped — which is
 * exactly what the earlier `.finally(…).then(…)` chain existed to paper over
 * (that chain was the B8 PR's coalescing residual; folded per #185 round-2 George).
 *
 * The clear lives in `finally`, not after the loop, on purpose: an uncaught throw
 * out of `sweepOnce` must still release the lock. `if (running)` is truthy for a
 * settled — even rejected — promise, so a clear a throw could skip would wedge
 * every later sweep onto the dead promise (#185 round-3 George P3).
 */
async function runSweeps(): Promise<void> {
  try {
    let stalled = false;
    do {
      requestedDuringRun = false;
      stalled = await sweepOnce();
      // A stall ends the RUN, not just the pass. Breaking out of `sweepOnce`
      // alone left the coalescing flag set, so a Finished transition that
      // landed during the 15 s stall window sent the loop straight back at the
      // same wedged worker — another window on the lane with every queued Share
      // behind it, for a worker we already know is not answering (Frank R3 P2,
      // #290). The retry belongs to the next launch or the next transition,
      // once the page and its worker are healthy again.
    } while (requestedDuringRun && !stalled);
  } finally {
    running = null;
  }
}

/** One pass. Resolves `true` when it stopped because the encoder is wedged. */
async function sweepOnce(): Promise<boolean> {
  let owed: Awaited<ReturnType<typeof listPcmFinishedSegments>>;
  try {
    owed = await listPcmFinishedSegments();
  } catch (cause) {
    console.error("Could not list segments awaiting transcode", cause);
    return false;
  }
  for (const { segmentId, clipId } of owed) {
    try {
      // Inside the encoder lane from the LOAD onward, not just the encode: the
      // PCM is read only once the lane is ours, so a share holding the lane
      // never coexists with a segment's PCM waiting here (round-1 George G1).
      // One segment per turn on the lane, so a share queued between two
      // segments gets in between them.
      await withEncoder(undefined, async (codec) => {
        const audio = await loadSegmentClip(segmentId);
        // Changed since the list was taken (erased, re-recorded, already MP3):
        // not this clip's job any more; the commit would call it stale anyway.
        if (
          audio.kind !== "resolved" ||
          audio.clip.encoding !== "pcm" ||
          audio.clip.meta.id !== clipId
        )
          return;
        const { samples } = audio.clip;
        // Before the encode: it transfers `samples` away.
        const peaks = computePeaks(samples, ROW_PEAK_BUCKETS);
        const mp3 = await codec.encodeMp3(samples);
        await commitTranscode(segmentId, clipId, mp3, peaks);
      });
    } catch (cause) {
      console.error(
        "Transcoding a finished segment failed; its PCM is kept",
        segmentId,
        cause
      );
      // A STALLED encoder is not a per-segment failure — it is the whole worker
      // being wedged (#166), and the next segment would only re-arm the same
      // silence deadline and stall again: N segments × the timeout, blocking
      // every Share queued behind the lane that whole time. Stop the sweep; its
      // PCM is kept and the next launch's sweep (or the next transition's
      // request) retries once the page — and its worker — are healthy again.
      // A plain per-segment error keeps the loop going to the next segment.
      if (cause instanceof EncoderStalledError) return true;
      // TODO(#166/#188): the stall (and repeated plain failures) still say nothing
      // to the translator or maintainer. Count consecutive sweep failures in the
      // module state and surface ONE state-in-place indicator after N (the Books
      // screen). Its presentation goes through the failure sink / strings owned by
      // #188 — wire it there, not here.
    }
  }
  return false;
}
