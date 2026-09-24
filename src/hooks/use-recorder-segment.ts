import { useCallback, useEffect, useState } from "react";

import { decodeMp3ToCanonical, resumeAudioContext } from "./audio-io";
import { requestTranscodeSweep } from "./finish-transcode";
import { fitMp3Decode } from "@/lib/audio/mp3-align";
import { computePeaks } from "@/lib/audio/peaks";
import { errorMessage } from "@/lib/failure-text";
import {
  getBook,
  getChapter,
  getSegment,
  isFinished,
  setSegmentFinished,
} from "@/lib/storage/books";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { SegmentId } from "@/types/domain";
import type { Peaks } from "@/types/audio";

/** Peaks resolution for the recorder waveform — coarser than a row is wrong. */
const PEAK_BUCKETS = 400;

export interface RecorderSegmentView {
  readonly bookName: string;
  readonly chapterNumber: number;
  readonly ordinal: number;
  /** The facilitator's label, shown after the ordinal (#591); null ⇒ none. */
  readonly segmentLabel: string | null;
  /**
   * The stored flag as loaded at open, and patched again by this hook's own
   * `setFinished` once that write lands — NOT a snapshot. What it never sees
   * is a write from anywhere else: it is one of the mirrors, and none of them
   * observes the others (#160, L-10). How many there are, and what repairs
   * each, is enumerated once — at `recorderClosedState` in `app/App.tsx`. Do
   * not restate the count here. The sheet does not render this directly:
   * `displayedFinished` puts the translator's un-committed intent over it.
   */
  readonly finished: boolean;
  /** Playable audio is present (F3: resolved, not merely a take pointer). */
  readonly hasClip: boolean;
  readonly peaks: Peaks | null;
  /** Length of the existing clip in samples — the pan/zoom domain and the */
  /** append offset. Zero on an empty segment. */
  readonly lengthSamples: number;
  /**
   * The existing clip's samples, loaded here at mount, or null on an empty
   * segment. Held so the insert/append merge on close is synchronous: the save
   * path must not do a fallible read AFTER a recording exists, or a rejected
   * read would drop a take the translator cannot make again (never a recovery
   * screen). The read's one failure point is this effect, before any recording.
   */
  readonly samples: Int16Array | null;
}

/**
 * Load one segment into a recorder view, or throw: its breadcrumb, its finished
 * flag, and — if it has playable audio — the peaks and sample length the
 * pan/zoom view is drawn over.
 *
 * The React-free core of {@link useRecorderSegment}, extracted so the walk, the
 * decode alignment and the empty/PCM branches are covered in Node against
 * fake-indexeddb — the same split `performErase` uses (this repo has no
 * jsdom/renderer). The MP3 decode itself is the one browser-only step — it can
 * only run on a device and has not been exercised on one at this head; the PCM
 * and empty paths — the ones a translator hits every session — are node-tested.
 *
 * `hasClip` follows `loadSegmentClip` resolving, not `activeTakeId`, so a
 * dangling take opens as an empty segment (record-only), never a waveform over
 * audio the database cannot produce — the same F3 rule the row uses.
 *
 * A finished segment's clip is MP3 (B8/D3) and is decoded here: editing after
 * Finished is allowed (Q5's default — a translator who cannot fix a mistake
 * after marking a segment done will stop marking segments done), at the cost of
 * one lossy generation, which the save carries on the clip. A decode that
 * throws is the failure the hook turns into a recovery panel, so an MP3 this
 * device cannot decode is never recorded over.
 */
export async function loadRecorderSegmentView(
  segmentId: SegmentId
): Promise<RecorderSegmentView> {
  const segment = await getSegment(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);
  const chapter = await getChapter(segment.chapterId);
  const book = chapter ? await getBook(chapter.bookId) : undefined;
  const audio = await loadSegmentClip(segmentId);
  const clip = audio.kind === "resolved" ? audio.clip : null;
  // The editor works on PCM: a finished segment's MP3 is decoded here, before
  // the sheet has anything to record into.
  // Aligned to the recording with `fitMp3Decode`: `saveTake` stamps the
  // buffer's length as the new `frameCount`, so the buffer must be exactly the
  // recorded samples — no priming at the head (which would shift and, trimmed
  // at the tail, delete speech), no padding at the tail.
  const samples =
    clip === null
      ? null
      : clip.encoding === "pcm"
        ? clip.samples
        : fitMp3Decode(
            await decodeMp3ToCanonical(clip.mp3),
            clip.mp3,
            clip.meta.frameCount
          );
  return {
    bookName: book?.name ?? "",
    chapterNumber: chapter?.number ?? 0,
    ordinal: segment.index,
    segmentLabel: segment.label,
    finished: isFinished(segment.status),
    hasClip: samples !== null,
    peaks: samples ? computePeaks(samples, PEAK_BUCKETS) : null,
    lengthSamples: samples?.length ?? 0,
    samples,
  };
}

