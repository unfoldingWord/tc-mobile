import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { EmptyState } from "./empty-state";
import { EraseConfirm } from "./erase-confirm";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { SegmentRow } from "./segment-row";
import { segmentsListInert } from "./segments-inert";
import {
  shareErrorText as shareErrorCopy,
  shareGapText,
  shareProgressText,
} from "./share-error-copy";
import { shareErrorGlyph, shareOutcomeGlyph } from "./share-outcome-glyph";
import { ShareProgress } from "./share-progress";
import { strings } from "./strings";
import { shareOverlayOwnsScreen } from "@/hooks/share-progress";
import { readSharePlatform } from "@/hooks/share-target";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import { useChapterShare } from "@/hooks/use-chapter-share";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import { useScreenLayers } from "@/hooks/use-screen-layers";
import type { Layer } from "@/lib/nav/layer-stack";
import { overlayDismissal } from "@/lib/nav/navigation";
import type { ChapterId, SegmentId } from "@/types/domain";
import { firstNotFinished } from "@/types/view";

/**
 * Every overlay this screen can put over the chapter, as a system-Back layer
 * (#452 PR4, #374). The union is what makes `useScreenLayers`' behaviour record
 * total — a row added here with no behaviour, or a behaviour for an id that no
 * longer exists, is a `tsc` error rather than a Back that silently does nothing.
 *
 * Three, matching the design's "PR4 — Segments' overlays" (the chapter ≡ menu
 * and its rename mode are ONE overlay: rename is a mode inside the same panel,
 * so it opens no second layer and Back from the rename field closes the menu,
 * just as the panel's own Close does).
 *
 * `segments:row-menu` is the one whose state does not live here: it belongs to
 * the `SegmentRow` that opened it, which hands its own close up through
 * `onMenuOpen` for this screen to register. Same split as Books'
 * `books:log-clear-confirm` — the child keeps the state, the screen keeps the
 * registration — and for the same reason: only the screen can see the stack.
 *
 * NOT a layer: `<ShareProgress>` (#491), exactly as on Books. It goes up and
 * comes down on the share flow's own timeline rather than on any click, so
 * registering it would mean popping a layer from a timer — an effect, which
 * invariant 6 forbids. It is folded into the chapter ≡ menu's `busy()` instead
 * (Amendment D), which is also exactly right: the overlay's whole lifetime is
 * the window in which that menu's own close is a no-op
 * (`closeChapterMenuState`'s early return), so Back must refuse rather than run
 * a `dismiss()` that does nothing.
 */
type SegmentsLayerId =
  "segments:chapter-menu" | "segments:row-menu" | "segments:erase-confirm";

/**
 * What App (slice 4) can drive from outside: a rebuild after a recorder commit,
 * and the forced overlay teardown Amendment C's decision (b) owes this screen.
 * The screen stays mounted (dimmed) behind the recorder sheet, so when the
 * sheet saves a take, App calls `reload()` and the row's waveform appears.
 */
