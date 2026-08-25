import { useCallback, useEffect, useState } from "react";

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
import type { ChapterId, Segment, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/** Waveform resolution for a row; peaks are computed once here, not per frame. */
const PEAK_BUCKETS = 120;

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
    peaks: clip ? computePeaks(clip.samples, PEAK_BUCKETS) : null,
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
  const rows = await Promise.all(segments.map(loadSegmentRow));
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

  const addSegment = useCallback(async (): Promise<Segment> => {
    const segment = await addSegmentToChapter(chapterId);
    // A brand-new segment has no audio, so the row is known without a read.
    setRows((rs) => [
      ...rs,
      {
        segmentId: segment.id,
        ordinal: segment.index,
        hasClip: false,
        finished: false,
        peaks: null,
        durationMs: null,
      },
    ]);
    return segment;
  }, [chapterId]);

  const setFinished = useCallback(
    async (segmentId: SegmentId, finished: boolean): Promise<void> => {
      // The store rejects marking a never-recorded segment finished; the
      // checkbox is disabled there, so this is the backstop, and the rejection
      // is left to propagate rather than swallowed. Only a landed write patches
      // the row.
      await setSegmentFinished(segmentId, finished);
      setRows((rs) =>
        rs.map((r) => (r.segmentId === segmentId ? { ...r, finished } : r))
      );
    },
    []
  );

  return {
    bookName,
    chapterNumber,
    rows,
    loading,
    refreshing,
    error,
    reload,
    addSegment,
    setFinished,
  };
}
