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
 * A failed segment is left as PCM — no state is lost, the list keeps drawing it
 * and it still plays. ONE failure still says nothing to the translator: from
 * where they stand nothing has changed, and there is no action to offer. The
 * next sweep retries it — except a segment that failed because the phone is
 * out of room (#1010): every Finished tap starts a sweep, and on a full phone
 * each would re-decode and re-encode that segment and log it again. See
 * {@link failedSegments} for what brings such a segment back.
 *
 * Every failure here goes to the app's single failure sink (`report-failure.ts`,
 * #167) rather than to `console.error`, which AGENTS.md is explicit is "not a
 * channel on a phone in a village". Whether the ENCODER is the thing that has
 * stopped working is not decided here — `mp3-codec.ts` owns that store, because
 * a load or a commit failing says nothing about encoding and because Share
 * encodes too (Frank R1 P2 / George R1 P2-3, P2-4).
 */

import { reportFailure } from "./report-failure";
import { isQuotaExceeded } from "./save-failure";
import {
  readStorageEstimate,
  storageEstimateSourceOf,
} from "./use-storage-pressure";
import {
  EncoderStalledError,
  encoderHealth,
  subscribeToEncoderHealth,
  withEncoder,
} from "./mp3-codec";
import { computePeaks } from "@/lib/audio/peaks";
import { freeByteCount } from "@/lib/storage/pressure";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import {
  commitTranscode,
  listPcmFinishedSegments,
  recordTranscodeStall,
} from "@/lib/storage/transcode";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import type { SegmentId } from "@/types/domain";

let running: Promise<void> | null = null;
let requestedDuringRun = false;
/**
 * Segments whose encode stalled in this page.
 *
 * Not a blocklist — a deprioritisation. The owed list is sorted by durable
 * stall count; this same-page set moves stalled ids behind its healthy tail.
 * A stall ends the RUN (#290), so poison clips near the head would otherwise
 * starve healthy segments. A clip is still retried after it stalls — at most
 * until {@link PAGE_STALL_LIMIT} holds it out for the rest of the page.
 */
const stalledSegmentIds = new Set<SegmentId>();

type OwedClipId = Awaited<
  ReturnType<typeof listPcmFinishedSegments>
>[number]["clipId"];

/**
 * How many times one clip may stall the encoder in this page before the sweep
 * stops asking it to (#682).
 *
 * Two, because the first stall cannot say whose fault it was: the worker may
 * have been wedged for a reason that has nothing to do with the clip, and the
 * recovery sweep (#404) exists to transcode that clip once the encoder works
 * again. Every stall tears the worker down and builds a fresh one
 * (`encodeInWorker`), and the recovery sweep only runs after an encode has just
 * produced bytes. Only a stall whose encode began with the encoder `ok` is
 * counted, so a SECOND counted stall is the same clip wedging a different,
 * demonstrably working worker. That is the clip, and retrying it again only
 * spends another silence deadline holding the one encoder lane, in front of
 * whatever Share the translator taps next.
 *
 * Held out is not given up on. The PCM is never touched, the segment keeps
 * drawing and playing from it, and the next page load retries it — last, by its
 * durable stall count (`listPcmFinishedSegments`). What the bound caps is the
 * cost one poison clip can put in front of foreground work: one timeout at
 * launch, one after the first recovery, then none for the rest of the page.
 *
 * Keyed by CLIP, not segment: a segment re-recorded under a new clip has new
 * audio, which has not stalled anything yet.
 */
const PAGE_STALL_LIMIT = 2;
const pageStallCounts = new Map<OwedClipId, number>();

interface FailedTranscode {
  /** The clip that failed. A different clip on the segment is new audio. */
  readonly clipId: OwedClipId;
  /** Free bytes read just after the failure; `undefined` when unknown. */
  readonly freeAtFailure: number | undefined;
}

/**
 * Segments whose last transcode failed because the phone is out of room — a
 * quota error, as `isQuotaExceeded` reads one — in this page (#1010).
 *
 * Held out of later sweeps until:
 *  - a later storage estimate shows more free space than the one read at its
 *    failure — or, when that failure-time reading was itself unknown, any
 *    known later estimate, once ({@link shouldRetryAfterFailure});
 *  - the segment holds a different clip — re-recorded or edited, new audio;
 *  - the app restarts: this is module state, and a reload is a fresh module.
 *
 * The entry outlives a storage retry, so a retry that runs out of room again
 * does not log again: one failure-log row per segment and clip per page, not
 * one per tap. It is removed when a turn for the segment completes or fails
 * any other way.
 *
 * Only quota, not every failure that is not a stall. "Storage freed" is the
 * exit that makes the hold-out safe, and it says nothing about any other
 * cause. An encode that fails in the worker already has `mp3-codec.ts`'s
 * health store and the recovery sweep below; holding it out here would hide
 * the segment from that recovery. Other failures keep today's retry on the
 * next sweep. Stalls never land here either; they keep
 * {@link stalledSegmentIds} and {@link pageStallCounts}.
 *
 * Nothing is lost by holding out: the PCM is untouched, the segment keeps
 * drawing and playing from it, and the next launch tries it again.
 */
const failedSegments = new Map<SegmentId, FailedTranscode>();

/**
 * Whether storage has freed since a held-out segment failed.
 *
 * Ordinarily this is only true for a reading that shows MORE free bytes than
 * the failure-time reading. But when the failure-time reading was itself
 * unknown (no `estimate()`, a rejected call, a timed-out read), that reading
 * is no evidence AGAINST room either — so it does not hold the segment out
 * until a restart. It gets exactly one retry against any known reading now
 * (DRI ruling, 2026-09-26: "One retry on a real reading"). That retry's own
 * outcome sets a real `freeAtFailure` — the failure branch's re-read, or a
 * fallback to the reading that let the retry run — so a second failure is
 * held to the ordinary "strictly more free space" rule below, not another
 * free pass.
 *
 * A CURRENT reading that is unknown is never evidence of room, on either
 * side, so it always keeps the segment held out; the clip-change and restart
 * exits still apply. Pure, so the guard is pinned by a test rather than by
 * reading the loop.
 */
export function shouldRetryAfterFailure(
  freeNow: number | undefined,
  freeAtFailure: number | undefined
): boolean {
  if (freeNow === undefined) return false;
  if (freeAtFailure === undefined) return true;
  return freeNow > freeAtFailure;
}

/**
 * How long the sweep waits on `navigator.storage.estimate()` before it treats
 * the reading as unknown. `readStorageEstimate` catches a rejection but has
 * no bound of its own, and the sweep holds the module-wide `running` lock
 * while it waits: an `estimate()` that never settled would leave every later
 * request joined to a run that never ends, and nothing would be transcoded
 * until a reload. Unknown is already the fail-closed answer — it keeps a
 * held-out segment held out — so giving up costs only the storage-freed exit
 * for that one read. 1000 ms, the same bound the recorder and playback put
 * on `resume()`.
 */
export const STORAGE_ESTIMATE_TIMEOUT_MS = 1000;

/**
 * Free bytes now, or `undefined`. Never rejects: `readStorageEstimate` never
 * does, and a read that outlasts {@link STORAGE_ESTIMATE_TIMEOUT_MS} is
 * `undefined` too.
 */
async function currentFreeBytes(): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STORAGE_ESTIMATE_TIMEOUT_MS);
  });
  try {
    const reading = await Promise.race([
      readStorageEstimate(storageEstimateSourceOf(globalThis)),
      timedOut,
    ]);
    return freeByteCount(reading?.usage, reading?.quota);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stop sweeping, for the life of this page. One-way (George R5 P2-3).
 *
 * The crash screen sets this. `ErrorBoundary` replaces `App`, but this module's
 * state is module-scoped on purpose — the callers are hooks on different screens
 * — so `App`'s unmount does not cancel a sweep, and a run started at launch
 * keeps encoding clips and reporting one `transcode-segment` row per failure
 * into the log the crash screen is about to send. With a backlog of finished-
 * but-PCM segments (the case `App`'s launch sweep exists for) and an encoder
 * that FAILS rather than stalls — a stall ends the pass, an ordinary failure
 * does not — that is an unbounded producer against a 50-row ring, and it can
 * prune the `[render]` row before a two-gesture Send completes. The facilitator
 * then sends fifty transcode lines and no crash.
 *
 * Stopping the producer rather than protecting the row: an un-prunable row class
 * inside the store's prune would be a slow leak in a ring whose whole job is to
 * be bounded, and the policy does not belong in T1 storage.
 *
 * This costs nothing the sweep does not already promise. Its contract is that a
 * segment left untranscoded keeps its PCM and is picked up by the next launch or
 * the next Finished transition — dying half-way is already documented as safe.
 * And the only exit from the crash screen is a reload, which is a new page with
 * a fresh launch sweep, so there is nothing for this quiesce path to resume: a
 * quiesce-specific `resume` would be a stub.
 */
let quiesced = false;
const pauseReasons = new Set<string>();
let requestedDuringPause = false;

/**
 * Ask for a sweep when the encoder RECOVERS.
 *
 * A module-scoped subscription with no unsubscribe: there is one sweep per page
 * and it lives as long as the module does. Health only returns to `ok` on an
 * encode that actually produced bytes, so this never fires on a hunch — but
 * that encode may well be a Share's, and then the sweep goes back at a clip
 * that wedged the worker earlier in this page. `stalledSegmentIds` puts it
 * behind the healthy ones; when it is the ONLY clip owed, it is retried
 * straight away. That is the intended trade — the encoder has just been
 * demonstrated to work — and not the #290 case, which is about going back at a
 * stall with nothing having changed. It is a trade made once per clip:
 * {@link PAGE_STALL_LIMIT} holds out a clip that stalls again on the repaired
 * encoder, so later Shares do not each pay for it (#682).
 */
let lastEncoderHealth = encoderHealth();
subscribeToEncoderHealth((health) => {
  const recovered = lastEncoderHealth === "failing" && health === "ok";
  lastEncoderHealth = health;
  if (recovered) void requestTranscodeSweep();
});

function paused(): boolean {
  return pauseReasons.size > 0;
}

/** Called from the error boundary. See {@link quiesced}. */
export function quiesceTranscodeSweep(): void {
  quiesced = true;
  pauseReasons.clear();
  requestedDuringPause = false;
}

/**
 * Temporarily stop new transcode work while a live screen needs the failure log
 * to stay stable. Unlike {@link quiesceTranscodeSweep}, this is reversible.
 */
export function pauseTranscodeSweep(reason: string): void {
  if (quiesced) return;
  pauseReasons.add(reason);
}

/** Resume work paused by {@link pauseTranscodeSweep}. */
export function resumeTranscodeSweep(reason: string): void {
  if (quiesced) return;
  pauseReasons.delete(reason);
  if (paused() || !requestedDuringPause) return;
  requestedDuringPause = false;
  void requestTranscodeSweep();
}

/**
 * Ask for every finished-but-PCM segment to be transcoded. Returns the promise
 * of the sweep that will cover the request — the one in flight or a fresh one.
 * Never rejects: per-segment failures are reported to the failure sink and
 * skipped, and a failure to list is reported the same way.
 *
 * ONE case is not covered by the promise it hands back: a request that lands
 * while a run is in flight is covered by that run's next pass UNLESS the run
 * stalls a second time, which ends it (see `runSweeps`). Those segments keep
 * their PCM and are picked up by the next launch or the next transition. Every
 * call site `void`s this promise, so nothing observes the difference today; it
 * is written down because the next reader of the coalescing contract would
 * otherwise re-break #290 (George R1 P3-6).
 */
export function requestTranscodeSweep(): Promise<void> {
  // The page is on the crash screen and the log is about to be sent; nothing
  // here may add rows to it. Resolved rather than rejected: every call site
  // `void`s this, and a rejection would reach the funnel and append the very
  // kind of row this is here to stop.
  if (quiesced) return Promise.resolve();
  if (paused()) {
    requestedDuringPause = true;
    return Promise.resolve();
  }
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
 * THE STALL BUDGET, which is the one thing that can end a run with the flag set.
 * The first stall does not end the run. It forces one more pass — the DRAIN — on
 * the worker `encodeInWorker` has already recovered, with the stalled clip left
 * out for the rest of the run (George R2 P2). Without it, putting the poison
 * last only ever helped a LATER sweep in the same page; the only automatic later
 * pass is the launch sweep after a reload, which zeroes that memory, so one
 * poison clip sorted first stalled every launch and nothing behind it ever ran.
 * A SECOND stall in the same run is a second clip wedging a fresh worker — an
 * encoder that has stopped — and the run ends there even with the flag set
 * (#290: never go straight back at what just wedged). Only then is a joiner's
 * request left to the next launch or transition, with its PCM kept.
 *
 * The drain is a pass INSIDE the loop, not an `await` after it, precisely so the
 * guarantee above holds for it too: an earlier cut ran the drain after the
 * loop's last look at the flag, and a request landing during a successful drain
 * was dropped (George R3 P2-2).
 *
 * The clear lives in `finally`, not after the loop, on purpose: an uncaught throw
 * out of `sweepOnce` must still release the lock. `if (running)` is truthy for a
 * settled — even rejected — promise, so a clear a throw could skip would wedge
 * every later sweep onto the dead promise (#185 round-3 George P3).
 */
async function runSweeps(): Promise<void> {
  try {
    // The clip the run has already seen stall, left out of every later pass.
    let poison: SegmentId | null = null;
    do {
      requestedDuringRun = false;
      if (quiesced) break;
      // A pause noticed HERE, rather than inside `sweepOnce`, still ends a run
      // that has work owed: `requestedDuringRun` was cleared one line above,
      // and the stall budget's drain pass is scheduled through that same flag.
      // Unlike the quiesce, the pause is reversible, so the owed pass has a
      // reader — hand it over, or it is lost until the next launch.
      if (paused()) {
        requestedDuringPause = true;
        break;
      }
      const stalled = await sweepOnce(poison);
      if (stalled !== null) {
        // Second stall in this run: the encoder has stopped. End the run.
        if (poison !== null) break;
        // First stall: spend the budget on one drain pass without it.
        poison = stalled;
        requestedDuringRun = true;
      }
    } while (requestedDuringRun);
  } finally {
    running = null;
  }
}

/**
 * Move the segment that stalled last time to the BACK of this pass.
 *
 * `listPcmFinishedSegments` already orders by the DURABLE stall count (#404),
 * which is what survives a reload. This is the same move for stalls this PAGE
 * has seen and not yet written down — the count is stamped after the stall, and
 * a clip that wedges the worker every time would otherwise keep the head of the
 * queue within the run, where a stall ends the pass and nothing behind it is
 * ever attempted (George R1 P2-2). Pure, so the reordering is pinned by a test
 * rather than by reading the loop.
 */
export function afterStalledSegment<
  T extends { readonly segmentId: SegmentId },
>(
  owed: readonly T[],
  stalled: SegmentId | null | ReadonlySet<SegmentId>
): readonly T[] {
  if (stalled === null || owed.length < 2) return owed;
  const stalledIds = stalled instanceof Set ? stalled : new Set([stalled]);
  if (stalledIds.size === 0) return owed;
  const ready: T[] = [];
  const deprioritised: T[] = [];
  for (const entry of owed) {
    if (stalledIds.has(entry.segmentId)) deprioritised.push(entry);
    else ready.push(entry);
  }
  if (deprioritised.length === 0) return owed;
  return [...ready, ...deprioritised];
}

/**
 * One pass. Resolves to the id of the segment whose encode STALLED, which is
 * what ended the pass early, or `null` when the pass ran to the end.
 *
 * `skip` leaves one segment out entirely — the drain pass's poison clip.
 */
async function sweepOnce(skip: SegmentId | null): Promise<SegmentId | null> {
  if (quiesced || paused()) return null;
  let owed: Awaited<ReturnType<typeof listPcmFinishedSegments>>;
  try {
    owed = await listPcmFinishedSegments();
  } catch (cause) {
    reportFailure(
      new Error("Could not list segments awaiting transcode", { cause }),
      "transcode-sweep"
    );
    return null;
  }
  for (const { segmentId, clipId } of afterStalledSegment(
    owed,
    stalledSegmentIds
  )) {
    // Checked per segment, so a pass already in flight when the boundary catches
    // stops at the next clip rather than running the backlog to the end. One
    // segment already inside `withEncoder` finishes — it holds the lane and its
    // commit is a transaction — so at most one further row can land.
    if (quiesced || paused()) {
      if (paused()) requestedDuringPause = true;
      return null;
    }
    if (segmentId === skip) continue;
    if ((pageStallCounts.get(clipId) ?? 0) >= PAGE_STALL_LIMIT) continue;
    const failedBefore = failedSegments.get(segmentId);
    // The reading that let a held-out segment retry; `undefined` otherwise.
    let freeBeforeRetry: number | undefined;
    if (failedBefore?.clipId === clipId) {
      // Out of room last time (#1010). Read per held-out segment: a reading
      // taken before an earlier segment's commit in this pass is stale.
      const freeNow = await currentFreeBytes();
      // The read is an `await`, so the per-segment check above is stale: a
      // crash screen or `SaveFailed` may have stopped the sweep meanwhile,
      // and a retry must not start a new encoder turn after that.
      if (quiesced || paused()) {
        if (paused()) requestedDuringPause = true;
        return null;
      }
      if (!shouldRetryAfterFailure(freeNow, failedBefore.freeAtFailure)) {
        continue;
      }
      freeBeforeRetry = freeNow;
    }
    let startedHealthy = false;
    try {
      // Inside the encoder lane from the LOAD onward, not just the encode: the
      // PCM is read only once the lane is ours, so a share holding the lane
      // never coexists with a segment's PCM waiting here (round-1 George G1).
      // One segment per turn on the lane, so a share queued between two
      // segments gets in between them.
      await withEncoder(undefined, async (codec) => {
        // Sampled once the lane is ours: a Share ahead of us is what flips it.
        startedHealthy = lastEncoderHealth === "ok";
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
      stalledSegmentIds.delete(segmentId);
      failedSegments.delete(segmentId);
    } catch (cause) {
      const outOfRoom = isQuotaExceeded(cause);
      // To the app's ONE sink, not the console alone (#167). The segment id
      // rides in a wrapper rather than in the context, because `context` is the
      // sink's dedup key and has to stay a short, stable name for the SITE —
      // one key per segment id would be an unbounded set of them (#188).
      // Running out of room again on a clip already logged this page is not
      // logged again (#1010).
      const alreadyLogged =
        outOfRoom && failedSegments.get(segmentId)?.clipId === clipId;
      if (!alreadyLogged) {
        reportFailure(
          new Error(
            `Transcoding finished segment ${segmentId} failed; its PCM is kept`,
            { cause }
          ),
          "transcode-segment"
        );
      }
      if (outOfRoom) {
        // Hold it out of later sweeps, measured from the room left NOW, so a
        // retry that fails again needs still more room before the next one.
        // A storage retry whose re-read is unknown falls back to the known
        // reading that let it retry, so an unknown re-read cannot erase a
        // usable baseline and pin the segment for the page (George R1).
        const freeAfter = await currentFreeBytes();
        failedSegments.set(segmentId, {
          clipId,
          freeAtFailure: freeAfter ?? freeBeforeRetry,
        });
      } else {
        failedSegments.delete(segmentId);
      }
      // A STALLED encoder is not a per-segment failure — it is the whole worker
      // being wedged (#166), and the next segment would only re-arm the same
      // silence deadline and stall again: N segments × the timeout, blocking
      // every Share queued behind the lane that whole time. End the pass and
      // hand back WHICH clip stalled: `runSweeps` makes one drain pass without
      // it, and a later sweep in this page puts it last. Its PCM is kept either
      // way. A plain per-segment error keeps the loop going to the next segment.
      //
      // Naming the clip is what stops this early exit from becoming a
      // head-of-line block: one poison clip at the front of a stable list would
      // otherwise starve every other finished segment (George R1 P2-2, R2 P2).
      if (cause instanceof EncoderStalledError) {
        stalledSegmentIds.add(segmentId);
        // Only a stall on an encoder last seen working counts toward the limit;
        // one during a broken stretch says nothing about the clip.
        if (startedHealthy)
          pageStallCounts.set(clipId, (pageStallCounts.get(clipId) ?? 0) + 1);
        try {
          await recordTranscodeStall(clipId);
        } catch (accountingCause) {
          reportFailure(accountingCause, "transcode-stall-accounting");
        }
        return segmentId;
      }
    }
  }
  return null;
}
