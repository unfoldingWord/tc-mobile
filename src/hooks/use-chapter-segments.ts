import { useCallback, useEffect, useState } from "react";

import { requestTranscodeSweep } from "./finish-transcode";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addSegment as addSegmentToChapter,
  getBook,
  getChapter,
  getSegmentsOfChapter,
  isFinished,
  setSegmentFinished,
} from "@/lib/storage/books";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import type { Clip, Peaks } from "@/types/audio";
import type { ChapterId, Segment, SegmentId } from "@/types/domain";
import { ROW_PEAK_BUCKETS, type SegmentRow } from "@/types/view";

/**
 * A row's waveform. A PCM clip's peaks are computed from its samples here, once
 * per load; a finished segment's clip is MP3 (B8/D3) and carries the peaks the
 * transcode took from the PCM it dropped, so listing a chapter never decodes.
 * An MP3 clip with no stored peaks is not written by anything, but if one is
 * ever read the row draws flat rather than decoding a chapter on the list.
 */
function rowPeaks(clip: Clip): Peaks | null {
  return clip.encoding === "pcm"
    ? computePeaks(clip.samples, ROW_PEAK_BUCKETS)
    : clip.meta.peaks;
}

/**
 * Build one segment's row: its state, and — only if it has playable audio — its
 * peaks and duration.
 *
 * `hasClip` is `resolveSegmentAudio(...).kind === "resolved"`, taken here from
 * `loadSegmentClip` succeeding, NOT from `activeTakeId !== null`. That folds a
 * dangling or undecodable take into the never-recorded visual (F3): peaks are
 * null, the box is disabled, and the only action the row offers is re-record —
 * never amber bars over audio the database cannot produce.
 */
async function loadSegmentRow(segment: Segment): Promise<SegmentRow> {
  const audio = await loadSegmentClip(segment.id);
  const clip = audio.kind === "resolved" ? audio.clip : null;
  return {
    segmentId: segment.id,
    ordinal: segment.index,
    hasClip: clip !== null,
    finished: isFinished(segment.status),
    clipId: clip?.meta.id ?? null,
    peaks: clip ? rowPeaks(clip) : null,
    durationMs: clip?.meta.durationMs ?? null,
  };
}

/** The breadcrumb + rows a chapter needs, loaded together. */
interface ChapterView {
  readonly bookName: string;
  readonly chapterNumber: number;
  readonly rows: SegmentRow[];
}

async function loadChapterView(chapterId: ChapterId): Promise<ChapterView> {
  const chapter = await getChapter(chapterId);
  if (!chapter) throw new Error(`No such chapter: ${chapterId}`);
  const book = await getBook(chapter.bookId);
  const segments = await getSegmentsOfChapter(chapterId);
  // Sequentially, not Promise.all: each row loads the segment's full PCM to
  // compute peaks, and a chapter of long recordings loaded at once is tens to
  // hundreds of MB alive simultaneously on a low-end phone. One buffer at a
  // time — computePeaks does not need them to coexist. (The pre-pivot loader
  // walked sections sequentially for the same reason.)
  const rows: SegmentRow[] = [];
  for (const segment of segments) {
    rows.push(await loadSegmentRow(segment));
  }
  return {
    bookName: book?.name ?? "",
    chapterNumber: chapter.number,
    rows,
  };
}

/**
 * The Segments screen (B3): a chapter's ordered rows, its breadcrumb, and the
 * two mutations the screen owns — append a segment, toggle finished.
 *
 * `reload` rebuilds every row (it re-reads the PCM to recompute peaks), so it
 * is reserved for a change that actually alters audio — a save landing. The two
 * mutations here patch state in place instead: appending a segment adds one
 * never-recorded row, and toggling finished flips one flag. Neither touches
 * audio, so neither should pay for a chapter of peak recomputation.
 */
export function useChapterSegments(chapterId: ChapterId) {
  const [bookName, setBookName] = useState("");
  const [chapterNumber, setChapterNumber] = useState(0);
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Latches on the first successful read — see use-books: distinguishes a
  // genuinely empty chapter from a read that never succeeded, which `error`
  // (also set by a failed append) and `loading` (never re-armed) cannot.
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await loadChapterView(chapterId);
        if (cancelled) return;
        setBookName(view.bookName);
        setChapterNumber(view.chapterNumber);
        setRows(view.rows);
        setError(null);
        setLoaded(true);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId, reloadToken]);

  const reload = useCallback(() => {
    // Set synchronously with the token bump so there is no frame in which the
    // slot has cleared but the screen does not yet read as refreshing — that
    // frame is where a second recording would land over the first.
    setRefreshing(true);
    setReloadToken((t) => t + 1);
  }, []);

  const addSegment = useCallback(async (): Promise<Segment | null> => {
    try {
      const segment = await addSegmentToChapter(chapterId);
      // A brand-new segment has no audio, so the row is known without a read.
      setRows((rs) => [
        ...rs,
        {
          segmentId: segment.id,
          ordinal: segment.index,
          hasClip: false,
          finished: false,
          clipId: null,
          peaks: null,
          durationMs: null,
        },
      ]);
      setError(null);
      return segment;
    } catch (cause) {
      // A failed append reaches the same Notice a load failure does.
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [chapterId]);

  const setFinished = useCallback(
    async (segmentId: SegmentId, finished: boolean): Promise<void> => {
      // The store rejects marking a never-recorded segment finished; the row
      // offers no way to mark it (Finished lives only in the recorded-row
      // menu), so this is a genuine backstop. Route a
      // failure to the same Notice a load/append failure uses — `console.error`
      // is not a channel on a phone in a village — rather than only the console.
      // Only a landed write patches the row.
      try {
        await setSegmentFinished(segmentId, finished);
        setRows((rs) =>
          rs.map((r) => (r.segmentId === segmentId ? { ...r, finished } : r))
        );
        setError(null);
        // Finished is a state transition (D3): the segment's PCM is now owed an
        // MP3. Background work — the row does not wait on it, and its peaks and
        // duration do not change when it lands.
        if (finished) void requestTranscodeSweep();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    []
  );

  const eraseRow = useCallback((segmentId: SegmentId) => {
    // Erase makes ONE row never-recorded and touches no other clip, so patch it
    // in place — exactly like addSegment/setFinished — rather than reload() the
    // whole chapter. reload() flips `refreshing` on, which disables Play/Pause
    // on EVERY row while it re-walks each clip's PCM (tens–hundreds of MB on a
    // long chapter), so erasing one segment would freeze the transport of a
    // sibling that is still playing, with no way to stop it (George R-B6).
    setRows((rs) =>
      rs.map((r) =>
        r.segmentId === segmentId
          ? {
              ...r,
              hasClip: false,
              finished: false,
              clipId: null,
              peaks: null,
              durationMs: null,
            }
          : r
      )
    );
  }, []);

  return {
    bookName,
    chapterNumber,
    rows,
    loading,
    loaded,
    refreshing,
    error,
    reload,
    addSegment,
    setFinished,
    eraseRow,
  };
}
