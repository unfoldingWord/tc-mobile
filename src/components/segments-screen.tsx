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
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { SegmentRow } from "./segment-row";
import { strings } from "./strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import { useChapterShare } from "@/hooks/use-chapter-share";
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
    chapterName,
    rows,
    loading,
    loaded,
    refreshing,
    error,
    reload,
    addSegment,
    setFinished,
    eraseRow,
    renameChapter,
  } = useChapterSegments(chapterId);
  // The passage heading the breadcrumb shows: the facilitator's label, else
  // "Chapter {number}" (#264).
  const chapterHeading = strings.chapterHeading(chapterName, chapterNumber);

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
  // Whether the chapter ≡ menu is showing its rename field (#264) or its action
  // list. Resets to the action list whenever the menu closes.
  const [renamingChapter, setRenamingChapter] = useState(false);
  // A monotonic token for the current chapter-menu session. It advances whenever
  // the menu opens, closes, or arms a share — every transition after which a
  // late-resolving rename must NOT run its close, or it would drop a prepared
  // encode (F1). onSaveChapterName captures it and closes only if it still
  // matches. A ref, read at resolution time, so it sees the live value.
  const chapterMenuSession = useRef(0);
  const share = useChapterShare();
  // Tap 1 — encode the chapter and arm the send gesture. Free the audio floor
  // first: a clip may be sounding when the menu opens, and the encode has taken
  // over the chapter's PCM. The menu stays open across both gestures, so the
  // header and list stay `inert` (see listInert) for the whole flow — that is
  // what keeps Record, append, and erase out of an in-flight share.
  const onPrepareShare = useCallback(() => {
    audio.leave();
    // Arming a share ends the current rename-close session: a rename resolving
    // after this must not close the menu and drop the encode we are preparing.
    chapterMenuSession.current += 1;
    void share.prepare(
      chapterId,
      strings.shareFilename(bookName, chapterNumber)
    );
  }, [audio, share, chapterId, bookName, chapterNumber]);
  // Tap 2 — hand the armed File to the OS share sheet. `send()` opens the sheet
  // as its first call inside this gesture (`navigator.share` in a browser, the
  // Share plugin in the native shell, whose file tap 1 already wrote to the
  // cache — George R5 P2); the `.then` runs after the sheet settles. Close the
  // menu once the flow is done, but NOT on `retry`
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
    chapterMenuSession.current += 1;
    setChapterMenuOpen(false);
    setRenamingChapter(false);
    share.reset();
  }, [share]);
  // Open the chapter ≡ menu, starting a fresh session so a rename still in flight
  // from a prior open cannot close this one.
  const openChapterMenu = useCallback(() => {
    chapterMenuSession.current += 1;
    setChapterMenuOpen(true);
  }, []);
  // Commit the typed chapter name (#264), then close the menu on success. The
  // hook patches the breadcrumb in place. A failed write keeps the field up
  // with the reason in the menu's own Notice — the screen Notice sits behind
  // the scrim.
  const onSaveChapterName = useCallback(
    (name: string) => {
      // Capture the session this rename belongs to. IDB can settle after the
      // user has closed the menu or armed a share — both advance the token — so
      // close ONLY if we are still the same session (F1). Without this, the stale
      // resolution closes the now-current menu and runs share.reset(),
      // discarding a prepared encode.
      const session = chapterMenuSession.current;
      void renameChapter(name).then((ok) => {
        if (ok && chapterMenuSession.current === session) onCloseChapterMenu();
      });
    },
    [renameChapter, onCloseChapterMenu]
  );
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
          {bookName} &gt; {chapterHeading}
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
        {/* Shown even on an empty chapter (unlike the append +, which would
            duplicate the empty-state CTA): a freshly created chapter has no
            segments yet, and renaming it for the passage is exactly the first
            setup step (#264). Share inside handles the no-audio case itself. */}
        <Control
          icon="menu"
          label={strings.chapterMenuOpen}
          variant="quiet"
          disabled={loading || refreshing || loadFailed}
          onClick={openChapterMenu}
        />
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
        {renamingChapter ? (
          <>
            {/* Rename the chapter in place (#264). Seeded with the current
                custom label, or empty when it is still the default "Chapter N"
                — so the facilitator types the passage rather than editing a
                placeholder. */}
            <NameEdit
              initialValue={chapterName ?? ""}
              fieldLabel={strings.chapterNameField}
              onSave={onSaveChapterName}
              onCancel={() => setRenamingChapter(false)}
            />
            {/* A failed rename speaks here — the screen Notice is behind the
                scrim — while the field stays up for another try. */}
            {error && <Notice>{error}</Notice>}
          </>
        ) : (
          <>
            <Control
              icon="edit"
              label={strings.renameChapter}
              variant="quiet"
              onClick={() => setRenamingChapter(true)}
            />
            {/* Two gestures, same spot: "Share chapter" encodes (tap 1); once
                armed it becomes a primary "Share now" that hands the File to the
                sheet in a fresh activation (tap 2). autoFocus moves focus onto it
                as it appears, since the Menu only lands focus on its open edge. */}
            {share.status === "ready" ? (
              <Control
                icon="share"
                label={strings.shareSend}
                variant="primary"
                autoFocus
                onClick={onSendShare}
              />
            ) : (
              // Stays enabled while `preparing`: a re-tap is already a no-op via
              // the hook's `preparingRef`, and disabling it would drop this
              // control out of Menu's `FOCUSABLE` set (which excludes
              // `[disabled]`), breaking the Tab trap and letting focus escape the
              // portal (George R-B7).
              <Control
                icon="share"
                label={strings.shareChapter}
                variant="quiet"
                onClick={onPrepareShare}
              />
            )}
            {/* Feedback rides inside the panel because the flow keeps the menu
                open: the busy state while encoding, a gap warning once armed
                (`info`, not `busy` — the chapter is ready, this is a heads-up
                about what it lacks, #112), and any error code mapped above. */}
            {share.status === "preparing" && (
              <Notice tone="busy">{strings.sharePreparing}</Notice>
            )}
            {share.status === "ready" && share.missing > 0 && (
              <Notice tone="info">{strings.shareMissing(share.missing)}</Notice>
            )}
            {shareErrorText && <Notice>{shareErrorText}</Notice>}
          </>
        )}
      </Menu>
    </div>
  );
});
