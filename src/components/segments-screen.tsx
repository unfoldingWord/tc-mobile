import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { Control } from "./control";
import { Notice } from "./notice";
import { SegmentRow } from "./segment-row";
import { strings } from "./strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import type { ChapterId, SegmentId } from "@/types/domain";
import { firstNotFinished } from "@/types/view";

/**
 * What App (slice 4) can drive from outside: a rebuild after a recorder commit.
 * The screen stays mounted (dimmed) behind the recorder sheet, so when the
 * sheet saves a take, App calls `reload()` and the row's waveform appears.
 */
export interface SegmentsScreenHandle {
  reload: () => void;
}

interface SegmentsScreenProps {
  chapterId: ChapterId;
  /**
   * The single audio owner, held by App so `leave()` fires on every
   * navigation. The screen reads playback state from it and plays through it;
   * "only one row plays at a time" falls out of that single floor for free.
   */
  audio: UseAudioSession;
  onBack: () => void;
  onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
}

/**
 * B3 — the Segments screen: a chapter's ordered rows, where order IS export
 * order. Breadcrumb back to Books, an append `+`, and the three-state rows.
 *
 * A returning translator lands on the first not-finished segment (F5), so a
 * long chapter opens where the work is rather than at the top.
 */
export const SegmentsScreen = forwardRef<
  SegmentsScreenHandle,
  SegmentsScreenProps
>(function SegmentsScreen({ chapterId, audio, onBack, onOpenRecorder }, ref) {
  const {
    bookName,
    chapterNumber,
    rows,
    loading,
    refreshing,
    error,
    reload,
    addSegment,
    setFinished,
  } = useChapterSegments(chapterId);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  const nodes = useRef(new Map<SegmentId, HTMLElement>());
  const didInitialScroll = useRef(false);
  // What to scroll to once `rows` next includes it — a freshly appended
  // segment. A ref, not state: `addSegment` already re-renders us.
  const pendingScroll = useRef<SegmentId | null>(null);

  const setNode = useCallback((id: SegmentId, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  useEffect(() => {
    // Land on the first not-finished segment once the list is first loaded
    // (F5). All finished, or an empty chapter, leaves the view at the top.
    if (loading || didInitialScroll.current) return;
    didInitialScroll.current = true;
    const target = firstNotFinished(rows);
    if (target)
      nodes.current.get(target.segmentId)?.scrollIntoView({ block: "nearest" });
  }, [loading, rows]);

  useEffect(() => {
    const id = pendingScroll.current;
    if (id === null) return;
    nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
    pendingScroll.current = null;
  }, [rows]);

  const onAppend = useCallback(async () => {
    const segment = await addSegment();
    if (!segment) return; // failed append surfaced through the hook's Notice
    // The new <li> is not committed yet, so scroll once `rows` includes it —
    // the same pending-id + effect pattern BooksScreen uses.
    pendingScroll.current = segment.id;
  }, [addSegment]);

  const onSetFinished = useCallback(
    (segmentId: SegmentId, finished: boolean) => {
      // The checkbox is disabled on a never-recorded row and the store rejects
      // marking one finished, so a rejection here is a genuine backstop, not a
      // routine path — it reaches the console rather than being swallowed.
      void setFinished(segmentId, finished).catch((cause: unknown) => {
        console.error("Could not change the finished flag", cause);
      });
    },
    [setFinished]
  );

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <header className="flex items-center gap-[8px] px-[4px] py-[2px]">
        <Control
          icon="back"
          label={strings.backToBooks}
          variant="quiet"
          onClick={onBack}
        />
        <button
          type="button"
          onClick={onBack}
          className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left"
          style={{ color: "var(--s-ink)" }}
        >
          {bookName} &gt; {strings.chapterName(chapterNumber)}
        </button>
        <Control
          icon="plus"
          label={strings.addSegment}
          variant="quiet"
          disabled={refreshing}
          onClick={() => void onAppend()}
        />
      </header>

      {/* One line, one place: a load failure or a playback failure (a
          dangling/undecodable clip routes to audio.error) — never only the
          console. `console.error is not a channel on a phone in a village.` */}
      {(error ?? audio.error) ? (
        <Notice>{error ?? audio.error}</Notice>
      ) : (
        refreshing && <Notice tone="busy">{strings.saving}</Notice>
      )}

      <div className="flex-1 overflow-y-auto">
        {!loading && rows.length === 0 ? (
          <p
            className="flex h-full items-center justify-center text-center text-[13px]"
            style={{ color: "var(--s-ink-muted)" }}
          >
            {strings.segmentsEmptyHint}
          </p>
        ) : (
          <ul className="flex flex-col gap-[8px]">
            {rows.map((row) => (
              <li key={row.segmentId} ref={(el) => setNode(row.segmentId, el)}>
                <SegmentRow
                  row={row}
                  playing={audio.playingId === row.segmentId}
                  playbackElapsedMs={audio.playbackElapsedMs}
                  busy={refreshing}
                  onPlay={(offsetSeconds) => audio.playTake(row, offsetSeconds)}
                  onOpenRecorder={() =>
                    onOpenRecorder(row.segmentId, row.ordinal)
                  }
                  onSetFinished={(finished) =>
                    onSetFinished(row.segmentId, finished)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});
