import { useCallback, useEffect, useState } from "react";

import { decodeMp3ToCanonical } from "./audio-io";
import { requestTranscodeSweep } from "./finish-transcode";
import { computePeaks } from "@/lib/audio/peaks";
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
 * Load one segment for the recorder sheet: its breadcrumb, its finished flag,
 * and — if it has playable audio — the peaks and sample length the pan/zoom
 * view is drawn over.
 *
 * `hasClip` follows `loadSegmentClip` resolving, not `activeTakeId`, so a
 * dangling take opens as an empty segment (record-only), never a waveform over
 * audio the database cannot produce — the same F3 rule the row uses.
 *
 * A finished segment's clip is MP3 (B8/D3) and is decoded here, once, at mount:
 * editing after Finished is allowed (Q5's default — a translator who cannot fix
 * a mistake after marking a segment done will stop marking segments done), at
 * the cost of one lossy generation, which the save carries on the clip. A decode
 * that fails lands in `error` with `view` null, and the sheet's controls stay
 * disabled on a null view — so an MP3 this device cannot decode is never
 * recorded over.
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const segment = await getSegment(segmentId);
        if (!segment) throw new Error(`No such segment: ${segmentId}`);
        const chapter = await getChapter(segment.chapterId);
        const book = chapter ? await getBook(chapter.bookId) : undefined;
        const audio = await loadSegmentClip(segmentId);
        const clip = audio.kind === "resolved" ? audio.clip : null;
        // The editor works on PCM: a finished segment's MP3 is decoded here,
        // before the sheet has anything to record into.
        const samples =
          clip === null
            ? null
            : clip.encoding === "pcm"
              ? clip.samples
              : await decodeMp3ToCanonical(clip.mp3);
        if (cancelled) return;
        setView({
          bookName: book?.name ?? "",
          chapterNumber: chapter?.number ?? 0,
          ordinal: segment.index,
          finished: isFinished(segment.status),
          hasClip: samples !== null,
          peaks: samples ? computePeaks(samples, PEAK_BUCKETS) : null,
          lengthSamples: samples?.length ?? 0,
          samples,
        });
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
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

  return { view, error, setFinished };
}
