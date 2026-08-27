import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Control } from "./control";
import { EmptyState } from "./empty-state";
import { EraseConfirm } from "./erase-confirm";
import { Notice } from "./notice";
import { SegmentRow } from "./segment-row";
import { strings } from "./strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import { useEraseSegment } from "@/hooks/use-erase-segment";
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
    eraseRow,
  } = useChapterSegments(chapterId);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  // Erase Segment from a row's overflow menu (B6, D-TWO-ENTRIES). One hook and
  // one confirm for the whole list — the same implementation the recorder menu
  // uses — with the target segment held here while the dialog is up. On success
  // `eraseRow` patches that one row to never-recorded in place (not reload());
  // on failure the reason surfaces in the screen's Notice.
  const [eraseTarget, setEraseTarget] = useState<SegmentId | null>(null);
  // A row's overflow menu is open. Lifted here so the list can go `inert` behind
  // it for AT/switch users (the menu itself is portalled out, so it stays live);
  // only one is ever open at a time — the open menu's scrim blocks reaching a
  // second row's trigger. (George R-B6.)
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const erase = useEraseSegment();
  const closeErase = useCallback(() => setEraseTarget(null), []);
  const onConfirmErase = useCallback(() => {
    if (eraseTarget === null) return;
    void (async () => {
      // Stop playback first if THIS row is the one sounding. `clearSegmentTake`
      // deletes the clip, but `playTake` already handed a live source node built
      // from in-memory PCM, so the deleted recording would keep playing to its
      // end — and after the patch there is no pause control to stop it (George
      // R-B6). Only our own target: another row's playback is not ours to stop,
      // and only one thing sounds at a time, so `leave()` here ends exactly it.
      if (audio.playingId === eraseTarget) audio.leave();
      const result = await erase.erase(eraseTarget);
      // On success patch that ONE row to never-recorded in place — NOT reload(),
      // which deadens every transport while it re-walks the chapter's PCM
      // (George R-B6). "failed" leaves `erase.error` for the Notice; a
      // double-tap's "busy" is ignored so the confirm does not vanish under the
      // first erase.
      if (result === "ok") eraseRow(eraseTarget);
      if (result !== "busy") setEraseTarget(null);
    })();
  }, [audio, erase, eraseTarget, eraseRow]);
  // The list is hidden from AT while a dialog is up, mirroring the recorder
  // sheet (G8: aria-modal alone is not trusted to hide the background).
  const listInert = eraseTarget !== null || rowMenuOpen;

  // A first-mount load failure leaves `rows` at its initial `[]` with `error`
  // set — indistinguishable from a genuinely empty chapter unless we say so.
  // Reading it as empty would render the "add a segment" hint and a live `+`
  // over a chapter that has recordings on disk, inviting work onto a phantom
  // empty chapter (G7). A *reload* failure keeps prior rows, so this only trips
  // the true hole: the initial read. The Notice above is the recovery — back out
  // and re-enter re-mounts and re-loads.
  const loadFailed = error !== null && rows.length === 0;
  // See books-screen: hide the header create + while the invite's own primary
  // CTA is up, so there is one create action, announced once.
  const showEmpty = !loading && !loadFailed && rows.length === 0;

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
      // The hook routes a failure to the screen's Notice (the checkbox is
      // disabled on a never-recorded row and the store rejects marking one
      // finished, so this is a backstop). It does not reject, so there is
      // nothing to handle here.
      void setFinished(segmentId, finished);
    },
    [setFinished]
  );

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <header
        className="flex items-center gap-[8px] px-[4px] py-[2px]"
        inert={listInert || undefined}
      >
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
        {!showEmpty && (
          <Control
            icon="plus"
            label={strings.addSegment}
            variant="quiet"
            disabled={loading || refreshing || loadFailed}
            onClick={() => void onAppend()}
          />
        )}
      </header>

      {/* One line, one place: a load failure or a playback failure (a
          dangling/undecodable clip routes to audio.error) — never only the
          console. `console.error is not a channel on a phone in a village.` */}
      {(error ?? audio.error ?? (erase.error ? strings.eraseFailed : null)) ? (
        <Notice>{error ?? audio.error ?? strings.eraseFailed}</Notice>
      ) : loading ? (
        // First mount: a slow chapter (sequential PCM walk) is otherwise a
        // header over a blank list with no reason given (G8).
        <Notice tone="busy">{strings.loadingChapter}</Notice>
      ) : (
        refreshing && <Notice tone="busy">{strings.saving}</Notice>
      )}

      <div className="flex-1 overflow-y-auto" inert={listInert || undefined}>
        {showEmpty ? (
          <EmptyState
            headline={strings.segmentsEmpty}
            teach={strings.segmentsEmptyTeach}
            ctaLabel={strings.addSegment}
            ctaIcon="plus"
            onCta={() => void onAppend()}
          />
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
                  onErase={() => setEraseTarget(row.segmentId)}
                  onMenuOpenChange={setRowMenuOpen}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <EraseConfirm
        open={eraseTarget !== null}
        title={strings.eraseConfirmTitle}
        confirmLabel={strings.eraseConfirm}
        cancelLabel={strings.eraseCancel}
        busy={erase.erasing}
        onConfirm={onConfirmErase}
        // Stable identity: a fresh lambda each render would, together with the
        // 60 ms playback tick, thrash EraseConfirm's focus effect (George R-B6).
        onCancel={closeErase}
      />
    </div>
  );
});
