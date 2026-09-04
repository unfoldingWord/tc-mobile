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
import { Menu } from "./menu";
import { Notice } from "./notice";
import { SegmentRow } from "./segment-row";
import { strings } from "./strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import { useChapterShare } from "@/hooks/use-chapter-share";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { shareFilename } from "@/lib/export/naming";
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
    loaded,
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
  // The chapter-level ≡ menu (B7) — holds Share chapter, and the home for future
  // chapter actions. Like the row menu, the list goes inert behind it.
  const [chapterMenuOpen, setChapterMenuOpen] = useState(false);
  const share = useChapterShare();
  // Tap 1 — encode the chapter and arm the send gesture. Free the audio floor
  // first: a clip may be sounding when the menu opens, and the encode has taken
  // over the chapter's PCM. The menu stays open across both gestures, so the
  // header and list stay `inert` (see listInert) for the whole flow — that is
  // what keeps Record, append, and erase out of an in-flight share.
  const onPrepareShare = useCallback(() => {
    audio.leave();
    void share.prepare(chapterId, shareFilename(bookName, chapterNumber));
  }, [audio, share, chapterId, bookName, chapterNumber]);
  // Tap 2 — hand the armed File to the OS share sheet. `send()` calls
  // `navigator.share` synchronously inside this gesture; the `.then` runs after
  // the sheet settles. Close the menu once the flow is done, but NOT on `retry`
  // (the File is still armed for another tap) or `failed` (the error Notice
  // lives in the menu and must stay visible).
  const onSendShare = useCallback(() => {
    void share.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed")
        setChapterMenuOpen(false);
    });
  }, [share]);
  // Closing the menu (scrim, Escape, close button) ends the flow: drop any armed
  // File and clear state so a stale "ready" cannot linger behind a closed menu.
  const onCloseChapterMenu = useCallback(() => {
    setChapterMenuOpen(false);
    share.reset();
  }, [share]);
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
      // The recorder's in-memory buffer is the other thing that can sound. It is
      // unreachable from here today (the list is `inert` while the sheet is
      // open, and `openRecorder` calls `leave()` first), but if that coupling
      // ever loosens a sounding buffer would outlive `clearSegmentTake` with no
      // pause control — the same R-B6 hole. `stopBuffer`, not `leave()`: a
      // recording in progress is never ours to cancel from a list erase (#103).
      else if (audio.playingBuffer) audio.stopBuffer();
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
  const listInert = eraseTarget !== null || rowMenuOpen || chapterMenuOpen;

  // A first-mount load failure leaves `rows` at its initial `[]` with `error`
  // set — indistinguishable from a genuinely empty chapter unless we say so.
  // Reading it as empty would render the "add a segment" hint and a live `+`
  // over a chapter that has recordings on disk, inviting work onto a phantom
  // empty chapter (G7). A *reload* failure keeps prior rows, so this only trips
  // the true hole: the initial read. The Notice above is the recovery — back out
  // and re-enter re-mounts and re-loads.
  //
  // `loaded` (from the hook) latches on the first successful read: a failed
  // *append* also sets `error`, but on a known-empty chapter it must keep the
  // invite CTA (the only enabled create, no Retry here) up with the error in the
  // Notice, not tear it down and strand focus on Back (George R3 P2).
  const loadFailed = error !== null && !loaded;
  // See books-screen: hide the header create + while the invite's own primary
  // CTA is up, so there is one create action, announced once.
  const showEmpty = loaded && rows.length === 0;

  // Share (B7) speaks inside its own menu, not the screen Notice: the two-gesture
  // flow keeps the ≡ menu open across prepare → ready → send, so the panel is
  // what the translator is looking at. Its error code is mapped to copy here and
  // rendered in the menu below.
  const shareErrorText =
    share.error === "nothing"
      ? strings.shareNothing
      : share.error === "failed"
        ? strings.shareFailed
        : null;

  const nodes = useRef(new Map<SegmentId, HTMLElement>());
  const didInitialScroll = useRef(false);
  // What to scroll to once `rows` next includes it — a freshly appended
  // segment. A ref, not state: `addSegment` already re-renders us.
  const pendingScroll = useRef<SegmentId | null>(null);
  // See books-screen: the invite CTA unmounts on the append it triggers, so
  // hand focus to the new row rather than let it fall to Back in the header.
  const pendingFocus = useRef<SegmentId | null>(null);

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
    if (id !== null) {
      nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
      pendingScroll.current = null;
    }
    const focusId = pendingFocus.current;
    if (focusId !== null) {
      // Target the row's open/record control explicitly (not DOM order) — the
      // right next move on a never-recorded row (George R3 P3).
      nodes.current
        .get(focusId)
        ?.querySelector<HTMLElement>(".row-open")
        ?.focus();
      pendingFocus.current = null;
    }
  }, [rows]);

  const onAppend = useCallback(async () => {
    // Only the first append comes from the invite (the corner + is hidden while
    // empty); that CTA unmounts, so it hands focus to the new row.
    const fromEmpty = rows.length === 0;
    const segment = await addSegment();
    if (!segment) return; // failed append surfaced through the hook's Notice
    // The new <li> is not committed yet, so scroll once `rows` includes it —
    // the same pending-id + effect pattern BooksScreen uses.
    pendingScroll.current = segment.id;
    if (fromEmpty) pendingFocus.current = segment.id;
  }, [addSegment, rows]);

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
        {!showEmpty && (
          <Control
            icon="menu"
            label={strings.chapterMenuOpen}
            variant="quiet"
            disabled={loading || refreshing || loadFailed}
            onClick={() => setChapterMenuOpen(true)}
          />
        )}
      </header>

      {/* One line, one place: a load failure or a playback failure (a
          dangling/undecodable clip routes to audio.error) — never only the
          console. `console.error is not a channel on a phone in a village.`
          Share speaks in its own menu, not here. */}
      {(error ?? audio.error ?? (erase.error ? strings.eraseFailed : null)) ? (
        <Notice>{error ?? audio.error ?? strings.eraseFailed}</Notice>
      ) : loading ? (
        // First mount: a slow chapter (sequential PCM walk) is otherwise a
        // header over a blank list with no reason given (G8).
        <Notice tone="busy">{strings.loadingChapter}</Notice>
      ) : (
        refreshing && <Notice tone="busy">{strings.updating}</Notice>
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

      <Menu
        open={chapterMenuOpen}
        onClose={onCloseChapterMenu}
        title={strings.chapterMenuTitle}
      >
        {/* Two gestures, same spot: "Share chapter" encodes (tap 1); once armed
            it becomes a primary "Share now" that hands the File to the sheet in a
            fresh activation (tap 2). autoFocus moves focus onto it as it appears,
            since the Menu only lands focus on its open edge. */}
        {share.status === "ready" ? (
          <Control
            icon="share"
            label={strings.shareSend}
            variant="primary"
            autoFocus
            onClick={onSendShare}
          />
        ) : (
          // Stays enabled while `preparing`: a re-tap is already a no-op via the
          // hook's `preparingRef`, and disabling it would drop this control out of
          // Menu's `FOCUSABLE` set (which excludes `[disabled]`), breaking the Tab
          // trap and letting focus escape the portal (George R-B7).
          <Control
            icon="share"
            label={strings.shareChapter}
            variant="quiet"
            onClick={onPrepareShare}
          />
        )}
        {/* Feedback rides inside the panel because the flow keeps the menu open:
            the busy state while encoding, a gap warning once armed (`info`, not
            `busy` — the chapter is ready, this is a heads-up about what it lacks,
            #112), and any error code mapped above. */}
        {share.status === "preparing" && (
          <Notice tone="busy">{strings.sharePreparing}</Notice>
        )}
        {share.status === "ready" && share.missing > 0 && (
          <Notice tone="info">{strings.shareMissing(share.missing)}</Notice>
        )}
        {shareErrorText && <Notice>{shareErrorText}</Notice>}
      </Menu>
    </div>
  );
});
