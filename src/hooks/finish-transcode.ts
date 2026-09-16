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
 * A failed segment is left as PCM — no state is lost, the list keeps drawing it,
 * and the next sweep retries. ONE failure still says nothing to the translator:
 * from where they stand nothing has changed, and there is no action to offer.
 *
 * Every failure here goes to the app's single failure sink (`report-failure.ts`,
 * #167) rather than to `console.error`, which AGENTS.md is explicit is "not a
 * channel on a phone in a village". Whether the ENCODER is the thing that has
 * stopped working is not decided here — `mp3-codec.ts` owns that store, because
 * a load or a commit failing says nothing about encoding and because Share
 * encodes too (Frank R1 P2 / George R1 P2-3, P2-4).
 */

import { reportFailure } from "./report-failure";
import { EncoderStalledError, withEncoder } from "./mp3-codec";
import { computePeaks } from "@/lib/audio/peaks";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
} from "@/lib/storage/transcode";
import type { SegmentId } from "@/types/domain";
import { ROW_PEAK_BUCKETS } from "@/types/view";

let running: Promise<void> | null = null;
let requestedDuringRun = false;
/**
 * The segment whose encode last stalled, if any.
 *
 * Not a blocklist — a deprioritisation. The owed list comes back "in no
 * particular order" but in practice a stable `getAll` walk, and a stall ends the
 * RUN (#290), so a single clip that wedges the worker every time sat at the head
 * of that list and every other finished segment behind it never got a turn for
 * the life of the page (George R1 P2-2). Moving it to the BACK of the next
 * pass's list lets the other nineteen through and still retries it, rather than
 * abandoning a segment nothing else will ever pick up.
 */
let lastStalledSegmentId: SegmentId | null = null;

/**
 * Ask for every finished-but-PCM segment to be transcoded. Returns the promise
 * of the sweep that will cover the request — the one in flight or a fresh one.
 * Never rejects: per-segment failures are reported to the failure sink and
 * skipped, and a failure to list is reported the same way.
 *
 * ONE case is not covered by the promise it hands back: a request that lands
 * while a run is in flight is covered by that run's extra pass UNLESS the run
 * ends on a stall, which drops the extra pass deliberately (#290 — the retry
 * must not go straight back at a worker known to be wedged). Those segments keep
 * their PCM and are picked up by the next launch or the next transition. Every
 * call site `void`s this promise, so nothing observes the difference today; it
 * is written down because the next reader of the coalescing contract would
 * otherwise re-break #290 (George R1 P3-6).
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
 * ONE deliberate exception, and it is not a window: a run that ends on a STALL
 * drops the extra pass even when the flag is set, because going straight back at
 * a worker known to be wedged is the whole of #290. Those segments keep their
 * PCM and the next launch or transition picks them up (George R1 P3-6).
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

/**
 * Move the segment that stalled last time to the BACK of this pass.
 *
 * `listPcmFinishedSegments` promises no order and delivers a stable `getAll`
 * walk, so a clip that wedges the worker every time keeps the head of the queue
 * and — since a stall ends the run — nothing behind it is ever attempted
 * (George R1 P2-2). Pure, so the reordering is pinned by a test rather than by
 * reading the loop.
 */
export function afterStalledSegment<
  T extends { readonly segmentId: SegmentId },
>(owed: readonly T[], stalled: SegmentId | null): readonly T[] {
  if (stalled === null || owed.length < 2) return owed;
  const index = owed.findIndex((entry) => entry.segmentId === stalled);
  if (index < 0) return owed;
  return [...owed.slice(0, index), ...owed.slice(index + 1), owed[index]!];
}

/** One pass. Resolves `true` when it stopped because the encoder is wedged. */
async function sweepOnce(): Promise<boolean> {
  let owed: Awaited<ReturnType<typeof listPcmFinishedSegments>>;
  try {
    owed = await listPcmFinishedSegments();
  } catch (cause) {
    reportFailure(
      new Error("Could not list segments awaiting transcode", { cause }),
      "transcode-sweep"
    );
    return false;
  }
  for (const { segmentId, clipId } of afterStalledSegment(
    owed,
    lastStalledSegmentId
  )) {
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
      // This clip is no longer the one that wedged the worker, so it stops being
      // deprioritised. Cleared on ANY completed turn: a skip proves nothing
      // about the clip, but it does mean the head of the queue moved on.
      if (lastStalledSegmentId === segmentId) lastStalledSegmentId = null;
    } catch (cause) {
      // To the app's ONE sink, not the console alone (#167). The segment id
      // rides in a wrapper rather than in the context, because `context` is the
      // sink's dedup key and has to stay a short, stable name for the SITE —
      // one key per segment id would be an unbounded set of them (#188).
      reportFailure(
        new Error(
          `Transcoding finished segment ${segmentId} failed; its PCM is kept`,
          { cause }
        ),
        "transcode-segment"
      );
      // A STALLED encoder is not a per-segment failure — it is the whole worker
      // being wedged (#166), and the next segment would only re-arm the same
      // silence deadline and stall again: N segments × the timeout, blocking
      // every Share queued behind the lane that whole time. Stop the sweep; its
      // PCM is kept and the next launch's sweep (or the next transition's
      // request) retries once the page — and its worker — are healthy again.
      // A plain per-segment error keeps the loop going to the next segment.
      //
      // Remembering WHICH segment stalled is what stops this early exit from
      // becoming a head-of-line block: one poison clip at the front of a stable
      // list would otherwise starve every other finished segment for the life of
      // the page (George R1 P2-2). The next pass puts it last.
      if (cause instanceof EncoderStalledError) {
        lastStalledSegmentId = segmentId;
        return true;
      }
    }
  }
  return false;
}