/**
 * The React glue over {@link loadRecorderSegmentView}: the loaded `view`, an
 * `error` when the open failed, and the recovery a failure needs.
 *
 * A decode that throws lands in `error` with `view` null; the sheet's controls
 * are disabled on a null view, so the recorder shows a recovery panel instead
 * of a blank. `retry` re-runs the load — resuming the AudioContext first, on
 * the user gesture — so the common transient failure (an "interrupted" iOS
 * context, #106) recovers in place rather than the sheet staying blank (#137);
 * `retrying` marks that attempt in flight so the panel can show it.
 *
 * `setFinished` writes one segment's finished flag through to the store
 * (`setSegmentFinished` enforces the never-finish-empty invariant) and patches
 * the local flag. The recorder no longer calls it on every checkbox tap: the
 * toggle is deferred to `close()` and, when a take commits, rides that take
 * through `addTake` instead — so this write is the caller's, on close, for the
 * no-new-take path. The Segments screen reloads on close and reflects it then.
 */
export function useRecorderSegment(segmentId: SegmentId) {
  const [view, setView] = useState<RecorderSegmentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by `retry`. The sheet is keyed on `segmentId` (App remounts it per
  // open), so a new segment resets this to 0 through the remount, not here.
  const [attempt, setAttempt] = useState(0);
  // A retry is in flight. Held so the error panel stays mounted and shows a
  // busy state in place, rather than `retry` clearing `error` — which would
  // unmount the panel, flash the disabled `!view` sheet, and show nothing that
  // the tap was received until the (possibly slow) decode resolved.
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The `attempt` bump re-runs this after a retry. The context resume is
        // NOT here: iOS spends a tap's user activation on the first `await`, so
        // the resume must fire synchronously inside the `retry` handler, not one
        // React commit later from this effect (session.ts, use-recorder.ts and
        // use-audio-session.ts all fire it fire-and-forget in the gesture for
        // exactly this reason). Here we only re-read/re-decode.
        const next = await loadRecorderSegmentView(segmentId);
        if (cancelled) return;
        setView(next);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        // The message drives `error` (the panel branch); the cause itself
        // reaches the log sink, since the panel shows translator copy, not a
        // decoder string.
        console.error("Could not open the segment for recording", cause);
        setView(null);
        setError(errorMessage(cause));
      } finally {
        if (!cancelled) setRetrying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segmentId, attempt]);

  // Re-run the load. `error` is left standing (the effect's success path clears
  // it) so the panel stays put and shows `retrying` in place; the recording is
  // untouched by a failed open, so this only ever re-reads and re-decodes.
  const retry = useCallback(() => {
    // Un-interrupt Web Audio in THIS gesture turn, before any await and before
    // the state bump commits — the "Try again" tap is the one moment iOS honours
    // a resume of an "interrupted" context (#106), and the decode runs through
    // that same shared context. Whether an interrupted context actually makes
    // `decodeAudioData` throw is unconfirmed (audio-io documents that state as
    // silent playback, not rejection), so this is a plausible remedy for a
    // transient-interruption open failure, not a proven one — on-device work,
    // still owed. Fire-and-forget, matching every other gesture path in the tree:
    // a rejected or ineffective resume (an interrupted→resume race, or absent
    // Web Audio) must not gate the re-read, which PCM and empty segments need no
    // context for and even a decode may still complete without.
    void resumeAudioContext().catch((cause) => {
      console.error("Could not resume the AudioContext before retry", cause);
    });
    setRetrying(true);
    setAttempt((n) => n + 1);
  }, []);

  // Imperatively re-read the segment and RETURN the fresh view. Used after an
  // in-sheet take commit (#134): the recorder commits a paused take, then awaits
  // this so `view.samples` — and, through it, the editor's base — reflect the
  // just-saved audio, and only then switches to edit mode. Awaitable on purpose,
  // separate from the mount/`retry` effect: the caller must sequence the mode
  // switch AFTER the reload without a set-state-in-effect, and with no window
  // where edit mode is live over the pre-take buffer. No `setRetrying` or
  // `resumeAudioContext`: the context is already live from the recording that
  // just finished, and this is a normal reload, not a recovery from a failed open.
  const reload = useCallback(async (): Promise<RecorderSegmentView | null> => {
    try {
      const next = await loadRecorderSegmentView(segmentId);
      setView(next);
      setError(null);
      return next;
    } catch (cause) {
      // Same failure channel as the load effect: the message drives the recovery
      // panel, the cause reaches the log sink (not translator-facing).
      console.error("Could not reload the segment after a commit", cause);
      setView(null);
      setError(errorMessage(cause));
      return null;
    }
  }, [segmentId]);

  const setFinished = useCallback(
    async (finished: boolean): Promise<void> => {
      // The toggle is disabled on an empty segment and the store rejects it
      // there too, so a rejection is a genuine backstop — left to propagate to
      // the caller's handler rather than swallowed.
      await setSegmentFinished(segmentId, finished);
      setView((v) => (v ? { ...v, finished } : v));
      // Finished is a state transition (D3): the PCM is now owed an MP3.
      if (finished) void requestTranscodeSweep();
    },
    [segmentId]
  );

  return { view, error, retrying, retry, reload, setFinished };
}