export interface SegmentsScreenHandle {
  reload: () => void;
  /**
   * Take this screen's overlays down — React state AND the layer stack —
   * because App is about to raise the recorder sheet over it.
   *
   * Amendment C's other half (#452 PR3's recorded decision, option (b);
   * `docs/design/back-navigation.md`). The adapter's cleanup effect clears the
   * WHOLE layer stack on a `screen` change, but Segments → Recorder is not an
   * unmount — `App.tsx` keeps this screen mounted and `inert` under the sheet —
   * so without this, React overlay state would outlive the `Layer`s protecting
   * it and a Back once the sheet closed would route `"to-books"` from under an
   * open menu.
   *
   * See `dismissOverlays` below for the one overlay it cannot close (an erase
   * already in flight) and why that is the right answer rather than a gap.
   */
  dismissOverlays: () => void;
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
  /** Register an open overlay as a Back layer. `useNavStack`'s, through App. */
  pushLayer: (layer: Layer) => void;
  /** Unregister one by id. Idempotent. */
  popLayer: (id: string) => void;
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
>(function SegmentsScreen(
  { chapterId, audio, onBack, onOpenRecorder, pushLayer, popLayer },
  ref
) {
  const {
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
  } = useChapterSegments(chapterId);
  // The passage heading the breadcrumb shows: the facilitator's label, else
  // "Chapter {number}" (#264).
  const chapterHeading = strings.chapterHeading(chapterName, chapterNumber);

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
  // The rename write is in flight (#383) — forwarded to NameEdit's Confirm as
  // `busy`. Reset to `false` at every site that bumps `chapterMenuSession`
  // (open, close, arm-a-share) as well as on settle, mirroring
  // `books-screen.tsx`'s `savingBookName`: a still-pending rename must not
  // show a freshly (re)opened menu's Confirm as busy before it has been
  // tapped (Frank r1, #384).
  const [savingChapterName, setSavingChapterName] = useState(false);
  // The same flag as a live ref (#452 PR4, the design's F4 — the Segments twin
  // of `books-screen.tsx`'s `savingBookNameRef`). `savingChapterName` above is
  // last render's answer and drives NameEdit's `busy`; this is what the chapter
  // ≡ menu's `Layer.busy()` reads, because the system-Back handler calls it from
  // a `popstate` with no render in between (invariant 4).
  const savingChapterNameRef = useRef(false);
  // The two always move together, through one setter, so the Confirm a
  // translator can see and the Back the system sends can never disagree about
  // whether a rename is in flight. Every site that touched `setSavingChapterName`
  // calls this instead.
  const setSavingName = useCallback((value: boolean) => {
    savingChapterNameRef.current = value;
    setSavingChapterName(value);
  }, []);
  // A monotonic token for the current chapter-menu session. It advances whenever
  // the menu opens, closes, or arms a share — every transition after which a
  // late-resolving rename must NOT run its close, or it would drop a prepared
  // encode (F1). onSaveChapterName captures it and closes only if it still
  // matches. A ref, read at resolution time, so it sees the live value.
  const chapterMenuSession = useRef(0);
  const share = useChapterShare();
  const erase = useEraseSegment();
  // MEMBERS, never the objects — and this is #452's own open question 3,
  // answered here on this screen's evidence as the design asks PR4 to do.
  //
  // PR3 answered it for Books with "not needed": nothing there depended on
  // `useBookShare()`'s identity. That is NOT true here. `closeChapterMenuState`
  // below needs the share flow, its identity flows through `onCloseChapterMenu`
  // into `dismissOverlays`, and `dismissOverlays` is in `useImperativeHandle`'s
  // dependency array — a hook with a dependency array and a real effect (the
  // handle App calls into). With the whole object as the dependency, every
  // render of this screen, including the ~60 ms playback tick, would tear that
  // handle down and rebuild it.
  //
  // So Amendment E's SECOND remedy applies rather than its first: the consumers
  // below depend on stable MEMBERS — `share.ownsScreen`, `share.reset`,
  // `erase.isErasing` — never on the objects, and the hooks are left
  // unmemoized. `ownsScreen` is a `useCallback([modal])` and `reset` a
  // `useCallback([handoff, modal])` over two values created once per hook
  // instance (`share-flow.ts`); `isErasing` is a `useCallback([])` over a ref.
  // All three are created once for their hook's life, so every dependency array
  // naming one of them is stable. `books-screen.tsx` does the same for
  // `bookShare.reset`.
  //
  // They are LOCAL BINDINGS rather than member expressions in the dependency
  // arrays because this repo's `exhaustive-deps` asks for the whole object when
  // a body writes `share.ownsScreen()` — which is the churn this exists to
  // avoid. The binding is the sanctioned way to say "this member, not that
  // object", and it is the same shape as `resetBookShare` on Books.
  const shareOwnsScreen = share.ownsScreen;
  const resetShare = share.reset;
  const isErasing = erase.isErasing;
  // The open row menu's own close, handed up by the `SegmentRow` that owns it
  // (`onMenuOpen`). `null` while no row menu is open. This is the
  // `segments:row-menu` layer's `dismiss()`, kept as a ref for the same reason
  // Books keeps `logClearBehavior` as one: the state belongs to the child, the
  // registration belongs to the screen, and neither may be read during render.
  const rowMenuDismiss = useRef<(() => void) | null>(null);

  // ── System Back: this screen's overlays as layers (#452 PR4, #374) ────────
  //
  // The shape is Books' (`books-screen.tsx`), deliberately: each overlay has a
  // STATE half here — everything it takes to close the overlay itself — and,
  // below `layers`, a full close that also unregisters its layer. Every
  // behaviour in the record refers only to things already declared, because a
  // forward reference makes the React Compiler bail on the whole component and
  // takes `react-hooks`' own analysis down with it (#212's failure mode).
  //
  // A `dismiss()` is the STATE half on purpose: the adapter unregisters the
  // layer itself immediately after calling it (`use-nav-stack.ts`'s
  // `"rearm-layer-dismiss"` → `popLayer(top.id)`, #494 item 3).
  //
  // `busy()` must be true whenever `dismiss()` would be a no-op, or a Back runs
  // a dismissal that changes nothing while the adapter still unregisters the
  // layer — leaving the overlay on screen with nothing routing Back to it
  // (#494 item 3). Segments is ABOVE the floor, so unlike Books there is no
  // floor entry to lose: the consumed entry is this screen's own and
  // `rearmAfterLayerBack` always puts it back. What a mismatch costs here is
  // the NEXT Back routing `"to-books"` out from under an open overlay, which is
  // #374's original complaint.

  /**
   * Closing the chapter ≡ menu (scrim, Escape, close button, a system Back)
   * ends the flow: drop any armed File so a stale "ready" cannot linger behind
   * a closed menu.
   *
   * Returns `false` while the share overlay owns the screen, where this is a
   * no-op — so the caller keeps its layer registered. That guard is KEPT
   * deliberately (#491, the DRI's option-A pick): every OTHER guard this menu's
   * controls carried was removed once `<Menu>`'s own `inert` prop started
   * covering them — this one is not, because `inert` only reaches the DOM
   * subtree it is applied to, and this function is still reachable from THREE
   * places outside that subtree while the overlay is up: Menu's own `window`
   * Escape listener (`menu.tsx`'s `onKeyDown`), its scrim `onClick`, and now the
   * system Back gesture. `<ShareProgress>`'s own capture-phase Escape (with
   * `stopPropagation`) is expected to swallow the Escape before Menu's
   * bubble-phase listener sees it, and the overlay's own scrim (`z-index: 90`,
   * over the menu scrim's 80) is expected to swallow the click — but neither of
   * those is `inert`, and neither sees a system Back at all, so this guard is
   * the belt for all three. The overlay's OWN scrim/Escape still cancel a
   * genuinely cancelable busy-prepare phase, wired straight to `share.reset`
   * (see `<ShareProgress>` below) rather than through this function.
   *
   * It reads `share.ownsScreen()` — the LIVE flow state — and not
   * `shareOverlayOwnsScreen(share.progress)`, the rendered mirror it used
   * before #452 PR4 (Books moved for the same reason in PR3). Same predicate,
   * one commit fresher, and the freshness is load-bearing now: this is a
   * `Layer`'s `dismiss()`, reached only when that layer's `busy()` said the
   * overlay does NOT own the screen. Two copies of the same fact can disagree
   * for one commit, and the disagreement is the bad way round — `busy()` false,
   * this guard true — which is a Back that unregisters the layer while the menu
   * stays open. One source, no window. (`listInert` below keeps the rendered
   * mirror, which is right: it is a rendering decision, not a `popstate` one.)
   */
  const closeChapterMenuState = useCallback(() => {
    if (shareOwnsScreen()) return false;
    chapterMenuSession.current += 1;
    setChapterMenuOpen(false);
    setRenamingChapter(false);
    setSavingName(false);
    resetShare();
    return true;
  }, [resetShare, shareOwnsScreen, setSavingName]);

  /**
   * Cancel / Escape / scrim / a system Back take the erase confirm down. The
   * row it was armed for is untouched — this is the "do not erase" answer.
   */
  const closeEraseState = useCallback(() => setEraseTarget(null), []);

  const layers = useScreenLayers<SegmentsLayerId>(pushLayer, popLayer, {
    "segments:chapter-menu": {
      // Two writes live behind this panel: a rename in flight (#383/#384 —
      // whether it SHOULD refuse Back is #452 open question 7, for the
      // requirements owner; this ships the design's overlay-catalogue row and
      // is one term to remove either way), and the share flow, whose modal owns
      // the screen for its whole timeline (Amendment D, widened from
      // `status === "preparing"` because #491's modal outlives it — see
      // `UseShareFlow.ownsScreen`).
      //
      // The Close-vs-Back split Books carries (#536 item 2) is here too, and by
      // the same construction: `closeChapterMenuState` guards on `ownsScreen()`
      // alone, so a rename in flight refuses a system Back and does not refuse
      // Menu's Close/scrim/Escape. Named, not closed — closing it decides open
      // question 7 for Close, which is the requirements owner's call.
      busy: () => savingChapterNameRef.current || shareOwnsScreen(),
      dismiss: () => {
        closeChapterMenuState();
      },
    },
    "segments:row-menu": {
      // Edit, Finished and Erase all hand off to the screen and close; none of
      // them holds a write open behind this panel, so there is nothing for Back
      // to wait on. (`onSetFinished`'s store write fires and forgets, with its
      // own failure channel — the row menu is already gone by then.)
      busy: () => false,
      // The row's own close, which also reports back up through `onMenuClose`.
      // `?.` covers only the window in which the row unmounted without this
      // layer being closed, which `onMenuClose` makes unreachable — and if it
      // were ever reached, Back would spend one gesture and then fall through,
      // not trap.
      dismiss: () => rowMenuDismiss.current?.(),
    },
    "segments:erase-confirm": {
      // The same live ref `erase()` flips to refuse a second Confirm, so Back
      // and Confirm agree about "in flight" by construction. NOT `erase.erasing`
      // — that is last render's answer, which is the exact defect invariant 4
      // exists for and which `recorder.tsx` still carries at its own call site
      // (#452 PR5).
      busy: isErasing,
      dismiss: closeEraseState,
    },
  });

  // The chapter ≡ menu's ONE open and ONE close. Every entry point — the ≡, the
  // panel's Close, Escape, a scrim tap, a completed send — goes through this
  // pair, so no call site can forget the registration.
  //
  // Open the chapter ≡ menu, starting a fresh session so a rename still in
  // flight from a prior open cannot close this one.
  const openChapterMenu = useCallback(() => {
    chapterMenuSession.current += 1;
    setChapterMenuOpen(true);
    // A still-pending rename from the last time this menu was open must not
    // show the freshly reopened Confirm as busy before it has been tapped.
    setSavingName(false);
    // Registered in the SAME handler that opens it (invariant 6), and after the
    // state above for the reason `use-nav-stack.ts`'s `openChapter` documents:
    // the layer is on the stack before this gesture returns either way.
    layers.open("segments:chapter-menu");
  }, [layers, setSavingName]);
  // Menu's actual `onClose`, and the one close every caller uses.
  //
  // The Menu-level guard that blocked this while `savingChapterName` was true
  // (round 3/4 of #384's review) was REVERTED: it stopped the
  // scrim/Close/Escape-elsewhere from unmounting the menu mid-write, but system
  // Back still could (a separate mechanism, `lib/nav/navigation.ts`'s
  // `popAction`), and a Menu-only guard funnels a user onto exactly that worse
  // exit (George R5 P2) — Close used to work, so nobody reached for system
  // Back; making it a silent no-op is what sends them there. **#452 PR4 gives
  // system Back its own route through this menu's `Layer`**, which is what #374
  // and #393 were waiting for; see the `busy()` above for the split that is
  // left, and why it is named rather than closed.
  const onCloseChapterMenu = useCallback(() => {
    if (closeChapterMenuState()) layers.close("segments:chapter-menu");
  }, [closeChapterMenuState, layers]);

  // A row's overflow menu opened, handing up its own close. The screen takes
  // both jobs at once: the list goes `inert` behind it, and it becomes a layer.
  const onRowMenuOpen = useCallback(
    (close: () => void) => {
      rowMenuDismiss.current = close;
      setRowMenuOpen(true);
      layers.open("segments:row-menu");
    },
    [layers]
  );
  // ...and closed, by its own control, one of its action items, an unmounting
  // row, or the system Back that ran `close` as this layer's `dismiss()`.
  // Idempotent on every one of those paths.
  const onRowMenuClose = useCallback(() => {
    rowMenuDismiss.current = null;
    setRowMenuOpen(false);
    layers.close("segments:row-menu");
  }, [layers]);

  // Arm the erase confirm for a row. Called from the row menu's Erase item
  // BEFORE that menu closes itself, so the stack goes 1 → 2 → 1 and never
  // passes through empty (`segment-row.tsx` has the ordering comment; Books'
  // `onArmDelete` is the same interleave).
  const armErase = useCallback(
    (segmentId: SegmentId) => {
      layers.open("segments:erase-confirm");
      setEraseTarget(segmentId);
    },
    [layers]
  );
  // The confirm's own Cancel/Escape/scrim, plus the layer. A system Back
  // reaches the state half directly (the adapter unregisters the layer itself),
  // so both exits end in the same place.
  const closeErase = useCallback(() => {
    closeEraseState();
    layers.close("segments:erase-confirm");
  }, [closeEraseState, layers]);

  /**
   * Amendment C's other half — see `SegmentsScreenHandle.dismissOverlays`.
   *
   * **The erase-in-flight decision (#452 PR4's, recorded on #452 and in the
   * PR):** the confirm is NOT forced down while its `clearSegmentTake` is
   * committing. The rule is `overlayDismissal`'s, reused rather than restated —
   * `confirmOpen && !erasing` — which the recorder's own absorbed Back already
   * obeys for the identical dialog, and for the identical reason one level up:
   * `onConfirmErase` holds `eraseTarget` non-null across the whole delete
   * precisely to keep `listInert` true, and clearing it mid-erase un-inerts the
   * list and exposes Record on the very row being erased. Forcing it would
   * trade a bookkeeping mismatch for a data hazard.
   *
   * So in that one window the screen's state cannot agree with the adapter's
   * clear: the confirm stays up having lost its layer. It is BOUNDED and
   * self-healing — `onConfirmErase` clears `eraseTarget` on both `"ok"` and
   * `"failed"`, so the window is one IndexedDB delete long and ends with the
   * dialog gone either way — and it is UNREACHABLE, because `listInert` covers
   * the Record control that starts this transition.
   *
   * **Exactly how much of that unreachability is asserted, and by what**
   * (Frank R1 P2-1, which found this paragraph claiming more than it had, and
   * citing a case letter that does not exist). Two halves, composed, neither
   * of them a direct observation of the erase-confirm branch in a browser:
   *
   *   - `tests/segments-inert.test.ts` pins the TERM SET of `listInert`,
   *     `eraseConfirmOpen` included, one row per term. That is what stops the
   *     term this decision rests on being deleted with every gate green, which
   *     it could have been while the predicate was four inline `||`s.
   *   - `e2e/back-navigation.spec.ts` case (m) proves the value REACHES the
   *     DOM, in real Chromium, in both states — but through the chapter ≡ menu,
   *     because the erase confirm needs a RECORDED row and this spec has no
   *     microphone.
   *
   * One `listInert` value feeds both `inert` props, so a branch proved to reach
   * the DOM proves the path for every term. That composition is the claim; it
   * is not the same as having watched a Back land on an in-flight erase. That
   * remains review plus device, like every other audio-gated path here.
   *
   * The chapter menu can also decline, through `closeChapterMenuState`'s own
   * share guard, and that is the same story: `listInert` includes
   * `shareOverlayOwnsScreen`, so a share cannot be owning the screen when this
   * runs.
   */
  const dismissOverlays = useCallback(() => {
    const { closeMenu, closeConfirm } = overlayDismissal(
      chapterMenuOpen,
      eraseTarget !== null,
      isErasing()
    );
    if (closeMenu) onCloseChapterMenu();
    // The row menu has no in-flight state of its own, so it is not a row in
    // `overlayDismissal`'s table; it comes down unconditionally, and its own
    // close reports up and unregisters it.
    rowMenuDismiss.current?.();
    if (closeConfirm) closeErase();
  }, [chapterMenuOpen, closeErase, eraseTarget, isErasing, onCloseChapterMenu]);

  useImperativeHandle(ref, () => ({ reload, dismissOverlays }), [
    reload,
    dismissOverlays,
  ]);

  // The overlay's own capture/restore pair (#96/#97, George r2 P2-1, #491):
  // `capture()` runs synchronously in `onPrepareShare`/`onSendShare` below —
  // the opening gesture's own handler, before `<Menu inert={...}>` (below)
  // can apply `inert` in the same render — never from an effect. See
  // `share-progress.tsx`'s docblock for why a passive effect there could
  // never get this ordering right once `inert` is involved.
  const focusRestore = useFocusRestore();
  // Whichever of "Share chapter"/"Preparing…"/"Share now" is CURRENTLY
  // rendered (the ternary below swaps the mounted `Control` as `share.status`
  // moves) — attached to every branch, so it survives that remount and always
  // names a live, non-destructive landmark for `restore()`'s `fallback`: the
  // originally captured trigger can be gone by the time the overlay hides
  // (prepare alone can swap "Share chapter" for "Share now" before the
  // overlay ever shows anything), and Share/Send is the control that owns
  // this flow, never an exiting or destructive one.
  const shareControlRef = useRef<HTMLButtonElement | null>(null);
  // Tap 1 — encode the chapter and arm the send gesture. Free the audio floor
  // first: a clip may be sounding when the menu opens, and the encode has taken
  // over the chapter's PCM. The menu stays open across both gestures, so the
  // header and list stay `inert` (see listInert) for the whole flow — that is
  // what keeps Record, append, and erase out of an in-flight share.
  const onPrepareShare = useCallback(() => {
    focusRestore.capture();
    audio.leave();
    // Arming a share ends the current rename-close session: a rename resolving
    // after this must not close the menu and drop the encode we are preparing.
    chapterMenuSession.current += 1;
    setSavingName(false);
    void share.prepare(
      chapterId,
      strings.shareFilename(bookName, chapterNumber)
    );
  }, [
    focusRestore,
    audio,
    share,
    setSavingName,
    chapterId,
    bookName,
    chapterNumber,
  ]);
  // Tap 2 — hand the armed File to the OS share sheet. `send()` opens the sheet
  // as its first call inside this gesture (`navigator.share` in a browser, the
  // Share plugin in the native shell, whose file tap 1 already wrote to the
  // cache — George R5 P2); the `.then` runs after the sheet settles. Close the
  // menu once the flow is done, but NOT on `retry`
  // (the File is still armed for another tap) or `failed` (the error Notice
  // lives in the menu and must stay visible).
  //
  // `focusRestore.capture()` here is re-entrant-safe even though tap 1 already
  // called it once: by the time `status` is `"ready"` and this control is
  // reachable, the earlier capture has already been consumed by the restore
  // effect below (prepare's own settle drives `progress` back to `hidden`
  // well before a translator can tap again), so this captures the live tap on
  // "Share now" fresh, not a stale one from tap 1.
  //
  // It closes through `onCloseChapterMenu` — the ONE close — rather than
  // `setChapterMenuOpen(false)` on its own, which is what it did before #452
  // PR4. A bare state flip would leave the menu's `Layer` registered over a
  // panel that is gone, and the next Back would spend itself running a
  // now-no-op dismiss instead of leaving the chapter (#494 item 3). Going
  // through the full close also resets the flow and bumps the session, which is
  // what Books' `onSendBookShare` already did and what keeps a spent "ready"
  // from lingering. The close's own share guard cannot refuse here: `send()`
  // resolves only after the outcome glyph has cleared, so the overlay no longer
  // owns the screen by the time this runs.
  const onSendShare = useCallback(() => {
    focusRestore.capture();
    void share.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onCloseChapterMenu();
    });
  }, [focusRestore, share, onCloseChapterMenu]);
  // Hand focus back once `inert` has lifted (`useLayoutEffect`, not
  // `useEffect`: it must run before paint, right after the mutation that
  // clears `inert`). Fires on every render where the overlay is not showing —
  // `restore()` is a safe no-op when nothing is held (`captured: false`).
  useLayoutEffect(() => {
    if (shareOverlayOwnsScreen(share.progress)) return;
    focusRestore.restore({
      suppressed: false,
      fallback: shareControlRef.current,
    });
  }, [share.progress, focusRestore]);
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
      // Flipped SYNCHRONOUSLY, before the write is even started — which is what
      // makes the menu layer's `busy()` honest for a system Back landing in the
      // same task as this tap (invariant 4).
      setSavingName(true);
      void renameChapter(name)
        .then((ok) => {
          if (ok && chapterMenuSession.current === session)
            onCloseChapterMenu();
        })
        .finally(() => {
          // Guarded like the close above: a stale settle from a session this
          // screen has already moved past must not touch state a newer
          // session (a reopen, or an armed share) now owns.
          if (chapterMenuSession.current === session) setSavingName(false);
        });
    },
    [renameChapter, setSavingName, onCloseChapterMenu]
  );
  // Abandon the rename (Cancel, Escape) and return to the action list. Bumps
  // the session and clears `savingChapterName` like every other exit from
  // this rename does (George R1 P2, #384): without it, a rename cancelled
  // while still saving left BOTH a late resolution free to close the menu the
  // user had already backed out of, AND a stale `savingChapterName` that
  // showed the NEXT Rename tap's fresh Confirm as busy before it was tapped.
  const onCancelRenameChapter = useCallback(() => {
    chapterMenuSession.current += 1;
    setRenamingChapter(false);
    setSavingName(false);
  }, [setSavingName]);
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
      // Both real outcomes take the confirm down, so both take its layer down
      // (#494 item 3 — a layer whose overlay is gone traps Back at this depth).
      // `"busy"` returns without touching either: the first erase still owns
      // them, and its own settle is what closes them.
      if (result !== "busy") closeErase();
    })();
  }, [audio, closeErase, erase, eraseTarget, eraseRow]);
  // The list is hidden from AT while a dialog is up, mirroring the recorder
  // sheet (G8: aria-modal alone is not trusted to hide the background). The
  // share overlay joins the list (George r1 P2 #1/#2, #491): a screen
  // reader's own gesture navigation does not dispatch the `Tab` keydowns
  // `<ShareProgress>` intercepts, so `inert` is what keeps THAT path off the
  // header/list while the overlay is up — including through the outcome
  // hold, after `chapterMenuOpen` itself may already have gone false.
  //
  // The decision moved out to `segments-inert.ts` in #452 PR4 (Frank R1 P2-1):
  // it is what Amendment C's decision (b) rests on, and inline here it had no
  // Node-testable surface, so the one term the erase-in-flight call actually
  // turns on — `eraseConfirmOpen` — could have been deleted with every gate
  // green. That file's docblock has the full accounting of what its table
  // proves and what it does not.
  //
  // The share half stays the RENDERED mirror (`share.progress`), not the live
  // `shareOwnsScreen()`: this is a rendering decision, where last commit's
  // value is the right one. Only the `popstate`-reachable close and `busy()`
  // must read live.
  const listInert = segmentsListInert({
    eraseConfirmOpen: eraseTarget !== null,
    rowMenuOpen,
    chapterMenuOpen,
    shareOwnsScreen: shareOverlayOwnsScreen(share.progress),
  });

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
  const showEmpty = !staleTarget && loaded && rows.length === 0;

  // Share (B7) speaks inside its own menu, not the screen Notice: the two-gesture
  // flow keeps the ≡ menu open across prepare → ready → send, so the panel is
  // what the translator is looking at. Its error code is mapped to copy here and
  // rendered in the menu below.
  // The Share Control's glyph/variant/busy across idle → preparing → ready
  // (#354) — the same table Share Book and NameEdit's Confirm use. Its idle
  // mark is the platform's own (#490): read from the Capacitor runtime each
  // render — a constant, cheap read — never from the user agent.
  const shareAffordance = shareControlAffordance(
    share.status,
    readSharePlatform(),
    share.sendUnconfirmed
  );
  const shareErrorText = shareErrorCopy(share.error, "chapter");
  // Hoisted: the same mark for a chapter and a book, from one table.
  const sharePartial = shareOutcomeGlyph("partial");
  // Mark and tone for the error line, from the same table (#178); `undefined`
  // for `encoder` and for no error, which is `Notice`'s own default.
  const shareErrorMark = shareErrorGlyph(share.error);

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
        {/* A control-sized hit area, not a ~20px text run (#164 R-10): its
            action is Back, the same as the 44px control beside it, and two
            adjacent ways to do one thing should not be two different sizes to
            a thumb. Geometry lives in `.breadcrumb` (layer 3) rather than in
            arbitrary utilities here, so the 44px floor reads the same
            `--c-control-md` every other control does. */}
        <button type="button" onClick={onBack} className="breadcrumb">
          <span>
            {bookName} &gt; {chapterHeading}
          </span>
        </button>
        {!showEmpty && (
          <Control
            icon="plus"
            label={strings.addSegment}
            variant="quiet"
            disabled={staleTarget || loading || refreshing || loadFailed}
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
          disabled={staleTarget || loading || refreshing || loadFailed}
          onClick={openChapterMenu}
        />
      </header>

      {/* One line, one place: a load failure or a playback failure (a
          dangling/undecodable clip routes to audio.error) — never only the
          console. `console.error is not a channel on a phone in a village.`
          Share speaks in its own menu, not here. */}
      {staleTarget ? (
        <Notice>{strings.staleChapter}</Notice>
      ) : (error ??
        audio.error ??
        (erase.error ? strings.eraseFailed : null)) ? (
        <Notice>{error ?? audio.error ?? strings.eraseFailed}</Notice>
      ) : loading ? (
        // First mount: a slow chapter (sequential PCM walk) is otherwise a
        // header over a blank list with no reason given (G8).
        <Notice tone="busy">{strings.loadingChapter}</Notice>
      ) : (
        refreshing && <Notice tone="busy">{strings.updating}</Notice>
      )}

      <div className="flex-1 overflow-y-auto" inert={listInert || undefined}>
        {staleTarget ? null : showEmpty ? (
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
                  ranOut={audio.playbackRanOut}
                  busy={refreshing}
                  onPlay={(offsetSeconds) => audio.playTake(row, offsetSeconds)}
                  onOpenRecorder={() =>
                    onOpenRecorder(row.segmentId, row.ordinal)
                  }
                  onSetFinished={(finished) =>
                    onSetFinished(row.segmentId, finished)
                  }
                  onErase={() => armErase(row.segmentId)}
                  onMenuOpen={onRowMenuOpen}
                  onMenuClose={onRowMenuClose}
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
        // The RENDER mirror, deliberately: this paints the Confirm's busy state,
        // and a painted control may only ever show a committed value. The layer's
        // `busy()` reads the live ref instead (`isErasing`) — see the behaviour
        // record above.
        busy={erase.erasing}
        onConfirm={onConfirmErase}
        // Stable identity: a fresh lambda each render would, together with the
        // 60 ms playback tick, thrash EraseConfirm's focus effect (George R-B6).
        // `closeErase` is a `useCallback` over `closeEraseState` plus the
        // memoized `layers`, so it still is one.
        onCancel={closeErase}
      />

      <Menu
        // Re-enter Menu's open focus behavior when stale contents replace a
        // focused rename field. Only Close remains; the screen keeps its layer
        // until the translator dismisses it and explicitly goes Back (#378).
        key={staleTarget ? "stale" : "live"}
        open={chapterMenuOpen}
        onClose={onCloseChapterMenu}
        title={strings.chapterMenuTitle}
        // The class-level isolation primitive (#491, the DRI's option-A pick
        // on the judgment sheet): while the overlay owns the screen, the
        // WHOLE panel below — Rename, Share/Send, Close, the rename field —
        // goes `inert` as one subtree, rather than each control carrying its
        // own `shareOverlayOwnsScreen` guard. See `menu.tsx`'s own docblock
        // on the prop for why this replaced four rounds of per-handler
        // patches, the last of which (Frank at `ec2a148`) found Share/Send
        // themselves still unguarded.
        inert={shareOverlayOwnsScreen(share.progress)}
        // The live region moves here, OUTSIDE the inert subtree above but
        // still inside this panel's `aria-modal` boundary — see `menu.tsx`'s
        // `liveRegion` docblock for why it cannot live inside `children`
        // any more, and why `<ShareProgress>`'s own sibling portal still
        // cannot carry it (George r1 P2 #3).
        //
        // Mounted for the WHOLE overlay, busy included — not `phase ===
        // "outcome"` alone (George r3 P2-1, #491): the in-menu `tone="busy"`
        // Notice that used to be the busy-phase AT announcement is now
        // `children`, so it goes `inert` for the entire encode, and a book
        // share's encode is not short. `shareOverlayOwnsScreen` is exactly
        // `phase !== "hidden"`, so this covers busy and outcome alike, and
        // `shareProgressText` already has copy for both (`share-error-copy
        // .ts`) — busy said nothing here only because nobody asked it to.
        liveRegion={
          shareOverlayOwnsScreen(share.progress) && (
            <span className="sr-only" role="status" aria-live="polite">
              {shareProgressText(share.progress, "chapter")}
            </span>
          )
        }
      >
        {staleTarget ? (
          <Notice>{strings.staleChapter}</Notice>
        ) : renamingChapter ? (
          <>
            {/* Rename the chapter in place (#264). Seeded with the current
                custom label, or empty when it is still the default "Chapter N"
                — so the facilitator types the passage rather than editing a
                placeholder. */}
            <NameEdit
              initialValue={chapterName ?? ""}
              fieldLabel={strings.chapterNameField}
              onSave={onSaveChapterName}
              onCancel={onCancelRenameChapter}
              busy={savingChapterName}
            />
            {/* Announced regardless of where focus sits — Enter leaves it on
                the field, not Confirm (George R1 P2, #384). Mirrors Share's
                own `tone="busy"` Notice for the same reason: Confirm's own
                busy mark only reaches a screen reader focused ON it. */}
            {savingChapterName && (
              <Notice tone="busy">{strings.savingName}</Notice>
            )}
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
              // No `shareOverlayOwnsScreen` guard here any more (#491): this
              // control sits inside the panel's `inert` subtree above (see
              // `<Menu>`'s own `inert` prop), so it is unreachable by click,
              // keyboard or AT activation for the whole time the guard used
              // to check — the primitive covers it now, not a per-handler
              // check.
              onClick={() => setRenamingChapter(true)}
            />
            {/* Two gestures, same spot: "Share chapter" encodes (tap 1); once
                armed it becomes a primary "Share now" that hands the File to the
                sheet in a fresh activation (tap 2). autoFocus moves focus onto it
                as it appears, since the Menu only lands focus on its open edge. */}
            {share.status === "ready" ? (
              <Control
                ref={shareControlRef}
                icon={shareAffordance.icon}
                label={strings.shareSend}
                variant={shareAffordance.variant}
                className={shareAffordance.className}
                autoFocus
                onClick={onSendShare}
              />
            ) : (
              // Stays enabled while `preparing`: a re-tap is already a no-op via
              // the hook's `preparingRef`, and disabling it would drop this
              // control out of Menu's `FOCUSABLE` set (which excludes
              // `[disabled]`), breaking the Tab trap and letting focus escape the
              // portal (George R-B7). `busy` (not disabled) is what now paints
              // and reads that wait state (#354; `control-affordance.ts`).
              <Control
                ref={shareControlRef}
                icon={shareAffordance.icon}
                label={
                  share.status === "preparing"
                    ? strings.sharePreparing
                    : share.sendUnconfirmed
                      ? strings.shareChapterUnconfirmed
                      : strings.shareChapter
                }
                variant={shareAffordance.variant}
                busy={shareAffordance.busy}
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
              // Its own mark, not `info`'s generic ring-and-i (#178): that
              // glyph also carries storage durability (#214/#406), so share
              // would otherwise share a shape with an unrelated condition.
              <Notice tone={sharePartial.tone} icon={sharePartial.icon}>
                {shareGapText(
                  { missing: share.missing, partial: 0 },
                  "chapter"
                )}
              </Notice>
            )}
            {shareErrorText && (
              // `nothing` and `failed` both wear the `alert` tone — that split
              // is #147's open question — so the mark is the only thing
              // separating "record a segment first" from "try again" (#178).
              // The tone comes from the same table as the mark, so a #147
              // re-tone reaches this line without a second edit (George R3 P3).
              <Notice tone={shareErrorMark?.tone} icon={shareErrorMark?.icon}>
                {shareErrorText}
              </Notice>
            )}
          </>
        )}
      </Menu>

      {/* The share modal (#491): the busy hold and the outcome glyph, over the
          menu. A sibling of the Menu, not a child, so it survives the menu
          closing — `send()` resolves only after the flash, so the close above
          lands after the glyph, not under it. `onCancel` is wired to
          `share.reset` directly, not `onCloseChapterMenu` (George r1 P2
          #1/#2): that close now refuses to run at all while this overlay is
          up, so the busy-phase cancel — still needed for a long encode, and
          a no-op during send since `reset()` itself already refuses then —
          has to go through the flow's own reset rather than the menu's. */}
      <ShareProgress
        progress={share.progress}
        scope="chapter"
        onCancel={share.reset}
        onDismiss={share.dismissProgress}
      />
    </div>
  );
});
