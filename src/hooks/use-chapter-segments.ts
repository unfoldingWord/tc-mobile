import { useCallback, useEffect, useState } from "react";

import { requestTranscodeSweep } from "./finish-transcode";
import { reportFailure } from "./report-failure";
import { computePeaks } from "@/lib/audio/peaks";
import { errorMessage } from "@/lib/failure-text";
import {
  addSegment as addSegmentToChapter,
  getBook,
  getChapter,
  getSegmentsOfChapter,
  renameChapter as renameChapterInStore,
  renameSegment as renameSegmentInStore,
} from "@/lib/storage/books";
import { isFinished, setSegmentFinished } from "@/lib/storage/takes";
import {
  loadSegmentClip,
  resolveSegmentAudio,
} from "@/lib/storage/segment-audio";
import {
  isMissingChapterFailure,
  isMissingSegmentFailure,
} from "@/lib/storage/stale-target";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import type { ClipMeta, Peaks } from "@/types/audio";
import type { ChapterId, ClipId, Segment, SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/**
 * A row's waveform, or `null` when the segment has no playable audio.
 *
 * Metadata first: a finished segment's clip is MP3 (B8/D3) and carries the
 * peaks the transcode took from the PCM it dropped, so its row is drawn from
 * `meta.peaks` and its bytes are never read — listing a chapter neither decodes
 * nor loads MP3s it would only discard (round-2 George P3). A PCM clip's peaks
 * are computed from its samples, so only then are the bytes loaded. An MP3 clip
 * with no stored peaks is not written by anything, but if one is ever read the
 * row draws flat rather than decoding on the list.
 *
 * `hasClip` follows the walk resolving — both halves of the clip present — the
 * same F3 rule as before. The two reads are two transactions, and the transcode
 * sweep writes between them: a clip read as PCM first can come back as MP3 from
 * the second read (a take saved with the Finished mark fires `reload()` and the
 * sweep in the same tick). That is a resolved clip, not a missing one, so the
 * second read is judged on what it actually returns — MP3 draws from its stored
 * peaks exactly as the first branch does — and only a genuinely unresolved walk
 * reads as not recorded (round-3 George P2).
 *
 * Exported for the Node test that pins that interleaving; the screen reaches it
 * only through `useChapterSegments`.
 */
export async function rowAudio(
  segmentId: SegmentId
): Promise<{ clipId: ClipId; durationMs: number; peaks: Peaks | null } | null> {
  const audio = await resolveSegmentAudio(segmentId);
  if (audio.kind !== "resolved") return null;
  const meta = audio.clip;
  if (meta.encoding === "mp3") return fromMeta(meta);
  const full = await loadSegmentClip(segmentId);
  if (full.kind !== "resolved") return null;
  const clip = full.clip;
  if (clip.encoding === "mp3") return fromMeta(clip.meta);
  return {
    clipId: clip.meta.id,
    durationMs: clip.meta.durationMs,
    peaks: computePeaks(clip.samples, ROW_PEAK_BUCKETS),
  };
}

/** An MP3 clip's row, from metadata alone: the peaks stored at transcode. */
function fromMeta(meta: ClipMeta) {
  return { clipId: meta.id, durationMs: meta.durationMs, peaks: meta.peaks };
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
  const audio = await rowAudio(segment.id);
  return {
    segmentId: segment.id,
    ordinal: segment.index,
    label: segment.label,
    hasClip: audio !== null,
    finished: isFinished(segment.status),
    clipId: audio?.clipId ?? null,
    peaks: audio?.peaks ?? null,
    durationMs: audio?.durationMs ?? null,
  };
}

/** The breadcrumb + rows a chapter needs, loaded together. */
interface ChapterView {
  readonly bookName: string;
  readonly chapterNumber: number;
  /** The facilitator's passage label, or null ⇒ show "Chapter {number}" (#264). */
  readonly chapterName: string | null;
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
    chapterName: chapter.name,
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
  const [chapterName, setChapterName] = useState<string | null>(null);
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Latches on the first successful read — see use-books: distinguishes a
  // genuinely empty chapter from a read that never succeeded, which `error`
  // (also set by a failed append) and `loading` (never re-armed) cannot.
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleTarget, setStaleTarget] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await loadChapterView(chapterId);
        if (cancelled) return;
        setBookName(view.bookName);
        setChapterNumber(view.chapterNumber);
        setChapterName(view.chapterName);
        setRows(view.rows);
        setError(null);
        setStaleTarget(false);
        setLoaded(true);
      } catch (cause) {
        if (cancelled) return;
        if (isMissingChapterFailure(cause, chapterId)) {
          setStaleTarget(true);
          setError(null);
        } else {
          setError(errorMessage(cause));
        }
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
          label: segment.label,
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
      // A missing chapter means another live copy deleted this book under this
      // screen (#378). Do not speak the raw store string; let the screen show
      // its stale state and retain an explicit Back to Books.
      if (isMissingChapterFailure(cause, chapterId)) {
        setStaleTarget(true);
        setError(null);
      } else {
        setError(errorMessage(cause));
      }
      return null;
    }
  }, [chapterId]);

  // One of the three mirrors of the stored finished flag (#160, L-10 — the
  // writers, the mirrors and the single reconciliation point are recorded at
  // `recorderClosedState` in `app/App.tsx`). This one patches in place after a
  // LANDED write, so it never diverges from the store on its own; what makes
  // it stale is a write from the sheet, and what fixes it is the `reload()` on
  // close.
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
        if (isMissingSegmentFailure(cause, segmentId)) {
          setStaleTarget(true);
          setError(null);
        } else {
          setError(errorMessage(cause));
        }
      }
    },
    []
  );

  const renameChapter = useCallback(
    async (name: string): Promise<boolean> => {
      // Rename touches no audio, so patch the breadcrumb in place rather than
      // reload() (which re-walks the chapter's PCM). The store normalises the
      // name (trim, blank ⇒ null); take the resolved value back from it so the
      // breadcrumb shows exactly what was stored. A failed write reaches the
      // same Notice a load/append failure does.
      try {
        const chapter = await renameChapterInStore(chapterId, name);
        setChapterName(chapter.name);
        setError(null);
        return true;
      } catch (cause) {
        if (isMissingChapterFailure(cause, chapterId)) {
          setStaleTarget(true);
          setError(null);
        } else {
          setError(errorMessage(cause));
        }
        return false;
      }
    },
    [chapterId]
  );

  const renameSegment = useCallback(
    async (segmentId: SegmentId, label: string): Promise<boolean> => {
      // The chapter rename's shape (#591): no audio moves, so patch the one row
      // in place with the label the store actually kept, never reload().
      //
      // A failure goes to the funnel and NOT to `error`: the screen Notice would
      // show the store's exception text (#172), and the row already says it in
      // plain words (`renameSegmentFailed`) — this `false` is what tells it to.
      try {
        const segment = await renameSegmentInStore(segmentId, label);
        setRows((rs) =>
          rs.map((r) =>
            r.segmentId === segmentId ? { ...r, label: segment.label } : r
          )
        );
        setError(null);
        return true;
      } catch (cause) {
        if (isMissingSegmentFailure(cause, segmentId)) {
          setStaleTarget(true);
          setError(null);
        } else {
          reportFailure(cause, "segment-rename");
        }
        return false;
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
    chapterName,
    rows,
    loading,
    loaded,
    refreshing,
    error,
    staleTarget,
    reload,
    addSegment,
    setFinished,
    eraseRow,
    renameChapter,
    renameSegment,
  };
}
