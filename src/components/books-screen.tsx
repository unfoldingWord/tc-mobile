import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { AboutPanel } from "./about-panel";
import type { LicenseText } from "./licenses";
import { Control } from "./control";
import { EMPTY_STATE_NODE, focusTargetAfterDelete } from "./delete-focus";
import { EmptyState } from "./empty-state";
import { guidedStep } from "./guided-step";
import { FailureLogPanel } from "./failure-log-panel";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { O4BookDeleteAsk } from "./o4-book-delete-ask";
import { CoverPicker } from "./cover-picker";
import { CoverTile, O4BookHead, O4CoverPick } from "./o4-book-menu";
import { Tile, TileGrid, TileSpacer } from "./o4-tile-menu";
import { Notice } from "./notice";
import { SquareButton } from "./o4-controls";
import { encoderNotice } from "./encoder-notice";
import { shareGapText, shareProgressText } from "./share-error-copy";
import { ShareMenuSection } from "./share-menu-section";
import { bookShareItems } from "./share-o4-view";
import { ShareProgress } from "./share-progress";
import { StoragePressureBanner } from "./storage-pressure-banner";
import { storagePressureNotice } from "./storage-pressure-notice";
import { shelfNoticeText } from "./shelf-notice-text";
import { strings } from "@/lib/strings";
import { ThemeControl } from "./theme-control";
import { useFailureCount, useMarkedFailureCount } from "@/hooks/failure-log";
import { encoderHealth, subscribeToEncoderHealth } from "@/hooks/mp3-codec";
import type { FailureKey } from "@/hooks/save-failure";
import { shareOverlayOwnsScreen } from "@/hooks/share-progress";
import { useBookCoverColour } from "@/hooks/use-book-cover-colour";
import { useBookShare } from "@/hooks/use-book-share";
import { useBooks } from "@/hooks/use-books";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import {
  useLibraryShare,
  type UseLibraryShare,
} from "@/hooks/use-library-share";
import { useReorderGesture } from "@/hooks/use-reorder-gesture";
import { useScrollToNew } from "@/hooks/use-scroll-to-new";
import {
  useScreenLayers,
  type ScreenLayerBehavior,
} from "@/hooks/use-screen-layers";
import { useStoragePersistence } from "@/hooks/use-storage-persistence";
import { useStoragePressure } from "@/hooks/use-storage-pressure";
import {
  coverColourHex,
  resolveCoverKey,
  type CoverColourKey,
} from "@/lib/cover-colour";
import type { Layer } from "@/lib/nav/layer-stack";
import { nextChapterNumber } from "@/lib/storage/books";
import { cn } from "@/lib/utils";
import { hasReclaimableAudio } from "@/lib/view/book-rows";
import { reorderShift } from "@/lib/view/reorder-gesture";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow, SegmentRowState } from "@/types/view";

/**
 * Every overlay this screen can put over the shelf, as a system-Back layer
 * (#452 PR3, #374). The union is what makes `useScreenLayers`' behaviour
 * record total — a row added here with no behaviour, or a behaviour for an id
 * that no longer exists, is a `tsc` error rather than a Back that silently
 * does nothing.
 *
 * The design's "PR3 — Books' overlays" listed five; `books:new-chapter` is the
 * sixth, added with the Add-chapter prompt (#609) for the same reason
 * `books:new-book` exists — a naming dialog Back must close rather than walk
 * out of the app from. The book ⋮ menu and its rename mode remain ONE overlay:
 * rename is a mode inside the same panel, so it opens no second layer and Back
 * from the rename field closes the menu, just as the panel's own Close does.
 *
 * `books:log-clear-confirm` is the one the design's overlay catalogue does not
 * list: `FailureLogPanel`'s Clear confirm (#205) portals OVER the global menu
 * rather than replacing it, so it is a genuine second layer. Left unregistered,
 * a Back with it up would have dismissed the global menu UNDERNEATH it and left
 * the confirm standing over nothing.
 *
 * Book share's `<ShareProgress>` (#491) is NOT itself a layer. It goes up and
 * comes down on the share flow's own timeline (a minimum hold, then an outcome
 * hold) rather than on any click, so registering it would mean popping a layer
 * from a timer — an effect, which invariant 6 forbids REGISTERING (never
 * closing — see `books:library-share` below and the delete-confirm auto-close
 * further down this file). It is folded into the book ⋮ menu's `busy()`
 * instead, which is what Amendment D asks for and is also exactly right: the
 * overlay's whole lifetime is the window in which that menu's own close is a
 * no-op (`onCloseShareMenu`'s early return), so Back must refuse rather than
 * run a `dismiss()` that does nothing.
 *
 * `books:library-share` (#1045/#1056) is the one exception that IS a layer.
 * Share your work has no enclosing menu to fold `ownsScreen()`'s busy check
 * into — the O4 storage banner's button sits directly on the shelf, not
 * behind a ⋮ — so there is nothing else to guard Back with while its own
 * `<ShareProgress>` owns the screen (DRI, 2026-09-26: "Refuse, like Book share
 * (Recommended)"). It is opened from the SAME tap that starts `prepare()`/
 * `send()` (`books-screen.tsx`'s wrapping of `libraryShare` before it reaches
 * the banner), same as every other layer here — and, because the timeline
 * still comes down on its own for a successful prepare (the "ready" settle)
 * and for an outcome's auto-clear, with no tap to close it, it is ALSO closed
 * by an effect once `shareOverlayOwnsScreen(libraryShare.progress)` goes
 * false. That is invariant 6's permitted half: an effect may close a
 * registered layer whose overlay is already gone (the delete-confirm case
 * below is the same shape), it may just never be what opens one.
 */
type BooksLayerId =
  | "books:global-menu"
  | "books:log-clear-confirm"
  | "books:library-share"
  | "books:new-book"
  | "books:new-chapter"
  | "books:book-menu"
  | "books:delete-confirm"
  | "books:about"
  | "books:about-text";

interface BooksScreenProps {
  /** Open a chapter's Segments screen. Owned by App (slice 4) for navigation. */
  onOpenChapter: (chapterId: ChapterId) => void;
  /** Register an open overlay as a Back layer. `useNavStack`'s, through App. */
  pushLayer: (layer: Layer) => void;
  /** Unregister one by id. Idempotent. */
  popLayer: (id: string) => void;
}

/**
 * B2 — the Books screen, and the app's home (G2).
 *
 * The whole bar is two icons: New Book and the menu. Everything else is the
 * book/chapter tree. Books are collapsed by default (F1) so a long shelf stays
 * short; a book the translator just made opens expanded and scrolls into view,
 * because the next thing they do is add a chapter to it.
 */
export function BooksScreen({
  onOpenChapter,
  pushLayer,
  popLayer,
}: BooksScreenProps) {
  const {
    books,
    newBookNumber,
    loading,
    loaded,
    error,
    reload,
    createBook,
    addChapter,
    renameBook,
    deleteBook,
    deleting,
    isDeleting,
    deleteFailed,
    moveChapter,
    moveBook,
  } = useBooks();
  // A first-mount shelf-read failure leaves `books` at [] with `error` set —
  // indistinguishable from a genuinely empty shelf unless we say so. Reading it
  // as empty would show "start a book" and a live New Book over a shelf that
  // may hold books merely unavailable, inviting new data on top (Frank r8, the
  // Books sibling of the Segments load-failure guard). The Notice is the
  // recovery; the menu stays reachable.
  //
  // `loaded` (from the hook) latches on the first successful read, so this
  // guards a failed *read* only — which is now all `error` carries for the
  // create path: since #314 a failed create returns its reason to the dialog
  // instead of writing this shared channel, so it can no longer tear the
  // known-empty shelf's invite down or strand focus (the shape George R3 P2
  // asked for, now structural rather than conditional).
  const loadFailed = error !== null && !loaded;
  // The empty state carries its own present primary CTA, so the header create
  // control would be a second, equal "New book" — two CTAs read as none
  // (ui-craft §21), and a screen reader would announce it twice. Hide the
  // corner + exactly while the invite is up; it returns once the shelf fills.
  const showEmpty = loaded && books.length === 0;
  // The shelf holds at least one book. Used by `useStoragePersistence` below
  // only — `storagePressureNotice`'s gate used to share this too (#542 round
  // 1, George P2-2) but now uses the stronger `hasReclaimableAudio` below
  // (#542 Part B, DRI decision 2026-09-24): a book can exist with nothing
  // recorded in it, which `hasContent` alone could not distinguish.
  const hasContent = loaded && books.length > 0;
  // Durable storage (#12). A book exists only because a write committed, so a
  // successful shelf read that finds one is "after the first successful write"
  // reached from the read side — the trigger the hook's docblock explains. The
  // marker is non-null only when the browser explicitly said it has NOT
  // promised to keep this data, THIS render still has a book on the shelf (a
  // delete back to empty must not leave a stale warning up, George R1 P2-1),
  // and the app is not the Capacitor training shell (native storage is not
  // evicted the same way; `lib/storage/persistence.ts`). Unknown (no API, a
  // rejected query) says nothing.
  const storage = useStoragePersistence(hasContent);
  // At least one segment, anywhere on the shelf, holds a recorded take
  // (#542 Part B). `recordedCount` is already in `books` — `useBooks`
  // computes it per chapter from the same `getSegmentsOfChapter` read that
  // fills `finishedCount`/`totalCount` — so this is a plain fold over data
  // already in memory, not a new read. `loaded &&` matches `hasContent`'s own
  // guard: `books` is `[]` before the first load lands either way, so this is
  // for clarity rather than to change the answer.
  const reclaimableAudio = loaded && hasReclaimableAudio(books);
  // Storage pressure (#247, wiring half of #537's core). Unlike `storage`
  // above, `useStoragePressure` itself is NOT gated on a loaded shelf — the
  // device can be full before this app has read anything
  // (`use-storage-pressure.ts`'s CONTRACT note) — so `storagePressureNotice`
  // takes `hasReclaimableAudio` and `deleteFailed` as its own gate, rather
  // than folding either into the hook the way `storage` above does. See that
  // function's docblock for why the gate lives there now and not as JSX `&&`
  // (#542, Frank P2-2 / George P3-5), why it is `hasReclaimableAudio` and not
  // `hasContent` (#542 Part B), why `deleteFailed` and not the wider
  // `noticeText` below (#542, George P2-4), and why `loading`/`loadFailed`
  // are not passed here (#843 item 4: unreachable in combination with
  // `hasReclaimableAudio: true` from this call site).
  const pressureLine = storagePressureNotice(useStoragePressure(), {
    hasReclaimableAudio: reclaimableAudio,
    deleteFailed,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  // About & licenses (#36), opened from the global menu. Kept separate from
  // `menuOpen` so the two-level surface (menu → About panel) composes: opening
  // About closes the menu, and the About panel owns its own Menu.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutViewing, setAboutViewing] = useState<LicenseText | null>(null);
  // The durable failure log's size (#205). Books is home, and the global menu is
  // the only surface reachable from every state this screen can be in — a failed
  // shelf read included, which is precisely when a facilitator needs the report.
  // Kept current as failures land, so a rejection that happens while the shelf
  // is open marks the control without a reload.
  //
  // The token is the shelf's Try again, forwarded (George R1 P2, takeover). The
  // count's own read has a retry ladder that eventually gives up and waits for
  // the app to be backgrounded — but the recovery this screen OFFERS is a
  // button, and the blocked-database copy tells the user to close the other copy
  // and then press it. Without the forward, a user who does exactly that gets
  // the shelf back and a log that stays invisible, because the ≡ mark and the
  // panel are both gated on this number. `reload()` is called with it, never
  // instead of it.
  const [failureRetryToken, setFailureRetryToken] = useState(0);
  const failureCount = useFailureCount(failureRetryToken);
  // The rows that mark ≡: every row except informational ones, today only a
  // take sealed at the 20-minute cap (#1005; DRI on #1076, verbatim: "Log it,
  // don't light ≡ (Recommended)"). The panel below still keys on
  // `failureCount`, so a log holding only that row can still be sent.
  const markedFailureCount = useMarkedFailureCount();
  // Both halves of Try again, in one handler so a later edit cannot drop one:
  // re-read the shelf, and hand the failure count's ladder back.
  const onRetryShelf = useCallback(() => {
    setFailureRetryToken((t) => t + 1);
    reload();
  }, [reload]);
  // The New Book dialog (#314). `null` is closed; a string is open, and IS the
  // value the name field is seeded with — the placeholder rendered from the
  // slot the hook derives off the loaded shelf. Held as the seed rather than a
  // boolean so the
  // field's starting text and the dialog's open state cannot disagree, so each
  // open remounts `NameEdit` with a fresh seed (Menu unmounts its children when
  // closed, which is what resets a half-typed name), and so Confirm can tell an
  // untouched field from a typed one.
  const [newBookSeed, setNewBookSeed] = useState<string | null>(null);
  // The cover colour tapped in the New Book sheet (#1190); `null` is the
  // default, an id-derived colour, exactly what a create without a pick has
  // always written. Reset on every open and every dismissal, with the seed.
  const [newBookColour, setNewBookColour] = useState<CoverColourKey | null>(
    null
  );
  // A failed create, scoped to THIS dialog. Not the hook's shared `error`: that
  // channel also carries an addChapter or rename failure, which would then be
  // announced (Notice is `role="alert"`) inside a New Book dialog that has not
  // failed at anything — on the one-tap create path, to someone who may not read
  // the words disowning it (Frank R1 P3, George R1 P2-2).
  const [newBookError, setNewBookError] = useState<FailureKey | null>(null);
  // The in-flight latch. It stops a second Confirm, and it is what
  // `onCancelNewBook` checks: once the write is committing, dismissal is a no-op
  // rather than a promise the store cannot keep.
  //
  // Its LIFETIME is the point, and it is EraseConfirm's, not a `finally`: set
  // synchronously on Confirm, released on a FAILED create (the dialog stays up,
  // so Retry and Cancel must work again) and otherwise held until the next open
  // edge resets it. Dropping it the moment the write resolves would leave a gap
  // — the panel is still mounted until React paints the close — in which a held
  // Enter or a double-tap straddling a fast `put` starts a second create and
  // writes a second book (George R2 P2-2). A book, unlike a chapter, CAN be
  // deleted (#337) — but only by hand, through its own confirm; nothing here
  // recovers from a slipped-through extra create for free (George R7 P3-1).
  const creatingBook = useRef(false);
  // The visual half of the same latch. `creatingBook` is deliberately a ref —
  // reading it does not re-render — but that also meant Confirm never showed
  // busy: nothing on screen changed for the length of the write, so Close,
  // Escape and the scrim still LOOKED live even though `onCancelNewBook`
  // already turned them into no-ops (George R3/R4 P3). State, synced wherever
  // the ref is, purely so `NameEdit`'s save Control can render its OWN `busy`
  // — not `disabled`, which would drop the focused control out of the tab
  // order mid-commit and strand a keyboard/switch user in the still-open
  // dialog (Frank R4 P2; see `name-edit.tsx`'s `busy` prop doc).
  const [creatingBookBusy, setCreatingBookBusy] = useState(false);
  // Where focus was when the New Book dialog opened — the corner + or the empty
  // state's CTA. Restored when the dialog closes WITHOUT creating, so a cancel
  // does not drop focus to the document (the dialog's own controls unmount).
  // Cleared on a successful create, where the row hand-off takes over instead.
  const newBookReturnFocus = useRef<HTMLElement | null>(null);
  // The Add-chapter prompt (#609). `null` is closed; an open prompt carries
  // BOTH the book it will add to and the "Chapter N" the field is seeded with,
  // in one value, for the same reason `newBookSeed` holds the seed rather than
  // a boolean: the field's starting text and the dialog's open state cannot
  // disagree, each open remounts `NameEdit` with a fresh seed, and Confirm can
  // tell an untouched field from a typed one.
  const [newChapter, setNewChapter] = useState<{
    readonly bookId: BookId;
    readonly seed: string;
  } | null>(null);
  // The in-flight latch and its visual half — `creatingBook`/`creatingBookBusy`
  // above, one prompt down. Same lifetime: set on Confirm, reset on the next
  // open edge, never in a `finally`, so the window between the write resolving
  // and the panel unmounting cannot take a second Confirm.
  const creatingChapter = useRef(false);
  const [creatingChapterBusy, setCreatingChapterBusy] = useState(false);
  // Where focus was when the prompt opened — the row's `+`. Restored when the
  // prompt is cancelled, so focus does not drop to the document. A failed
  // create targets the book toggle; success uses the row hand-off instead.
  // Exactly New Book's split, and for a reason this prompt shares: returning
  // focus to the `+` after a create leaves a live control that reopens this
  // panel under the key that just confirmed it, and `NameEdit` autofocuses, so
  // the NEXT repeat submits — the pre-#609 held-Enter loop with one more
  // keystroke per turn rather than none, still writing chapters this tree
  // cannot delete. It also undid the armed scroll that had just brought the
  // new row into view, by focusing the row above it.
  const newChapterReturnFocus = useRef<HTMLElement | null>(null);
  // Share Book (B7): the per-book ⋮ menu. Which book's menu is open, and one
  // share flow for the screen — only one menu is open at a time (its scrim blocks
  // reaching a second row's trigger), so a single flow is enough. `shareMenuBook`
  // resolves the id back to a row, auto-closing the menu if that book vanishes.
  const [shareMenuBookId, setShareMenuBookId] = useState<BookId | null>(null);
  // Whether the open book ⋮ menu is in rename mode (the name field showing) or
  // its action list. Resets to the action list every time the menu closes.
  const [renamingBook, setRenamingBook] = useState(false);
  // #949, #937 D7: whether the open book sheet shows #957's cover
  // picker in place of its tiles. A mode of the same sheet, as rename is, so
  // it opens no layer of its own, and it resets every time the sheet closes.
  const [pickingCover, setPickingCover] = useState(false);
  // A failed cover write, scoped to the picker: the screen's Notice sits
  // behind the sheet's scrim, as rename's does.
  const [coverFailed, setCoverFailed] = useState<FailureKey | null>(null);
  // The rename write is in flight (#383) — forwarded to NameEdit's Confirm as
  // `busy`. Reset to `false` at every site that bumps `bookMenuSession` (open,
  // close, arm-a-share) as well as on settle: a still-pending rename for book
  // A left this `true` across a menu close, so opening book B's ⋮ showed B's
  // FRESH Confirm as busy before B's own Save was ever tapped (Frank r1,
  // #384) — a session-token comparison would fix it too, but reading
  // `bookMenuSession.current` (a ref) during render to compare against is
  // banned (`react-hooks/refs`), so the reset instead happens at each place
  // that already advances the session.
  const [savingBookName, setSavingBookName] = useState(false);
  // The same flag as a live ref (#452 PR3, the design's F4). `savingBookName`
  // above is last render's answer and drives NameEdit's `busy`; this is what
  // the book-⋮ menu's `Layer.busy()` reads, because the system-Back handler
  // calls it from a `popstate` with no render in between (invariant 4).
  const savingBookNameRef = useRef(false);
  // The two always move together, through one setter, so the Confirm a
  // translator can see and the Back the system sends can never disagree about
  // whether a rename is in flight. Every site that touched `setSavingBookName`
  // calls this instead.
  const setSavingName = useCallback((value: boolean) => {
    savingBookNameRef.current = value;
    setSavingBookName(value);
  }, []);
  // Which book the Delete confirm is armed for (#337), held apart from
  // `shareMenuBookId` because tapping Delete closes the ⋮ menu — mirroring the
  // Segments row menu, where Erase closes the row menu and the screen holds the
  // target. `null` means no confirm is up.
  const [deleteTargetId, setDeleteTargetId] = useState<BookId | null>(null);
  // A monotonic token for the current book-menu session. It advances whenever the
  // menu closes, switches to another book, or arms a share — every transition
  // after which a late-resolving rename must NOT run its close, or it would drop
  // a different menu's state or a prepared encode (F1). onSaveBookName captures
  // the token and closes only if it still matches. A ref, read at resolution
  // time, so it sees the live value, not the one closed over at save.
  const bookMenuSession = useRef(0);
  const bookShare = useBookShare();
  // Share your work (#987), from the O4 storage banner. Held here, not in the
  // banner, so its overlay and the shelf's `inert` follow the timeline in the
  // same render (#1045). Idle unless that banner's button starts it.
  const libraryShare = useLibraryShare();
  // Per-viewer UI state, so it lives here and not on disk. Collapsed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<BookId>>(new Set());
  // The row registry and the arm-then-reveal pair, shared with Segments (#160
  // L-15). Refs inside, not state: creating a book or chapter patches `books`
  // directly (no `reload()` needed — see `useBooks.createBook`/`addChapter`,
  // George R4 P2-2), so the change already re-renders us and an arm does not
  // have to. The empty-state CTA unmounts on the create it triggers, so without
  // the focus half focus falls to the document and the first header stop takes
  // over — on a chapter that would be Back, one activation from leaving.
  //
  // The selector is the row's first `<button>`, and it is a DELIBERATE step
  // back from an earlier round. For a BOOK id (New Book) that is the
  // expand/collapse toggle; for a CHAPTER id (#609's Add-chapter prompt) it is
  // that row's only button, "Open Chapter N". Both satisfy the rule: a stray
  // re-activation writes nothing — one re-collapses a row, the other navigates
  // into the chapter, which one Back undoes. Targeting `.control` instead put a
  // live, activating native button under focus as the direct continuation of
  // Confirm's own Enter — and a still-held Enter key-repeats `click` on
  // whatever is focused, so a facilitator holding Enter through Confirm wrote
  // MULTIPLE undeletable chapters before the per-book latch could catch up (the
  // latch only stops OVERLAPPING calls; it releases the instant each write
  // resolves, and a `put` is typically faster than OS key-repeat — George R4
  // P2-1). Add-chapter is the more useful landing, one Tab further on; it is
  // not the safe one.
  const rowReveal = useScrollToNew<string>("button");

  // ── System Back: this screen's overlays as layers (#452 PR3, #374) ────────
  //
  // Each overlay has a STATE half here — everything it takes to close the
  // overlay itself — and, further down, a full close that also unregisters its
  // layer. The split is App.tsx's own (`openChapterState` vs `openChapter`),
  // and here it also buys something specific: every behaviour in the record
  // below refers only to things already declared. A forward reference makes
  // the React Compiler bail on this whole component, and a bail-out silently
  // takes `react-hooks`' own analysis down with it — the failure mode #212
  // already cost this repo once, invisibly. `npm run lint` does catch this one
  // (`preserve-manual-memoization`), which is how it was found; the ordering
  // is kept deliberate rather than accidental.
  //
  // A `dismiss()` is the STATE half on purpose: the adapter unregisters the
  // layer itself immediately after calling it (`use-nav-stack.ts`'s
  // `"rearm-layer-dismiss"` → `popLayer(top.id)`, #494 item 3), so a `dismiss`
  // that unregistered too would be saying it twice — and would need `layers`,
  // which is the forward reference this ordering exists to avoid.
  //
  // `busy()` must be true whenever `dismiss()` would be a no-op. Otherwise a
  // Back runs a dismissal that changes nothing, and the adapter still
  // unregisters the layer — which empties the floor's stack, so
  // `rearmAfterLayerBack` declines to put the consumed entry back. The overlay
  // is left on screen with nothing protecting it, and the next Back walks out
  // of the app (#494 item 3).
  // Each row pairs the two deliberately; the pairing is noted where it is not
  // obvious.

  /**
   * `FailureLogPanel`'s Clear confirm, which owns its own state and so supplies
   * its own behaviour when it opens. `null` while that confirm is down — which
   * includes whenever the global menu is closed, since the panel unmounts with
   * it.
   */
  const logClearBehavior = useRef<ScreenLayerBehavior | null>(null);

  const closeGlobalMenuState = useCallback(() => {
    setMenuOpen(false);
    logClearBehavior.current = null;
  }, []);

  /**
   * Cancel, Escape, the panel's Close, a scrim tap, a system Back: all the same
   * outcome — nothing is created, and focus goes back where it came from.
   *
   * Returns `false` when the dialog is HELD mid-create, so the caller keeps its
   * layer registered. Mid-create, dismissal does nothing: the IndexedDB write
   * cannot be recalled once Confirm has run, so tearing the dialog down here
   * would make "Cancel creates nothing" false AND let the create's continuation
   * expand and steal focus for a book the closing gesture disowned (Frank R1 P2
   * / George R1 P2-4, both lenses). Holding the panel for the length of one
   * `put` is the same "in-flight owns the panel" rule EraseConfirm applies to
   * its own committing action — and the layer's `busy()` reads the SAME ref, so
   * a system Back never reaches this early return at all.
   */
  const cancelNewBookState = useCallback(() => {
    if (creatingBook.current) return false;
    setNewBookSeed(null);
    setNewBookColour(null);
    setNewBookError(null);
    return true;
  }, []);

  /**
   * The Add-chapter prompt's state half. Same contract as
   * `cancelNewBookState`: nothing is created, and `false` means the prompt is
   * HELD mid-create so the caller keeps its layer registered. A chapter cannot
   * be deleted at all on this tree, so letting a dismissal through mid-write
   * would be worse here than for a book — the layer's `busy()` reads the same
   * ref, so a system Back never reaches this early return.
   */
  const cancelNewChapterState = useCallback(() => {
    if (creatingChapter.current) return false;
    setNewChapter(null);
    return true;
  }, []);

  /**
   * Closing the book ⋮ menu (scrim, Escape, close button, a system Back) ends
   * the flow: drop any armed File so a stale "ready" cannot linger behind a
   * closed menu (mirrors Segments).
   *
   * Returns `false` while the share overlay owns the screen, where this is a
   * no-op. That guard is KEPT deliberately (#491, the DRI's option-A pick):
   * every OTHER guard this menu's controls carried was removed once `<Menu>`'s
   * own `inert` prop started covering them — this one is not, because `inert`
   * only reaches the DOM subtree it is applied to, and this function is still
   * reachable from THREE places outside that subtree while the overlay is up:
   * Menu's own `window` Escape listener (`menu.tsx`'s `onKeyDown`), its scrim
   * `onClick`, and now the system Back gesture. `<ShareProgress>`'s own
   * capture-phase Escape (with `stopPropagation`) is expected to swallow the
   * Escape before Menu's bubble-phase listener sees it, and the overlay's own
   * scrim (`z-index: 90`, over the menu scrim's 80) is expected to swallow the
   * click — but neither of those is `inert`, and neither sees a system Back at
   * all, so this guard is the belt for all three. The overlay's OWN
   * scrim/Escape still cancel a genuinely cancelable busy-prepare phase, wired
   * straight to `bookShare.reset` (see `<ShareProgress>` below) rather than
   * through this function, so that path is unaffected by this guard.
   *
   * It reads `bookShare.ownsScreen()` — the LIVE flow state — and not
   * `shareOverlayOwnsScreen(bookShare.progress)`, the rendered mirror it used
   * before #452 PR3. Same predicate, one commit fresher, and the freshness is
   * load-bearing now: this is a `Layer`'s `dismiss()`, reached only when that
   * layer's `busy()` said the overlay does NOT own the screen. Two copies of
   * the same fact can disagree for one commit, and the disagreement is the bad
   * way round — `busy()` false, this guard true — which is a Back that
   * unregisters the layer, and so leaves `rearmAfterLayerBack` with an empty
   * stack and no reason to restore the entry, while the menu stays open. One
   * source, no window.
   */
  const closeBookMenuState = useCallback(() => {
    if (bookShare.ownsScreen()) return false;
    bookMenuSession.current += 1;
    setShareMenuBookId(null);
    setRenamingBook(false);
    setPickingCover(false);
    setCoverFailed(null);
    setSavingName(false);
    bookShare.reset();
    return true;
  }, [bookShare, setSavingName]);

  /**
   * Cancel / Escape / scrim / a system Back unmount the delete confirm with
   * focus still on Cancel. `onConfirmDelete` below already hands focus off
   * after both of ITS outcomes; a plain close never did, so a keyboard/switch
   * user landed on `document` on the path they actually take most (George R10
   * P2-2). The row is untouched, so the target is just the book the confirm was
   * armed for; the focus effect runs once `deleteTargetId` goes null and
   * `inert` lifts.
   *
   * **The one behaviour on this screen that closes over render state**, and so
   * the one that depends on `useScreenLayers` refreshing its latest-ref in a
   * LAYOUT effect rather than a passive one (Frank R4 P2 on #531). The other
   * four are immune by construction and it is worth knowing which is which:
   * `closeGlobalMenuState` and `cancelNewBookState` have empty dep arrays;
   * `closeBookMenuState` closes over `bookShare`, but reads it only through
   * `ownsScreen()`, which is a live synchronous read; the log-clear behaviour
   * is handed over imperatively in its own click handler and holds a ref. Here
   * `deleteTargetId` is a `useState` value read INSIDE the body, so a
   * pre-commit closure would run this with `null` and silently skip the focus
   * hand-off — the dialog would still close, and a keyboard or switch user
   * would land on `document`. Do not "simplify" that layout effect back.
   */
  const closeDeleteConfirmState = useCallback(() => {
    if (deleteTargetId !== null)
      rowReveal.armFocus(deleteTargetId, { preventScroll: true });
    setDeleteTargetId(null);
  }, [deleteTargetId, rowReveal]);

  // ── Delete asks inside the book sheet (#980, G6; #949 D16) ──────────────
  //
  // Delete does NOT close the book sheet: the sheet stays up and swaps its
  // actions for Keep and Delete (`O4BookDeleteAsk`). `deleteTargetId` names
  // the armed book and `"books:delete-confirm"` is the layer over the
  // sheet's own, so Back, `busy()` and the vanish effect below see it. Keep
  // goes back to the SAME open sheet (the workbench's `bmDelNo`), and focus
  // then goes to the sheet's Delete. That target is this screen's choice; the
  // workbench does not say where focus goes.
  //
  // Keep's button, focused when the ask appears (the safe action, as
  // EraseConfirm lands on Cancel) and again when the delete goes in flight
  // and Delete disables under the focus.
  const keepDeleteRef = useRef<HTMLButtonElement | null>(null);
  // The sheet's Delete control, focused again after Keep.
  const deleteControlRef = useRef<HTMLButtonElement | null>(null);
  // Set by Keep's state half, consumed by the effect that moves focus back to
  // Delete once it has remounted. A ref, so nothing but that effect reads it.
  const focusDeleteOnKeep = useRef(false);
  /**
   * Keep's STATE half, and the ask layer's `dismiss`. Returns
   * `false` while the delete is in flight, where Keep is a no-op: the store
   * write cannot be recalled, so un-arming then would put Delete back under
   * a book that is mid-delete. The layer's `busy()` is the same live ref
   * (`isDeleting`), so a system Back never reaches this early return.
   */
  const keepDeleteState = useCallback(() => {
    if (isDeleting()) return false;
    focusDeleteOnKeep.current = true;
    setDeleteTargetId(null);
    return true;
  }, [isDeleting]);

  const layers = useScreenLayers<BooksLayerId>(pushLayer, popLayer, {
    "books:global-menu": {
      // The theme toggle and the log panel's Share write nothing this screen
      // must wait for — `clearFailureLog` belongs to the Clear confirm, one
      // layer up, and `useFailureLogShare`'s own send holds no menu state.
      busy: () => false,
      dismiss: closeGlobalMenuState,
    },
    "books:log-clear-confirm": {
      // `?? false` / `?.` cover only the window in which the panel unmounted
      // without this layer being closed, which `closeGlobalMenu` below makes
      // unreachable by closing BOTH ids. If it were ever reached, Back would
      // spend one gesture and then fall through — not a trap.
      busy: () => logClearBehavior.current?.busy() ?? false,
      dismiss: () => logClearBehavior.current?.dismiss(),
    },
    "books:new-book": {
      busy: () => creatingBook.current,
      dismiss: () => {
        cancelNewBookState();
      },
    },
    "books:new-chapter": {
      busy: () => creatingChapter.current,
      dismiss: () => {
        cancelNewChapterState();
      },
    },
    "books:book-menu": {
      // Two writes live behind this panel: a rename in flight (#383/#384 —
      // whether it SHOULD refuse Back is #452 open question 7, for the
      // requirements owner; this ships the design's overlay-catalogue row and
      // is one term to remove either way), and the share flow, whose modal owns
      // the screen for its whole timeline (Amendment D, widened from
      // `status === "preparing"` because #491's modal outlives it — see
      // `UseShareFlow.ownsScreen`).
      busy: () => savingBookNameRef.current || bookShare.ownsScreen(),
      dismiss: () => {
        closeBookMenuState();
      },
    },
    "books:library-share": {
      // No enclosing menu to fold this into (see the `BooksLayerId` docblock
      // above) — `ownsScreen()` is the same ref-backed read `Layer.busy()`
      // must use (`ShareSurface.ownsScreen`'s own docblock, not the rendered
      // `progress`), read live so a Back lands against whichever tap most
      // recently began. `dismiss()` only ever runs once that is false, i.e.
      // once the flow has already let the screen go on its own — the same
      // no-op window `books:book-menu`'s `dismiss` is never left facing,
      // because the auto-close effect below keeps this layer off the stack
      // for exactly that window.
      busy: () => libraryShare.ownsScreen(),
      dismiss: libraryShare.dismissProgress,
    },
    "books:delete-confirm": {
      // The same live ref `deleteBook` flips to refuse a second Confirm, so
      // Back and Confirm agree about "in flight" by construction.
      busy: isDeleting,
      // The ask is inside the sheet, so Back is Keep: the ask goes and the
      // sheet stays (#980).
      dismiss: keepDeleteState,
    },
    // About & licenses (#36) writes nothing, so Back is never refused. Two
    // layers so Back walks the same path Escape does: licence text → list →
    // shelf (Frank F2, bench round 1 on #144).
    "books:about": {
      busy: () => false,
      dismiss: () => {
        setAboutViewing(null);
        setAboutOpen(false);
      },
    },
    "books:about-text": {
      busy: () => false,
      dismiss: () => {
        setAboutViewing(null);
      },
    },
  });

  // The ≡ that opened the global menu, handed focus back when it closes
  // (#949: the app menu on tiles).
  const globalMenuFocusRestore = useFocusRestore();

  // Share your work's layer (#1056): opened from the SAME tap that starts
  // `prepare()`/`send()` (invariant 6 — registration from a click, never an
  // effect), guarded by `ownsScreen()` because the banner's control stays
  // enabled (never `disabled`) all through busy so it keeps focus, and a
  // re-entrant tap on it must not push a second entry for the one flow
  // already live. `libraryShareForBanner` below is what actually reaches the
  // banner's `onClick`s.
  const openLibraryShareLayer = useCallback(() => {
    if (!libraryShare.ownsScreen()) layers.open("books:library-share");
  }, [layers, libraryShare]);
  // The ONE closing path, for every way the timeline ends: a tap on the
  // overlay's own Cancel/Dismiss (`onCancel`/`onDismiss` below, unwrapped —
  // both already end in `ownsScreen()` going false), a successful prepare's
  // "ready" settle, and an outcome's own auto-clear (`OUTCOME_HOLD_MS`) — the
  // last two with no tap at all. This EFFECT CLOSES the layer once
  // `shareOverlayOwnsScreen` is false — invariant 6 forbids an effect
  // REGISTERING a layer, not one closing a layer whose overlay is already
  // gone (the delete-confirm auto-close further down is the same shape).
  // `layers.close` is idempotent, so a render where the layer was never open
  // (the common case — most renders happen with the flow idle) costs nothing.
  const libraryShareOwnsScreenNow = shareOverlayOwnsScreen(
    libraryShare.progress
  );
  useEffect(() => {
    if (!libraryShareOwnsScreenNow) layers.close("books:library-share");
  }, [libraryShareOwnsScreenNow, layers]);
  // The banner never calls `libraryShare.prepare`/`send` directly — this
  // wrapping is the one place both taps are guaranteed to open the layer
  // before the flow can claim the screen, without duplicating the O4 banner's
  // own click handlers. `libraryShare`'s own identity is a fresh object every
  // render (`useLibraryShare` returns a literal, not a memoized one), so this
  // recomputes every render too; nothing downstream keys an effect on its
  // identity, only on `progress`/`ownsScreen`'s live reads.
  const libraryShareForBanner = useMemo<UseLibraryShare>(
    () => ({
      ...libraryShare,
      prepare: (zipFilename, nameBook, nameChapter) => {
        openLibraryShareLayer();
        return libraryShare.prepare(zipFilename, nameBook, nameChapter);
      },
      send: () => {
        openLibraryShareLayer();
        return libraryShare.send();
      },
    }),
    [libraryShare, openLibraryShareLayer]
  );

  // The global menu's ONE open and ONE close. Every entry point — the ≡, the
  // panel's Close, Escape, a scrim tap, the log panel's `onDone` — goes through
  // this pair, so no call site can forget the registration.
  const openGlobalMenu = useCallback(() => {
    // Synchronously, in the tap's own handler: one commit later the shelf
    // goes `inert` and the ≡ blurs (#97, #679).
    globalMenuFocusRestore.capture();
    setMenuOpen(true);
    layers.open("books:global-menu");
  }, [globalMenuFocusRestore, layers]);
  // Once the menu is gone and the shelf's `inert` has lifted.
  useLayoutEffect(() => {
    if (menuOpen) return;
    globalMenuFocusRestore.restore({ suppressed: false, fallback: null });
  }, [menuOpen, globalMenuFocusRestore]);
  const closeGlobalMenu = useCallback(() => {
    closeGlobalMenuState();
    // The Clear confirm lives INSIDE this panel and unmounts with it, so its
    // layer goes too — otherwise it would outlive its own component with a
    // `dismiss()` that can no longer reach anything, and hold Back at the shelf
    // forever (#494 item 3). Idempotent when it was never opened.
    layers.close("books:log-clear-confirm");
    layers.close("books:global-menu");
  }, [closeGlobalMenuState, layers]);
  // `FailureLogPanel` tells this screen when its Clear confirm opens and
  // closes; the panel keeps the state, this screen keeps the registration.
  const onClearConfirmOpen = useCallback(
    (behavior: ScreenLayerBehavior) => {
      logClearBehavior.current = behavior;
      layers.open("books:log-clear-confirm");
    },
    [layers]
  );
  const onClearConfirmClose = useCallback(() => {
    layers.close("books:log-clear-confirm");
    logClearBehavior.current = null;
  }, [layers]);

  // About replaces the global menu, so the menu's layer must go with it — a
  // raw `setMenuOpen(false)` left `books:global-menu` registered under the
  // visible About, and Back spent itself on that hidden menu (Frank F2). The
  // new layer registers BEFORE the menu's closes, as the delete confirm does,
  // so the stack is never empty between the two.
  const openAbout = useCallback(() => {
    layers.open("books:about");
    closeGlobalMenu();
    setAboutViewing(null);
    setAboutOpen(true);
  }, [closeGlobalMenu, layers]);
  const closeAbout = useCallback(() => {
    setAboutViewing(null);
    setAboutOpen(false);
    layers.close("books:about-text");
    layers.close("books:about");
  }, [layers]);
  const viewLicenseText = useCallback(
    (text: LicenseText) => {
      setAboutViewing(text);
      layers.open("books:about-text");
    },
    [layers]
  );
  const closeLicenseText = useCallback(() => {
    setAboutViewing(null);
    layers.close("books:about-text");
  }, [layers]);

  useEffect(() => {
    // HOLD the hand-off while the delete confirm is up. The shelf is `inert`
    // then (see the wrapper below), and an element inside an inert subtree
    // cannot take focus at all — so focusing there would be a silent no-op and
    // the pending target would be consumed and lost. The hook RETAINS a held
    // target rather than spending it (`lib/a11y/pending-reveal`, table-tested),
    // and `deleteTargetId` going null is exactly the moment `inert` comes off —
    // it is in this effect's deps, so the hand-off runs on that render instead.
    // This is the repo's own lesson, learned twice: a focus fix that ignores
    // `inert` is dead code (#364; docs/progress_tracker.md).
    rowReveal.reveal(deleteTargetId !== null);
    // Keyed on ALL THREE: `books` covers create/add-chapter and a successful
    // delete, `deleteTargetId` covers the render on which the delete confirm
    // comes down, and `newBookSeed` covers the render on which the New Book
    // dialog closes. A create now inserts the row into `books` (in the hook)
    // and closes the dialog (here) as two setStates in one async continuation;
    // React batches those into a single commit, but this hand-off must not
    // DEPEND on that — if they ever split, the `books` render would run this
    // effect before the hand-off below was armed and the focus would be lost
    // for good. Re-running on either close edge makes the order irrelevant; a
    // run with nothing armed is a no-op.
    // `newChapter` is in the list for the same reason `newBookSeed` is: the
    // Add-chapter prompt arms the scroll and closes itself in one async
    // continuation alongside the hook's own `setBooks`, and this hand-off must
    // not depend on React batching those into one commit.
    // `rowReveal` is a fifth dependency but never a trigger: it is memoised
    // (`use-scroll-to-new.ts`), so it is there for exhaustiveness.
  }, [books, deleteTargetId, newBookSeed, newChapter, rowReveal]);

  const toggle = useCallback((id: BookId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // `+` (and the empty state's CTA) no longer create anything: they open the
  // naming dialog first (#314). The field is pre-filled with the placeholder the
  // book would otherwise have been given silently, so the one-tap create the
  // corner + used to be is still one tap — Confirm — and nobody has to hunt for
  // Rename afterwards to give the book its real name.
  // Synchronous, deliberately: the placeholder is already in hand from the shelf
  // read, so the dialog opens in the SAME commit as the tap. An `await` here
  // would leave the shelf live and un-`inert` for that window — `inert` keys on
  // `newBookSeed`, which cannot be set until the await resolves — and the
  // hamburger or a row's ⋮ sits one tap away, which is how two `aria-modal`
  // panels end up stacked on `document.body` (George R1 P2-1).
  const onNewBook = useCallback(() => {
    // Remember the trigger so Cancel can hand focus back to it.
    newBookReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // The open edge is where the in-flight latch resets, exactly as
    // EraseConfirm resets `inFlightRef` — a reused dialog starts clean.
    creatingBook.current = false;
    setCreatingBookBusy(false);
    setNewBookError(null); // a fresh dialog starts with nothing to report
    // The words, rendered here and only here: the hook hands over the slot
    // (#169), and the seed is what the field shows AND what Confirm compares a
    // typed name against, so both halves read the same rendering.
    setNewBookSeed(strings.bookHeading(null, newBookNumber));
    setNewBookColour(null);
    // Registered in the SAME handler that opens it (invariant 6), and after
    // the state above for the same reason that ordering is documented as
    // unobservable in `use-nav-stack.ts`'s `openChapter`: the layer is on the
    // stack before this gesture returns either way.
    layers.open("books:new-book");
  }, [layers, newBookNumber]);

  // Cancel, Escape, the panel's Close, a scrim tap: all the same outcome —
  // nothing is created, and focus goes back where it came from. See
  // `cancelNewBookState` above for why a create in flight refuses all of them.
  //
  // The layer is unregistered on the SAME guarded path the dialog comes down
  // on, which is why the state half returns whether it closed: the in-flight
  // case leaves BOTH the panel and its layer standing.
  const onCancelNewBook = useCallback(() => {
    if (cancelNewBookState()) layers.close("books:new-book");
  }, [cancelNewBookState, layers]);

  // Return focus to the trigger once the dialog is gone. In an effect, not in
  // the handler: the shelf is `inert` while the dialog is open, and focusing an
  // element inside an inert subtree does nothing — so this has to wait for the
  // render that removes `inert`. A create clears the ref, because the row
  // hand-off (`rowReveal`) focuses the new row's toggle button instead (George
  // R5 P3 — this comment used to say "add-chapter control", which is what an
  // earlier round targeted before George R4 P2-1 moved the landing to the
  // toggle; see `rowReveal`'s declaration above for why).
  useEffect(() => {
    if (newBookSeed !== null) return;
    const el = newBookReturnFocus.current;
    newBookReturnFocus.current = null;
    if (el?.isConnected) el.focus();
  }, [newBookSeed]);

  const onConfirmNewBook = useCallback(
    async (typed: string) => {
      if (creatingBook.current) return;
      creatingBook.current = true;
      setCreatingBookBusy(true);
      setNewBookError(null);
      // An untouched field means "the placeholder is fine", so send "" and let
      // the store write the book UNNAMED, with the slot derived inside its own
      // write transaction — the one-tap create the corner + used to be,
      // race-safety and all. Sending the rendered string instead would take the
      // supplied-name path, which is deliberately never made unique: two
      // documents open on the same shelf both render the same placeholder and
      // would both write it as a name (George R1 P2-3) — and it would freeze
      // this locale's words onto the row, which is what #169 removed.
      //
      // Compared TRIMMED, because the caret lands in the pre-filled text and a
      // stray trailing space would otherwise slip "Book 001 " down the supplied
      // path — trimmed to the same duplicate this mapping exists to prevent
      // (George R2 P3-5). A genuinely typed name goes through as typed; a blank
      // or whitespace-only one is not an error either and lands on the same
      // fallback, in the store.
      const name = typed.trim() === newBookSeed ? "" : typed;
      const outcome = await createBook(name, newBookColour);
      if (!outcome.ok) {
        // A failed create keeps the dialog OPEN with the reason in its own
        // Notice — the screen's Notice sits behind the scrim — and the typed
        // name stays in the field for another try. Releasing the latch here, and
        // only here, is what makes that retry (and Cancel) work again.
        creatingBook.current = false;
        setCreatingBookBusy(false);
        setNewBookError(outcome.key);
        return;
      }
      const { book } = outcome;
      newBookReturnFocus.current = null;
      setNewBookSeed(null);
      setNewBookColour(null);
      // The dialog comes down on the success path too, so its layer must —
      // NOT through `onCancelNewBook`, whose own guard would refuse here
      // (`creatingBook` stays held until the next open edge, deliberately).
      layers.close("books:new-book");
      // A new book opens expanded — the next action is adding its first
      // chapter — and focus follows, in EVERY case now. Before #314 only a
      // create from the empty-state invite handed focus off, because the
      // corner + survived the create and kept it. The dialog's check does
      // not: it unmounts on Confirm, so without this hand-off focus falls to
      // the document and the first header stop takes over.
      setExpanded((prev) => new Set(prev).add(book.id));
      rowReveal.armScroll(book.id);
      rowReveal.armFocus(book.id);
      // No `finally`: on success the latch stays held until the next open edge.
      // See its declaration — releasing it here reopens the double-create window
      // between the write resolving and the panel actually unmounting.
    },
    [createBook, layers, newBookColour, newBookSeed, rowReveal]
  );

  // A book row's `+` no longer creates anything either: it opens the naming
  // prompt first (#609), the chapter parallel of what #314 did to the corner +.
  // The field is pre-filled with the "Chapter N" the row would have shown
  // anyway, so the one-tap add is still one tap — Confirm — and a facilitator
  // who wants "Mark 6" types it here instead of hunting for Rename afterwards.
  //
  // Synchronous, for the reason `onNewBook` is: the ordinal is already in hand
  // from the loaded shelf, so the prompt opens in the SAME commit as the tap
  // and the shelf is never left live and un-`inert` across an await, with a
  // row's ⋮ one tap from stacking a second `aria-modal` panel.
  //
  // `nextChapterNumber` is the same pure function `addChapter`'s own write
  // transaction calls, so the name the field offers is the ordinal the write
  // then derives as long as this shelf is current — `onConfirmNewChapter`
  // says what happens when another copy of the app has moved it.
  const onNewChapter = useCallback(
    (bookId: BookId) => {
      const card = books.find((b) => b.bookId === bookId);
      if (!card) return; // the row is gone from under the tap; nothing to add to
      newChapterReturnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      // The open edge is where the in-flight latch resets — a reused prompt
      // starts clean, exactly as `onNewBook` resets `creatingBook`.
      creatingChapter.current = false;
      setCreatingChapterBusy(false);
      setNewChapter({
        bookId,
        seed: strings.chapterName(
          nextChapterNumber(card.chapters.map((c) => c.number))
        ),
      });
      layers.open("books:new-chapter");
    },
    [books, layers]
  );

  const onCancelNewChapter = useCallback(() => {
    if (cancelNewChapterState()) layers.close("books:new-chapter");
  }, [cancelNewChapterState, layers]);

  // Return focus to the `+` that opened the prompt, once it is gone. In an
  // effect rather than in the handler, because the shelf is `inert` while the
  // prompt is up and focusing inside an inert subtree does nothing — this has
  // to wait for the render that removes `inert`. A successful create clears the
  // ref, so this is the cancel/dismiss/failure path only.
  useEffect(() => {
    if (newChapter !== null) return;
    const el = newChapterReturnFocus.current;
    newChapterReturnFocus.current = null;
    if (!el) return;
    if (el.isConnected) {
      el.focus();
    } else {
      // A second copy can delete the trigger's book while this prompt is up.
      const firstBook = books[0];
      if (firstBook) {
        // The same control an armed hand-off would land on, resolved through
        // the registry's own selector rather than a second copy of it.
        rowReveal.controlIn(firstBook.bookId)?.focus();
      } else {
        // Held Enter must not open and submit New Book after the last book
        // disappears. The empty state is registered as a node that IS the
        // target — it carries its own `tabIndex={-1}` — not a row with a
        // control inside it, so this reads the node rather than a control.
        rowReveal.nodeFor(EMPTY_STATE_NODE)?.focus();
      }
    }
  }, [newChapter, books, rowReveal]);

  const onConfirmNewChapter = useCallback(
    async (typed: string) => {
      if (newChapter === null || creatingChapter.current) return;
      creatingChapter.current = true;
      setCreatingChapterBusy(true);
      const { bookId } = newChapter;
      // An untouched field means "the default is fine", so send "" and let the
      // store write no label at all — the row then displays the ordinal its own
      // transaction derived. That is the same ordinal the field offered as long
      // as this shelf is current; another copy of the app adding a chapter
      // between the render and the write moves it, and storing no label is
      // exactly what keeps the row right when it does. Compared TRIMMED because
      // the caret lands in the pre-filled text and a stray trailing space would
      // otherwise store "Chapter 3 " as a literal name (the same mapping
      // `onConfirmNewBook` makes, for the same reason).
      const name = typed.trim() === newChapter.seed ? "" : typed;
      const chapter = await addChapter(bookId, name);
      // The prompt comes down either way. A REPORTED failure goes to the
      // screen's own Notice — where an add-chapter failure has always been
      // spoken — and that Notice sits BEHIND this panel's scrim, so holding
      // the panel open would hide the only report there is. `null` does not
      // always mean a reported failure: `canStartAddChapter` refuses a second
      // overlapping call for the same book silently, and a stale-delete race
      // is swallowed on purpose (`use-books.ts`). A chapter, unlike a book,
      // has no dialog-scoped failure channel to tell those apart in; giving it
      // one means changing what the hook returns, which is its own change.
      setNewChapter(null);
      layers.close("books:new-chapter");
      // A held Enter must land on a control that cannot write another chapter.
      // If the book vanished, the return-focus effect chooses a shelf fallback.
      if (!chapter) {
        newChapterReturnFocus.current =
          rowReveal.controlIn(bookId) ?? newChapterReturnFocus.current;
        return;
      }
      // On success it is cleared and the row hand-off takes over, for the
      // reason `rowReveal`'s declaration gives. The chapter row's only button is
      // "Open Chapter N": a stray re-activation navigates into the chapter,
      // which writes nothing and one Back undoes — the same "land on something
      // recoverable, not something that writes" rule George R4 P2-1 established
      // for New Book's own hand-off.
      newChapterReturnFocus.current = null;
      setExpanded((prev) => new Set(prev).add(bookId));
      rowReveal.armScroll(chapter.id);
      rowReveal.armFocus(chapter.id);
      // No `finally`: the latch stays held until the next open edge, so the
      // window between the write resolving and the panel unmounting cannot
      // take a second Confirm and write a chapter nothing on this tree can
      // delete.
    },
    [addChapter, layers, newChapter, rowReveal]
  );

  // The book whose ⋮ menu is open, resolved from the shelf. `null` closes the
  // menu — including if the book is gone by the time this render runs.
  const shareMenuBook = books.find((b) => b.bookId === shareMenuBookId) ?? null;
  // The open book's cover colour: its stored key, or #957's id-derived
  // fallback. The O4 sheet head, the Cover colour tile, the picker's pressed
  // swatch and the delete ask all read this one value.
  const shareMenuCoverKey: CoverColourKey | null = shareMenuBook
    ? resolveCoverKey({
        id: shareMenuBook.bookId,
        coverColourKey: shareMenuBook.coverColourKey ?? null,
      })
    : null;
  const shareMenuCoverHex =
    shareMenuCoverKey === null ? "" : coverColourHex(shareMenuCoverKey);
  // The words for the book this menu is about: its own name, or the placeholder
  // its slot renders (#169). One resolution for the rename seed and the share
  // filename, so the label the translator reads and the file they receive are
  // the same. `""` when no book is current — every use is guarded on one.
  const shareMenuBookName = shareMenuBook
    ? strings.bookHeading(shareMenuBook.name, shareMenuBook.number)
    : "";
  // The teardown the vanish effect below runs, behind a latest-ref ON PURPOSE.
  // It has to reset the share, and `useBookShare()` returns a fresh object
  // literal every render (`use-book-share.ts`) — putting that in an effect's
  // dependency array is precisely the round-6 P1 shape this design exists to
  // remove, and it is the reason `useScreenLayers` exists at all. A ref keeps
  // the effect's deps to plain state values plus the memoized `layers`, which
  // is the property its sibling effect for the delete confirm documents.
  // The vanish effect below needs to reset the share, and `useBookShare()`
  // returns a fresh object literal every render (`use-book-share.ts`) — that
  // object in a dependency array is the round-6 P1 shape this design exists to
  // remove. `reset` ITSELF is stable, though, so the member is the dependency
  // and the object never is: it is a `useCallback([handoff, modal])` over two
  // values that are `ref.current ??= …` in `share-flow.ts:388,409`, created
  // once for the hook's life.
  const resetBookShare = bookShare.reset;
  // The share overlay's own capture/restore pair (#96/#97, George r2 P2-1,
  // #491). See `segments-screen.tsx`'s own copy of this comment for why
  // capture must happen synchronously in the tap handlers below, never from an
  // effect.
  const focusRestore = useFocusRestore();
  // The book menu's OWN pair (#679), one per inert scope: the menu inerts the
  // shelf, the share overlay inerts the menu. Sharing one slot let the share
  // effect below consume the ⋮ capture while the menu stayed open, so a later
  // Close/Escape found nothing to restore (Frank r1 P2 on #754).
  const menuFocusRestore = useFocusRestore();
  // Open a book's ⋮ menu, ending any prior menu session so a rename still in
  // flight from the previous one cannot close this one.
  const onOpenShareMenu = useCallback(
    (bookId: BookId) => {
      // Remember the ⋮ that opened this menu, HERE — synchronously, in the
      // tap's own handler (#97, #679): one commit later the shelf goes
      // `inert`, which blurs this button to `<body>` in the mutation phase,
      // before any effect could read it.
      menuFocusRestore.capture();
      bookMenuSession.current += 1;
      setShareMenuBookId(bookId);
      setPickingCover(false);
      setCoverFailed(null);
      // A different book's still-pending rename must not show THIS book's fresh
      // Confirm as busy before it has even been tapped (Frank r1, #384).
      setSavingName(false);
      layers.open("books:book-menu");
    },
    [menuFocusRestore, layers, setSavingName]
  );
  // Menu's actual `onClose`, and the one close every caller uses — see
  // `closeBookMenuState` above for what it does and why the share-overlay guard
  // is kept.
  //
  // The Menu-level guard that blocked this while `savingBookName` was true
  // (round 3/4 of #384's review) was REVERTED: it stopped the
  // scrim/Close/Escape-elsewhere from unmounting the menu mid-write, but system
  // Back still could (a separate mechanism, `lib/nav/navigation.ts`'s
  // `popAction`), and a Menu-only guard funnels a user onto exactly that worse
  // exit (George R5 P2) — Close used to work, so nobody reached for system
  // Back; making it a silent no-op is what sends them there.
  //
  // **#452 PR3 gave system Back its own route through this menu's `Layer`**,
  // which is what #374 and #393 were waiting for. What it did NOT do is make
  // the two exits agree — and this comment claimed it did, until #536 item 2.
  // The split that remains, stated exactly rather than papered over: the
  // layer's `busy()` is `savingBookNameRef.current || bookShare.ownsScreen()`
  // (see the behaviour record above), while this close guards on
  // `ownsScreen()` ALONE. So in the window between a rename Confirm and its
  // write settling, a system Back is REFUSED while Menu's Close, its scrim and
  // its Escape still take the panel down. The write itself is unaffected
  // either way; `bookMenuSession` only stops that already-closed menu being
  // closed a second time by the late resolution, it does not recall the `put`.
  //
  // Closing the split means adding the saving read here, which would decide
  // for Close what PR3 decided for Back. Whether a rename in flight should
  // refuse dismissal AT ALL is #452 open question 7, for the requirements
  // owner, so it is named here rather than answered by a lane.
  const onCloseShareMenu = useCallback(() => {
    if (closeBookMenuState()) layers.close("books:book-menu");
  }, [closeBookMenuState, layers]);
  // Keep, from the O4 ask's own button. The state half above, plus the ask's
  // layer. A system Back reaches the state half through the layer instead.
  const onKeepDelete = useCallback(() => {
    if (keepDeleteState()) layers.close("books:delete-confirm");
  }, [keepDeleteState, layers]);
  // The book sheet's `<Menu onClose>`: its Escape, its scrim and its header
  // control. At rest they close the sheet. While the delete ask
  // is up they close the WHOLE sheet, ask and all, as the workbench's dimmer
  // does during G6 (`closeSheet` clears `bmConfirm` with the sheet), and the
  // header control's "Close menu" name stays true. Focus goes to the book's
  // own row. Refused while the delete is in flight, like Keep.
  const onCloseBookSheet = useCallback(() => {
    if (deleteTargetId === null) {
      onCloseShareMenu();
      return;
    }
    if (isDeleting()) return;
    if (!closeBookMenuState()) return;
    closeDeleteConfirmState();
    // Top layer first, so the stack goes 2 -> 1 -> 0.
    layers.close("books:delete-confirm");
    layers.close("books:book-menu");
  }, [
    deleteTargetId,
    isDeleting,
    closeBookMenuState,
    closeDeleteConfirmState,
    layers,
    onCloseShareMenu,
  ]);
  // Commit the typed book name (#264), then close the menu on success. A failed
  // write keeps the menu open with the reason in its own Notice — the screen's
  // Notice sits behind the scrim, so a rename needs a channel inside the panel.
  const onSaveBookName = useCallback(
    (name: string) => {
      if (!shareMenuBookId) return;
      // The same synchronous ref latch New Book's `creatingBook` uses (#395
      // item 3). `NameEdit`'s own `if (busy) return` in its `onSubmit` reads
      // LAST RENDER's `busy` — a key-repeated Enter can call this a second
      // time before the first commit's `savingBookName` paints. Reading
      // `savingBookNameRef` HERE, before this call flips it, closes that gap
      // for free: the ref already tracks "a rename for this menu session is
      // in flight" synchronously, for `Layer.busy()`'s own sync read (see its
      // declaration above) — reusing it costs no new state.
      if (savingBookNameRef.current) return;
      // An untouched field means "leave the label as it is", so send "" and let
      // the store keep what it holds — `onConfirmNewBook`'s mapping, compared
      // trimmed for the same reason (the caret lands in the pre-filled text).
      //
      // It carries more weight here. An unnamed book's field is pre-filled with
      // the RENDERED placeholder, so passing that straight through would write
      // this locale's words back onto the row #169 just took them off — and the
      // book would be named "Book 001" in English forever, by a Confirm the
      // translator meant as "no change".
      const typed = name.trim() === shareMenuBookName ? "" : name;
      // Capture the session this rename belongs to. IDB can settle after the
      // user has closed the menu, reopened another book's menu, or armed a share
      // — all of which advance the token — so close ONLY if we are still the
      // same session (F1). Without this, the stale resolution closes the
      // now-current menu and runs share.reset(), discarding a prepared encode.
      const session = bookMenuSession.current;
      // Flipped SYNCHRONOUSLY, before the write is even started — which is
      // what makes the menu layer's `busy()` honest for a system Back landing
      // in the same task as this tap (invariant 4).
      setSavingName(true);
      void renameBook(shareMenuBookId, typed)
        .then((book) => {
          if (book && bookMenuSession.current === session) onCloseShareMenu();
        })
        .finally(() => {
          // Guarded the same way the close above is: a stale settle from a
          // session this screen has already moved past (a newer open, close,
          // or armed share) must not touch state a newer session now owns.
          if (bookMenuSession.current === session) setSavingName(false);
        });
    },
    [
      renameBook,
      setSavingName,
      shareMenuBookId,
      shareMenuBookName,
      onCloseShareMenu,
    ]
  );
  // Abandon the rename (Cancel, Escape) and return to the action list. Bumps
  // the session and clears `savingBookName` like every other exit from this
  // rename does (George R1 P2, #384): without it, a rename cancelled while
  // still saving left BOTH a late resolution free to close the menu the user
  // had already backed out of, AND a stale `savingBookName` that showed the
  // NEXT Rename tap's fresh Confirm as busy before it was ever tapped.
  const onCancelRenameBook = useCallback(() => {
    bookMenuSession.current += 1;
    setRenamingBook(false);
    setSavingName(false);
  }, [setSavingName]);
  // ── O4: the Cover colour tile and #957's picker (#949, #937 D7) ─────────
  //
  // The write is #964's hook, which reports a failure to the funnel itself
  // and queues a second tap while one is in flight. `reload()` after a
  // success is what carries the stored key onto the shelf's card, and so to
  // the cover, the sheet head and the tile.
  const { setCoverColour } = useBookCoverColour();
  // The Cover colour tile, focused again when the picker gives way to the
  // tiles after a choice. The flag is set only by a successful choice, so a
  // sheet that closes from the picker never lands here.
  const coverTileRef = useRef<HTMLButtonElement | null>(null);
  const focusCoverTileOnReturn = useRef(false);
  const onOpenCoverPicker = useCallback(() => {
    setCoverFailed(null);
    setPickingCover(true);
  }, []);
  const onChooseCover = useCallback(
    (key: CoverColourKey) => {
      if (!shareMenuBookId) return;
      // The sheet session this choice belongs to: a close or a reopen while
      // the write settles must not flip the next session's picker.
      const session = bookMenuSession.current;
      // "queued" (#1046 item 4, DRI: "Last tap wins"): this tap was coalesced
      // into the in-flight chain and has no outcome of its own. The promise
      // that STARTED the chain resolves later with the last write's
      // { ok } / { failed } — that handler must still run the branches below.
      void setCoverColour(shareMenuBookId, key).then((result) => {
        if (result === "queued") return;
        if ("failed" in result) {
          // An earlier write in the chain committed before the last one
          // failed: the stored colour changed, so the shelf re-reads it.
          if (result.committed) reload();
          if (bookMenuSession.current === session)
            setCoverFailed(result.failed);
          return;
        }
        reload();
        if (bookMenuSession.current !== session) return;
        focusCoverTileOnReturn.current = true;
        setPickingCover(false);
      });
    },
    [reload, setCoverColour, shareMenuBookId]
  );
  useEffect(() => {
    if (pickingCover || !focusCoverTileOnReturn.current) return;
    focusCoverTileOnReturn.current = false;
    coverTileRef.current?.focus();
  }, [pickingCover]);
  // Whichever of "Share book"/"Preparing…"/"Share now" is currently rendered
  // — attached to every branch of the ternary below, so it survives that
  // remount and always names a live, non-destructive landmark for
  // `restore()`'s `fallback`. See `segments-screen.tsx`'s `shareControlRef`.
  const shareControlRef = useRef<HTMLButtonElement | null>(null);
  // Tap 1 — encode the book's chapters into a zip and arm the send gesture. The
  // menu stays open across both gestures (the shelf is `inert` behind it), so the
  // panel is what the translator is looking at.
  const onPrepareBookShare = useCallback(() => {
    if (!shareMenuBook) return;
    focusRestore.capture();
    // Arming a share ends the current rename-close session: a rename resolving
    // after this must not close the menu and drop the encode we are preparing.
    bookMenuSession.current += 1;
    setSavingName(false);
    // On the native route `prepare()` chains straight into `send()` (#860,
    // `share-flow.ts`'s `chainsToSend`) and resolves to ITS outcome — so this
    // tap alone must close the menu on `sent`/`dismissed` the same way
    // `onSendBookShare` below already does for the web route's own second
    // tap. On the web route (still `ready`, waiting for that second tap) and
    // on every non-chained ending (nothing to share, a prepare error, a
    // superseded run) this resolves `null`, and the guard below leaves the
    // menu exactly as every one of those already did.
    void bookShare
      .prepare(
        shareMenuBook.bookId,
        strings.shareBookFilename(shareMenuBookName),
        (n, name) => strings.shareFilename(shareMenuBookName, n, name)
      )
      .then((outcome) => {
        if (outcome === "sent" || outcome === "dismissed") onCloseShareMenu();
      });
  }, [
    focusRestore,
    bookShare,
    setSavingName,
    shareMenuBook,
    shareMenuBookName,
    onCloseShareMenu,
  ]);
  // Tap 2 — hand the armed zip to the OS share sheet. Close the menu once the
  // flow is done, but NOT on `retry` (the File is still armed) or `failed` (its
  // error Notice lives in the menu and must stay visible).
  //
  // `capture()` here is re-entrant-safe the same way `segments-screen.tsx`'s
  // is: tap 1's capture is already consumed by the restore effect below by
  // the time this control is reachable.
  const onSendBookShare = useCallback(() => {
    focusRestore.capture();
    void bookShare.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onCloseShareMenu();
    });
  }, [focusRestore, bookShare, onCloseShareMenu]);
  // Hand focus back once `inert` has lifted — mirrors
  // `segments-screen.tsx`'s own effect.
  useLayoutEffect(() => {
    if (shareOverlayOwnsScreen(bookShare.progress)) return;
    focusRestore.restore({
      suppressed: false,
      fallback: shareControlRef.current,
    });
  }, [bookShare.progress, focusRestore]);
  // Return focus to the ⋮ that opened this book's menu once the menu itself
  // is fully closed — Close, Escape, a scrim tap, or a completed rename/share
  // that closes it (#679) — and no share overlay still owns the screen.
  //
  // A SEPARATE effect from the one above, deliberately, rather than adding
  // `shareMenuBookId` to that effect's own dependency array: that effect must
  // keep firing on every `bookShare.progress` change made WHILE this menu
  // stays open (the busy → ready transition after `onPrepareBookShare`,
  // moving focus onto whichever of "Share book"/"Share now" is live), and it
  // must NOT also fire on this menu's OPEN edge — which adding
  // `shareMenuBookId` there would, since opening flips it non-null with
  // `bookShare.progress` still `"hidden"`, and that would consume the ⋮
  // capture `onOpenShareMenu` above just took, before the menu has shown
  // anything. Guarding on `shareMenuBookId === null` keeps this effect silent
  // while the menu is open. It also runs on mount and on later progress
  // changes, but `menuFocusRestore` is captured only by `onOpenShareMenu`, so
  // those runs find an empty slot and do nothing. A close into the delete
  // confirm (shelf still inert) consumes the capture without focusing;
  // `closeDeleteConfirmState`'s `pendingFocus` owns that landing.
  //
  // No fallback: once the whole menu is gone there is no live landmark left
  // inside it (`shareControlRef` unmounts in the same commit), and the ⋮
  // itself is the only sensible target — `restore()` already prefers it
  // whenever it is connected, focusable and no longer `inert`.
  useLayoutEffect(() => {
    if (shareMenuBookId !== null) return;
    if (shareOverlayOwnsScreen(bookShare.progress)) return;
    menuFocusRestore.restore({ suppressed: false, fallback: null });
  }, [shareMenuBookId, bookShare.progress, menuFocusRestore]);
  // Share speaks inside its own menu, not the shelf: the two-gesture flow keeps
  // the menu open across prepare → ready → send. The control's glyph, the gap
  // mark and the error mark all live in `ShareMenuSection` now (#160, L-15) —
  // the Segments menu derived the identical three.
  // The book-grain gap Notice (#116): `missing` (whole chapters left out) and
  // `partialSegments` (segments missing inside chapters that DID ship) are two
  // different counts that can both be non-zero for the same book. One Notice,
  // not two — the copy combines when both are present rather than stacking.
  //
  // The WORDING is `shareGapText` (George r1 P3-5, #491) — the same function
  // the outcome glyph's `partial` settle calls, so a later tightening of the
  // copy cannot land in one and not the other. `shareGapText` always returns
  // a string (even "0 …" for an empty gap), so whether to show the Notice at
  // all stays this screen's own boolean, separate from the text.
  const bookShareHasGap =
    bookShare.missing > 0 || bookShare.partialSegments > 0;
  const bookShareGapText = shareGapText(
    {
      missing: bookShare.missing,
      partial: bookShare.partialSegments,
      partialChapters: bookShare.partialChapters,
    },
    "book"
  );
  // ── Delete a book (#337) ──────────────────────────────────────────────────
  // The book the confirm names, resolved from the shelf each render. `open`
  // and `inert` below key off `deleteTargetId` alone, not this — a book that
  // vanishes out from under an armed confirm resolves this to null one render
  // before the auto-close effect below clears `deleteTargetId` in turn, and
  // driving the dialog from two different signals is exactly what let the
  // hold outlive it (George R10 P2-3).
  const deleteTarget = books.find((b) => b.bookId === deleteTargetId) ?? null;
  // The shelf order as it was when the confirm was armed for this book — the
  // same "before" snapshot `onConfirmDelete` below captures for its own
  // hand-off. Read by the auto-close effect further down, whose vanish can
  // only ever see the shelf AFTER the book is already gone.
  const armedShelf = useRef<readonly BookId[]>([]);
  // The book underneath the confirm can also vanish WITHOUT going through
  // this screen's own delete flow — a second tab or a pre-`autoUpdate` page
  // deleting it, the same shape `reportUnlessStale` (`use-books.ts`) guards
  // against. `deleteTarget` resolving to null already takes the dialog and
  // `inert` down (both now key off `deleteTargetId` directly, below), but
  // nothing cleared `deleteTargetId` itself, so the focus hold stayed latched
  // with no confirm left to close it and no focus target ever armed —
  // silently swallowing the NEXT hand-off too (George R10 P2-3).
  //
  // The setState is pushed past a microtask so it is not SYNCHRONOUS within
  // the effect body — `react-hooks/set-state-in-effect` flags exactly that
  // shape, and refs (`armedShelf`, and `rowReveal`'s own) may not be read or written
  // during render (`react-hooks/refs`), which rules out doing this inline in
  // the render body instead. Matches how every other effect in this hook
  // already only calls its setters from inside an async callback (the load
  // effect's `void (async () => { ... })()`, below).
  useEffect(() => {
    if (deleteTargetId === null || deleteTarget !== null) return;
    const targetId = deleteTargetId;
    void Promise.resolve().then(() => {
      rowReveal.armFocus(
        focusTargetAfterDelete("ok", targetId, armedShelf.current),
        { preventScroll: true }
      );
      setDeleteTargetId(null);
      // The confirm comes down here without any tap, so its layer has to come
      // down here too — a registered layer whose overlay is gone is #494 item
      // 3's trap, and this path is the one way to reach it on Books.
      //
      // This is an EFFECT closing a layer, which invariant 6 does NOT forbid:
      // what it forbids is REGISTRATION keyed on an effect, because that is
      // what an unstable dependency can fire spuriously. Both deps here are
      // plain state values, and `layers` and `rowReveal` are both memoized
      // (`use-screen-layers.ts`, `use-scroll-to-new.ts`), so there is no
      // per-render object literal to destabilise the array — the round-6 P1
      // shape cannot occur.
      layers.close("books:delete-confirm");
    });
  }, [deleteTarget, deleteTargetId, layers, rowReveal]);
  // The SAME class for the book ⋮ menu (George R1 P3-2). `<Menu>` is open on
  // `shareMenuBook !== null`, which is resolved from the shelf — so when
  // another tab deletes the open book the panel unmounts on its own, while
  // `shareMenuBookId` and the registered layer stay behind. The next Back then
  // spends itself running `closeBookMenuState` against a menu that is already
  // gone and popping a dead layer: one extra Back that does nothing visible,
  // ahead of #535's silent one, before the app will leave.
  //
  // No `bookShare.ownsScreen()` guard, unlike the tap-driven close path — and
  // NOT because there is nothing left on screen to protect. This comment used
  // to say the progress overlay "renders INSIDE this same `<Menu>` … so it
  // came down with the panel", which is the opposite of what it does (#536
  // item 1). `<ShareProgress>` is a SIBLING of `<Menu>`, portalled to `<body>`
  // (`share-progress.tsx`; the render site is at the end of this file), so it
  // SURVIVES the panel unmounting and is still on screen while this effect
  // resets it a microtask later.
  //
  // The guard is left off anyway, deliberately, and the reason is the BOOK,
  // not the overlay: that guard exists to stop a dismissal cancelling a share
  // the translator is watching, and what triggers this path is not a dismissal
  // — it is the book vanishing from under the menu (another tab, a
  // pre-`autoUpdate` page). A share of a book that no longer exists has
  // nothing left to prepare or hand over, so resetting it is the correct end
  // state however visible its overlay still is. A PR4 copy onto the chapter
  // menu must carry THAT reason; the unmount premise is false for both.
  useEffect(() => {
    if (shareMenuBookId === null || shareMenuBook !== null) return;
    void Promise.resolve().then(() => {
      bookMenuSession.current += 1;
      setShareMenuBookId(null);
      setRenamingBook(false);
      setPickingCover(false);
      setCoverFailed(null);
      setSavingName(false);
      resetBookShare();
      layers.close("books:book-menu");
    });
  }, [shareMenuBook, shareMenuBookId, layers, setSavingName, resetBookShare]);
  // Arm the delete ask from the book sheet's Delete tile. The sheet stays
  // open and its share is NOT reset (#980): the ask is about the same book
  // the sheet's share flow belongs to, so Keep returns to the sheet exactly
  // as it was, and the confirm's tail below resets the share when it closes
  // the sheet.
  const onArmDelete = useCallback(() => {
    // #491 removed the per-handler `shareOverlayOwnsScreen` guard here in
    // favour of `<Menu>`'s own `inert` prop below: with `inert` doing its job,
    // Delete is unreachable by click, keyboard or AT activation for the whole
    // time this guard used to check.
    //
    // #517 item 1 (George r3 P3 on #508) put it back, as defense in depth: if
    // `inert` is ever bypassed (a WebView bug, an unsupported `inert`
    // implementation), nothing else stops the ask from arming under the share
    // overlay. This has not been observed on a device; it is a second,
    // redundant check behind the primitive, not evidence the primitive is
    // insufficient.
    if (shareOverlayOwnsScreen(bookShare.progress)) return;
    const bookId = shareMenuBookId;
    // The ask stays inside the sheet (#980): the sheet is NOT closed and its
    // share is not reset, so Keep returns to it exactly as it was. The ask's
    // layer goes over the sheet's (1 -> 2).
    layers.open("books:delete-confirm");
    // Captured NOW, while the row this ask targets is still on screen — the
    // auto-close effect above needs this "before" shelf, because by the time
    // it detects the vanish, `books` has already moved on without it.
    armedShelf.current = books.map((b) => b.bookId);
    setDeleteTargetId(bookId);
  }, [books, bookShare.progress, layers, shareMenuBookId]);
  const onConfirmDelete = useCallback(() => {
    if (deleteTargetId === null) return;
    // The shelf order as it is right now, captured while the row is still on
    // screen — `focusTargetAfterDelete` needs it to name the row that will take
    // this one's place.
    const shelfBefore = books.map((b) => b.bookId);
    // No share reset here: arming does NOT reset the share (Keep returns to
    // the sheet as it was), so the tail below resets it when it closes the
    // sheet, on either outcome.
    void (async () => {
      const result = await deleteBook(deleteTargetId);
      // A double-tap's second call is refused, not answered: the first delete is
      // still running and owns the outcome, so the confirm must NOT come down.
      if (result === "busy") return;
      if (result === "ok") {
        // The id is gone for good, so drop it from the expanded set rather than
        // letting a session of deletes accumulate dead ids.
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(deleteTargetId);
          return next;
        });
      }
      // Both outcomes hand focus off the SAME way — never a direct `.focus()`
      // here. The confirm is still up at this point, so the shelf is still
      // `inert` and focusing into it would do nothing (#364). Record the target
      // and let the effect above act once `setDeleteTargetId(null)` has taken
      // `inert` off.
      //
      // On success the row unmounts and focus would fall to the document; on
      // failure the row survives but the ask carrying the focused Keep
      // unmounts, so it falls to the document just the same. Which node each
      // case wants is decided by `focusTargetAfterDelete`, which is pure and has
      // a test table — the ordering below is the half no test here can observe.
      rowReveal.armFocus(
        focusTargetAfterDelete(result, deleteTargetId, shelfBefore),
        { preventScroll: true }
      );
      setDeleteTargetId(null);
      // Both outcomes take the confirm down, so both take its layer down.
      // `"busy"` returned above the `if`s, leaving both standing — which is
      // right: the first delete still owns them.
      layers.close("books:delete-confirm");
      // The ask was inside the book sheet, which is still open: arming did
      // not close it (#980). Either outcome closes it now, through the one
      // close path, so the share resets and the sheet's layer goes. The row
      // hand-off above still decides where focus lands.
      onCloseShareMenu();
    })();
  }, [books, deleteBook, deleteTargetId, layers, onCloseShareMenu, rowReveal]);

  // The delete ask's focus (#980). On the render the ask appears, land on Keep:
  // the sheet's `<Menu>` does not refocus, because it never closed. Again
  // when the delete goes in flight, since Delete disables under the focus
  // and would drop it out of the sheet's trap (EraseConfirm moves to Cancel
  // on its own busy edge for the same reason).
  const deleteArmed = deleteTargetId !== null;
  useEffect(() => {
    if (deleteArmed) keepDeleteRef.current?.focus();
  }, [deleteArmed, deleting]);
  // After Keep, back to the sheet's Delete once it has remounted. Only Keep
  // sets the flag, so a delete that closes the sheet never lands here.
  useEffect(() => {
    if (deleteArmed || !focusDeleteOnKeep.current) return;
    focusDeleteOnKeep.current = false;
    deleteControlRef.current?.focus();
  }, [deleteArmed]);

  // `deleteFailed` only ever RELABELS the hook's current error — they are one
  // state there, so the label cannot outlive what it labels. A *reload* no
  // longer takes this line down (it would race the delete's own error off the
  // screen); what clears it is another delete, or any write that succeeds
  // (George R4 P2-2 / Frank R4 P2). A delete that failed on a full disk
  // speaks `noRoom`, as every other write does (#894).
  const noticeText = shelfNoticeText(error, deleteFailed);

  // The guided chain's answer for this screen (#604): one accent on the next
  // required action, and nothing once the first book has been worked in. Read
  // here and compared by `kind` at each call site, so the controls below
  // cannot disagree about which of them is the step. The header + is
  // deliberately absent from the chain — the only state that would guide it is
  // an empty shelf, and the shelf hides it there in favour of the invite's own
  // CTA (above).
  const guide = guidedStep({
    screen: "books",
    loaded,
    naming: newBookSeed !== null,
    namingChapter: newChapter !== null,
    books,
    expandedBooks: expanded,
  });

  // The encoder's own health (#166). Module state, not hook state — every
  // encode in the app runs through `mp3-codec`'s single lane, from the sweep
  // App starts at launch to a Share on another screen — so it is read through
  // `useSyncExternalStore`, which re-renders on the store's own change rather
  // than on a poll. Both arguments are module-level functions and so are stable
  // across renders; the third is the server snapshot, which never runs here but
  // keeps the hook honest if this tree is ever server-rendered
  // (`error-boundary.test.ts` already renders components through
  // `react-dom/server`).
  const encoderLine = encoderNotice(
    useSyncExternalStore(subscribeToEncoderHealth, encoderHealth, encoderHealth)
  );

  // While the menu is open, take the whole shelf chrome — New Book included —
  // out of the focus/pointer tree for AT/switch users, matching how Segments
  // inerts behind its dialogs (G8: aria-modal alone is not trusted to hide the
  // background). The Menu portals to <body>, so it stays live above this (#77).
  // Named so the chapter reorder below stands down under the same overlays.
  const shelfInert =
    menuOpen ||
    aboutOpen ||
    shareMenuBook !== null ||
    deleteTargetId !== null ||
    newBookSeed !== null ||
    newChapter !== null ||
    // The share overlay joins the shelf's inert conditions (George r1 P2
    // #1/#2, #491): AT gesture navigation does not dispatch the `Tab`
    // keydowns `<ShareProgress>` intercepts, so this is what keeps that
    // path off the shelf/New Book while the overlay is up — including
    // through the outcome hold, after `shareMenuBook` may already be null.
    shareOverlayOwnsScreen(bookShare.progress) ||
    shareOverlayOwnsScreen(libraryShare.progress);

  // ── Press-and-hold reorder of chapters (#953 PR2b) ────────────────────────
  //
  // Hold a chapter row for 450 ms, then drag it within its book (§4, §7; D11:
  // drag only for the training). The whole row is the hold area: it is one
  // button with nothing else on it, and the workbench marks the whole row
  // (`data-reorder="ch"`). The gesture is `hooks/use-reorder-gesture.ts`, the
  // one the Segments list uses, run per open book in `BookItem`; this screen
  // supplies the one write, the words and the focus.
  //
  // One write, on the drop: `moveChapter` (#1053) patches the card
  // optimistically, renumbers the badges (names such as "Mark 6" stay, the
  // DRI's pick), leaves the book where it is on the shelf (#953 scope Q4),
  // and on failure puts the stored order back and reports "chapter-reorder",
  // with nothing extra on screen (#172). Every cancel writes nothing.
  //
  // Off while an overlay has the shelf `inert`, and before the first load
  // has finished.
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const [reorderStatus, setReorderStatus] = useState("");
  const chapterReorder: ChapterReorder = {
    enabled: !shelfInert && !loading,
    scrollRef: shelfRef,
    nodeFor: rowReveal.nodeFor,
    onLift: (row) => setReorderStatus(strings.chapterReorderLifted(row.number)),
    onDrop: (row, toIndex) => {
      // Keep focus with the chapter that moved, as the Segments list does:
      // only when focus was on that row (or already nowhere), so a drop never
      // pulls focus off something else. The reveal effect lands it on the
      // row's button once the reordered card commits.
      const active = document.activeElement;
      const node = rowReveal.nodeFor(row.chapterId);
      if (active === document.body || (node && node.contains(active))) {
        rowReveal.armFocus(row.chapterId);
      }
      // Chapters renumber after a move, so the row's new number is its new
      // position among the card's rows (the ones `moveChapter` indexes).
      const moved = strings.chapterReorderMoved(row.number, toIndex + 1);
      setReorderStatus(moved);
      // A write that did not land puts the row back (`moveChapter` resolves
      // false, having reported it), so the spoken line must not keep saying
      // it moved. Only if nothing newer has been said since.
      void moveChapter(row.chapterId, toIndex).then((landed) => {
        if (!landed) {
          setReorderStatus((s) =>
            s === moved ? strings.chapterReorderStayed(row.number) : s
          );
        }
      });
    },
    onCancel: (row) =>
      setReorderStatus(strings.chapterReorderStayed(row.number)),
  };

  // ── Press-and-hold reorder of books (#338) ────────────────────────────────
  //
  // The chapter reorder above, one level up: hold a book's row (its expand
  // toggle — cover and name) for 450 ms, then drag it up or down the shelf.
  // The same gesture (`hooks/use-reorder-gesture.ts`), the same enable rule
  // (off under an overlay and before the first load), the same live region,
  // and the same focus rule. A book moves whether it is open or closed; an
  // open one moves with its chapters, as one card.
  //
  // One write, on the drop: `moveBook` patches the shelf optimistically, does
  // not count as activity on the book, and on failure puts the stored order
  // back and reports "book-reorder", with nothing extra on screen (#172).
  // Every cancel writes nothing. Like the chapter reorder, there is no
  // keyboard or switch path to move a book (D11); the live region only says
  // what a drag did.
  const bookHeadingOf = (book: BookCard) =>
    strings.bookHeading(book.name, book.number);
  const bookGesture = useReorderGesture<BookId>({
    enabled: !shelfInert && !loading,
    ids: books.map((book) => book.bookId),
    nodeFor: rowReveal.nodeFor,
    scrollRef: shelfRef,
    onLift: (index) => {
      const book = books[index];
      if (book)
        setReorderStatus(strings.bookReorderLifted(bookHeadingOf(book)));
    },
    onDrop: (bookId, _fromIndex, toIndex) => {
      const book = books.find((b) => b.bookId === bookId);
      if (!book) return;
      const heading = bookHeadingOf(book);
      // Keep focus with the book that moved — on its row, which is what the
      // hand-off lands on — only when focus was on that row or nowhere, so a
      // drop never pulls focus off something else.
      const active = document.activeElement;
      const hit = rowReveal.nodeFor(bookId)?.querySelector(".books-card-hit");
      if (active === document.body || (hit && hit === active)) {
        rowReveal.armFocus(bookId);
      }
      // The landing is the book's new place on the shelf, counted from 1.
      const moved = strings.bookReorderMoved(heading, toIndex + 1);
      setReorderStatus(moved);
      // A write that did not land puts the book back (`moveBook` resolves
      // false, having reported it), so the spoken line must not keep saying
      // it moved. Only if nothing newer has been said since.
      void moveBook(bookId, toIndex).then((landed) => {
        if (!landed) {
          setReorderStatus((s) =>
            s === moved ? strings.bookReorderStayed(heading) : s
          );
        }
      });
    },
    onCancel: (index) => {
      const book = books[index];
      if (book)
        setReorderStatus(strings.bookReorderStayed(bookHeadingOf(book)));
    },
  });
  const bookDrag = bookGesture.drag;

  return (
    <div
      className="flex h-full flex-col gap-[14px]"
      inert={shelfInert || undefined}
    >
      <header className="books-header">
        {!showEmpty && (
          // #941's shared 56 × 56 square.
          <SquareButton
            icon="plus"
            label={strings.newBook}
            disabled={loading || loadFailed}
            onClick={onNewBook}
          />
        )}
        {/* State-in-place on the control itself, which AGENTS.md prefers to a
            message bubble: while the failure log holds a row that lights it
            (`markedFailureCount`, #1005) the ≡ carries an alert mark and says
            so in its name. The `control-hinted` wrapper is
            rendered UNCONDITIONALLY — swapping the button's parent as a failure
            lands would remount it and destroy it while focused, the same trap
            `Control`'s own hint wrapper documents.

            Why the wrapper is hand-rolled here rather than passed as `Control`'s
            `hint`: that prop is read only while the control is `disabled`
            (`control.tsx`, `shownHint = disabled && hint`), because it exists to
            say WHY a control is inert (#135). This ≡ must stay live — reaching
            the report is the whole point — so the built-in mark would never
            render. Same two classes, same `aria-hidden` sibling shape, so the
            two marks cannot drift apart visually; the only difference is the
            colour, because this one is a state mark rather than a reason. */}
        <span className="control-hinted">
          <Control
            icon="menu"
            label={
              markedFailureCount > 0
                ? strings.menuOpenWithFailures(markedFailureCount)
                : strings.menuOpen
            }
            variant="quiet"
            className="books-ghost"
            onClick={openGlobalMenu}
          />
          {markedFailureCount > 0 && (
            // Decorative for AT — the count is already in the button's
            // accessible name — so a screen reader hears it once.
            <span className="control-hint text-live" aria-hidden="true">
              <Icon name="alert" size={12} />
            </span>
          )}
        </span>
      </header>

      {/* Books is home — a chapter opens on top and a failed shelf read has no
          "back out and re-enter" recovery the way Segments does. So a load
          failure carries a Retry (reload), not just a Notice, or the shelf is a
          dead end with recordings invisible on disk (G9). */}
      {noticeText ? (
        <Notice>
          <span className="min-w-0 flex-1">{noticeText}</span>
          {loadFailed && (
            <Control
              icon="retry"
              label={strings.tryAgain}
              variant="quiet"
              size={20}
              onClick={onRetryShelf}
            />
          )}
        </Notice>
      ) : (
        loading && <Notice tone="busy">{strings.loadingBooks}</Notice>
      )}

      {/* Three standing background conditions can be true at once — the
          browser has not promised to keep this storage (#12), this origin is
          running low regardless (#247), AND the encoder has stopped working
          (#166) — and they are about different subsystems, so #279's
          precedent (encoderLine's own line, not folded into the
          load/delete/loading slot above, which stays exclusive and acute-first)
          extends to all three rather than making one dominant CSS-flag over
          the others: each is `&&`-rendered on its own, and ANY combination may
          show stacked.

          Neither `storage` nor `encoderLine` is gated by the slot above, and
          neither waits for it to go quiet: both render as soon as THEIR OWN
          readiness condition is met — `useStoragePersistence` resolves once
          `hasContent` (a loaded shelf with at least one book) is true;
          `encoderHealth()` is independent module state that has nothing to
          report until an encode has actually failed. Neither reads
          `noticeText` or `loading`. A delete failure is the case that shows
          the split: once the shelf has already loaded, `hasContent` stays
          true, so `storage` keeps rendering underneath a `deleteFailed`
          notice in the slot above rather than waiting on it to clear (#406
          item 1 — the prior wording here tied this to `noticeText`/`loading`
          being settled, which is not how either gate works). `pressureLine`
          used to be different on purpose (`use-storage-pressure.ts`'s CONTRACT note:
          the device can be full before this app has read anything, so the
          underlying hook is NOT gated on content) — but the gate that
          exclusivity needs now lives INSIDE `storagePressureNotice` itself
          (`hasReclaimableAudio` plus `deleteFailed`, passed in above — see
          that call site's own comment for why `loading`/`loadFailed` are not
          part of this gate, #843 item 4), not as JSX here. #542 round 1
          (Frank P2-2 / George P3-5) found the load-bearing predicate living
          here, in a bare `&&` no test could pin — the same shape
          `encoder-notice.ts` already avoids for `encoderLine`; #542 Part B
          (DRI decision 2026-09-24) then strengthened the predicate itself
          from `hasContent` ("a book exists") to `hasReclaimableAudio` ("a
          recorded take exists somewhere"), because the former let an empty
          book or chapter show this line's remediation copy with nothing to
          remediate. `pressureLine` is `null` whenever any of that applies, so
          the render below needs no extra condition of its own.

          Order: storage, pressure, encoder. Storage's risk is total and
          unrecoverable (browser eviction, no restore path); pressure is
          recoverable by acting on it (mark segments finished, share and
          erase); encoder's copy explicitly promises nothing is lost — most
          severe first, same principle the load-failure/loading slot above
          already applies by being exclusive and ordered acute-first.
          `notice-tone.ts`'s `info` docblock names this exact case (a standing
          condition, not only a completed-event caveat) after George round 1
          P3-3 flagged the original wording as covering only the latter.

          Two things #247 still leaves open, honestly: `pressureLine` starts
          `null` on every Books mount and only paints once `estimate()` lands
          (no cross-mount CACHE — #537 round 6, unchanged by #542 Part A,
          which bumps `use-storage-pressure.ts`'s module-scope generation on a
          book delete/create commit but caches nothing across a remount), so
          a translator who stays inside one chapter recording segment after
          segment — Books unmounted the whole time — sees no update until
          they come back out (the still-open "recorder-close refresh" half of
          #247); and this has not been read against a real Android
          `estimate()` value or inside the Capacitor training shell, so the
          thresholds and the native behaviour are both unverified in-shell.
          Neither is guessed at here. */}
      {storage === "not-persisted" && (
        <Notice tone="info">{strings.storageNotPersisted}</Notice>
      )}
      {pressureLine && (
        // State 17's banner, with its "Share your work" button (#983).
        <StoragePressureBanner
          notice={pressureLine}
          share={libraryShareForBanner}
        />
      )}
      {encoderLine && (
        <Notice tone={encoderLine.tone}>{encoderLine.text}</Notice>
      )}

      <div className="flex-1 overflow-y-auto" ref={shelfRef}>
        {showEmpty ? (
          // Registered as a focus target like a book row: deleting the last book
          // unmounts the row that had focus, and this CTA is the only control
          // left to hand it to (#337).
          <div
            className="books-empty"
            role="group"
            aria-label={strings.booksEmpty}
            tabIndex={-1}
            ref={(el) => rowReveal.setNode(EMPTY_STATE_NODE, el)}
          >
            {/* State 01's empty book: an outline of the book the CTA below
                will make. Decoration — the group's name already says it. */}
            <span className="books-empty-outline" aria-hidden="true">
              <Icon name="book" size={56} />
            </span>
            <EmptyState
              headline={strings.booksEmpty}
              teach={strings.booksEmptyTeach}
              ctaLabel={strings.newBook}
              ctaIcon="plus"
              guided={guide?.kind === "new-book"}
              onCta={onNewBook}
            />
          </div>
        ) : (
          <ul
            className="books-list"
            data-reordering={bookDrag ? "" : undefined}
          >
            {books.map((book, index) => (
              <BookItem
                key={book.bookId}
                book={book}
                onHoldStart={bookGesture.holdStart(index)}
                lifted={bookDrag?.fromIndex === index}
                // While a book is lifted: it follows the finger and the books
                // between its slot and the target slide one slot to make
                // room. Paint only; the order is not touched until the drop.
                reorderY={
                  bookDrag
                    ? bookDrag.fromIndex === index
                      ? bookDrag.offset
                      : reorderShift(
                          index,
                          bookDrag.fromIndex,
                          bookDrag.toIndex
                        ) * bookDrag.pitch
                    : null
                }
                expanded={expanded.has(book.bookId)}
                onToggle={() => toggle(book.bookId)}
                onNewChapter={() => onNewChapter(book.bookId)}
                onOpenShareMenu={() => onOpenShareMenu(book.bookId)}
                onOpenChapter={onOpenChapter}
                guidedAddChapter={
                  guide?.kind === "add-chapter" && guide.bookId === book.bookId
                }
                guidedToggle={
                  guide?.kind === "expand-book" && guide.bookId === book.bookId
                }
                guidedChapterId={
                  guide?.kind === "open-chapter" ? guide.chapterId : null
                }
                setNode={rowReveal.setNode}
                reorder={chapterReorder}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The reorder's spoken half — chapters (#953 PR2b) and books (#338)
          share it — as on the Segments list: which row was lifted, where it
          landed, or that it went back. Outside the shelf's scroll box, and
          mounted for the screen's whole life so a screen reader hears the
          first change. D11 leaves no keyboard or switch path to move a
          chapter or a book; this only tells what a drag did. */}
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        data-reorder-status=""
      >
        {reorderStatus}
      </span>

      {/* The global menu: the failure-log panel, then About & licenses, then
          the theme toggle.

          THE PANEL COMES FIRST, and the order is load-bearing. `Menu` lands
          focus on its first actionable child on open, and while the log is
          non-empty the ≡ is named "Open menu. N problems recorded." — reaching
          the report is its whole point. So the report is what a switch/AT
          user must land on, not About or a control that flips the theme
          (George R1 P2 on #457). The panel is mounted only while the log holds
          something, so a phone that has never failed opens on About, as the
          first actionable child.

          About & licenses (#36): the reachable-on-the-phone home for the LGPL
          notice and the bundled-component attribution. Opening it closes the
          menu and hands off to the About panel, which owns its own Menu.

          Placement (DRI ruling on PR #1019, 2026-09-26): About renders as
          a tile in the same `TileGrid` the theme tile uses, ahead of the
          `TileSpacer` — so it is the grid's first tile and the theme tile
          keeps the far end, the position `tests/books-menus-tiles-o4.test.ts`
          already pins for it.

          The toggle (#171) is `ThemeControl`, which is also mounted in the
          chapter and recorder menus (#149) — its own docblock holds why it is
          one shared component, why the glyph names the destination, and why
          the tap leaves this menu open. What stays Books-only is the panel
          above it, for the two reasons recorded there.

          This menu used to end with the design switch (#938's pencil, "New
          look (O4)"). #1244 removed it, and #954 removed the old look it
          switched to. */}
      {/* `hamburger`: no visible "Menu" title, and the dismiss ✕ alone in the
          top-right corner (#608, #1268). The recorder's drawer opts into the
          same `hamburger` header (#621). */}
      <Menu open={menuOpen} onClose={closeGlobalMenu} hamburger>
        {failureCount > 0 && (
          <FailureLogPanel
            count={failureCount}
            onDone={closeGlobalMenu}
            onClearConfirmOpen={onClearConfirmOpen}
            onClearConfirmClose={onClearConfirmClose}
          />
        )}
        {/* The workbench's G1, plus the DRI's About placement above: About
            is a tile ahead of the spacer, the theme tile stays at the far
            end, where every menu draws it. The report panel above stays as
            it is (its Export tile's words are a DRI call). */}
        <TileGrid>
          <Tile
            tone="plain"
            icon="info"
            label={strings.aboutOpen}
            caption={strings.tileAbout}
            onClick={openAbout}
          />
          <TileSpacer />
          <ThemeControl tile />
        </TileGrid>
      </Menu>

      <AboutPanel
        open={aboutOpen}
        viewing={aboutViewing}
        onView={viewLicenseText}
        onBack={closeLicenseText}
        onClose={closeAbout}
      />

      {/* New Book asks for the name before it creates anything (#314). The same
          panel surface the rename uses — so the focus trap, Escape, the scrim
          tap and the announced heading are the reviewed ones, not a second
          dialog mechanism — holding the same NameEdit field. The field arrives
          pre-filled with the placeholder, so Confirm alone is the old one-tap
          create; Cancel, Escape, Close and the scrim all create nothing. */}
      <Menu
        open={newBookSeed !== null}
        onClose={onCancelNewBook}
        title={strings.newBookTitle}
        closeLabel={strings.newBookClose}
      >
        <NameEdit
          initialValue={newBookSeed ?? ""}
          fieldLabel={strings.bookNameField}
          saveLabel={strings.createBook}
          onSave={(name) => void onConfirmNewBook(name)}
          onCancel={onCancelNewBook}
          busy={creatingBookBusy}
          busyLabel={strings.creatingBook}
          guided={guide?.kind === "create-book"}
        >
          {/* The cover colour (#1190). Optional: nothing is marked until a
              swatch is tapped, and a book created without a pick is written
              exactly as before. Tapping the marked swatch again clears it. The
              colour rides into the create's own write transaction. Frozen while
              the create is in flight, like the field. */}
          <CoverPicker
            selected={newBookColour}
            onSelect={(key) =>
              setNewBookColour((prev) => (prev === key ? null : key))
            }
            disabled={creatingBookBusy}
          />
        </NameEdit>
        {/* New Book's own busy AT channel (#395 item 2) — the third busy
            `NameEdit` caller, and the one that had none: the field
            `autoFocus`es and Enter submits without moving focus to Confirm,
            exactly why rename's own busy Notice below exists, so nothing was
            announced here when `creatingBookBusy` went true with focus still
            on the field. Its own busy string, not `savingName` — nothing
            exists yet for "Saving…" to describe (see `createBook`'s own
            comment above). */}
        {creatingBookBusy && (
          <Notice tone="busy">{strings.creatingBook}</Notice>
        )}
        {/* THIS dialog's own failure channel — never the shared `error`, which
            also carries a failed addChapter or rename and would announce one
            here as if naming had gone wrong. */}
        {newBookError && <Notice>{strings[newBookError]}</Notice>}
      </Menu>

      {/* Add chapter asks for the name before it creates anything (#609). The
          same panel, the same NameEdit and the same "Confirm alone is the old
          one-tap" contract the New Book dialog above holds — the field arrives
          pre-filled with the "Chapter N" the new row would show anyway.

          No dialog-scoped Notice here, unlike New Book: a failed add-chapter
          has always spoken through the screen's own Notice, and this panel
          closes on failure so that Notice is visible rather than behind its
          scrim. See `onConfirmNewChapter`. */}
      <Menu
        open={newChapter !== null}
        onClose={onCancelNewChapter}
        title={strings.newChapterTitle}
        closeLabel={strings.newChapterClose}
      >
        <NameEdit
          initialValue={newChapter?.seed ?? ""}
          selectInitialValue
          fieldLabel={strings.chapterNameField}
          saveLabel={strings.createChapter}
          onSave={(name) => void onConfirmNewChapter(name)}
          onCancel={onCancelNewChapter}
          busy={creatingChapterBusy}
          guided={guide?.kind === "create-chapter"}
        />
      </Menu>

      {/* The per-book ⋮ menu. Mirrors the Segments chapter menu: two gestures in
          the same spot — "Share book" encodes + zips (tap 1), then a primary
          "Share now" hands the File to the sheet in a fresh activation (tap 2) —
          with the busy state, a gap warning, and any error riding inside the
          panel because the flow keeps it open. */}
      <Menu
        open={shareMenuBook !== null}
        onClose={onCloseBookSheet}
        title={strings.bookMenuTitle}
        // The class-level isolation primitive (#491, the DRI's option-A pick
        // on the judgment sheet): while the overlay owns the screen, the
        // WHOLE panel below — Rename, Share/Send, Delete, Close, the rename
        // field — goes `inert` as one subtree. See `menu.tsx`'s own
        // docblock on the prop for why this replaced four rounds of
        // per-handler patches, the last of which (Frank at `ec2a148`) found
        // Share/Send themselves still unguarded.
        inert={shareOverlayOwnsScreen(bookShare.progress)}
        // OUTSIDE the inert subtree above but still inside this panel's
        // `aria-modal` boundary — see `menu.tsx`'s `liveRegion` docblock.
        //
        // Mounted for the WHOLE overlay, busy included — not `phase ===
        // "outcome"` alone (George r3 P2-1, #491): see the identical comment
        // in `segments-screen.tsx`. A book's zip-of-chapters encode is the
        // long case this matters most for.
        liveRegion={
          shareOverlayOwnsScreen(bookShare.progress) && (
            <span className="sr-only" role="status" aria-live="polite">
              {shareProgressText(bookShare.progress, "book")}
            </span>
          )
        }
      >
        {/* Delete asks here, inside the sheet (#980, G6; #949 D16). The
            ask takes the place of the action list below, which is not drawn
            while it is up; rename cannot be open at the same time, because
            Delete is only reachable from the action list. */}
        {deleteArmed && shareMenuBook && (
          <O4BookDeleteAsk
            name={shareMenuBookName}
            coverHex={shareMenuCoverHex}
            busy={deleting}
            keepRef={keepDeleteRef}
            onKeep={onKeepDelete}
            onDelete={onConfirmDelete}
          />
        )}
        {renamingBook && shareMenuBook ? (
          <>
            {/* Rename the book in place (#264). The store seeds the field with
                the current name so a small fix is an edit, not a retype. */}
            <NameEdit
              initialValue={shareMenuBookName}
              fieldLabel={strings.bookNameField}
              onSave={onSaveBookName}
              onCancel={onCancelRenameBook}
              busy={savingBookName}
            />
            {/* Announced regardless of where focus sits — Enter leaves it on
                the field, not Confirm (George R1 P2, #384). Mirrors Share's
                own `tone="busy"` Notice for the same reason: Confirm's own
                busy mark only reaches a screen reader focused ON it. */}
            {savingBookName && (
              <Notice tone="busy">{strings.savingName}</Notice>
            )}
            {/* A failed rename speaks here — the screen's Notice is behind the
                scrim — while the field stays up for another try.

                Never a DELETE's error, though: `deleteFailed` marks the current
                error as the delete's, and that one already has a labelled home
                on the shelf. Without the guard, failing a delete and then
                opening Rename put the raw store message inside a rename field
                nothing had submitted yet (George stand-in P3-2). `error` here
                is a `strings`-mapped KEY, not the raw store message — an
                add-chapter failure reaching this panel now speaks the same
                mapped copy the shelf's own Notice does (#172 part 1).

                Also never while `savingBookName` (#395 item 1): a retried
                rename flips its own busy Notice on before this one's `finally`
                clears `error` from the PREVIOUS attempt, so a wait and a
                failure shared the panel for one commit — the exact #112
                collision `control-affordance.ts` names as the rule this
                whole busy/Notice wiring follows. `renameBook`/`renameChapter`
                also now clear `error` at the START of the write (see
                `use-books.ts`/`use-chapter-segments.ts`); either half alone
                still leaves the other channel wrong (George, #395). */}
            {error && !deleteFailed && !savingBookName && (
              <Notice>{strings[error]}</Notice>
            )}
          </>
        ) : deleteArmed || shareMenuCoverKey === null ? null : (
          // The book menu (#949, state 04), as the workbench draws it: the
          // book's small cover and name in the head with Rename as its
          // pencil; then Share, the Cover colour tile (#937 D7) and, past a
          // gap, Delete. The open-edge focus lands on Rename, Keep returns to
          // Delete, and the share restore finds the same node. The Cover colour tile swaps the
          // tiles for #957's picker in the same sheet; a choice writes and
          // comes back here.
          <>
            <O4BookHead name={shareMenuBookName} coverHex={shareMenuCoverHex}>
              {!pickingCover && (
                <Control
                  icon="pencil"
                  label={strings.renameBook}
                  size={24}
                  className="o4-head-pen"
                  onClick={() => setRenamingBook(true)}
                />
              )}
            </O4BookHead>
            {pickingCover ? (
              <O4CoverPick
                selected={shareMenuCoverKey}
                onSelect={onChooseCover}
                error={coverFailed ? strings[coverFailed] : null}
              />
            ) : (
              <ShareMenuSection
                status={bookShare.status}
                sendUnconfirmed={bookShare.sendUnconfirmed}
                error={bookShare.error}
                scope="book"
                controlRef={shareControlRef}
                idleLabel={strings.shareBook}
                preparingLabel={strings.shareBookPreparing}
                unconfirmedLabel={strings.shareBookUnconfirmed}
                hasGap={bookShareHasGap}
                gapText={bookShareGapText}
                onPrepare={onPrepareBookShare}
                onSend={onSendBookShare}
                tiles={{
                  after: (
                    <>
                      <CoverTile
                        ref={coverTileRef}
                        coverHex={shareMenuCoverHex}
                        onClick={onOpenCoverPicker}
                      />
                      <TileSpacer />
                      <Tile
                        ref={deleteControlRef}
                        tone="erase"
                        icon="trash"
                        label={strings.deleteBook}
                        caption={strings.tileDelete}
                        onClick={onArmDelete}
                      />
                    </>
                  ),
                }}
              />
            )}
          </>
        )}
      </Menu>

      {/* The share modal (#491), a sibling of the book menu — see the Segments
          screen for why: it outlives the menu's close, and `send()` resolves
          only after its outcome glyph has cleared. `onCancel` is wired to
          `bookShare.reset` directly, not `onCloseShareMenu` (George r1 P2
          #1/#2) — see `onCloseShareMenu`'s own comment. */}
      <ShareProgress
        progress={bookShare.progress}
        scope="book"
        items={shareMenuBook ? bookShareItems(shareMenuBook.chapters) : []}
        onCancel={bookShare.reset}
        onDismiss={bookShare.dismissProgress}
      />
      {/* Share your work's modal (#1045): the same overlay, library scope.
          No wrapping needed on Cancel/Dismiss (#1056): both end in
          `ownsScreen()` going false, which the auto-close effect above
          already closes the layer for — the one closing path, whether a tap
          or the outcome's own hold ends the timeline. */}
      <ShareProgress
        progress={libraryShare.progress}
        scope="library"
        error={libraryShare.error}
        onCancel={libraryShare.reset}
        onDismiss={libraryShare.dismissProgress}
      />
    </div>
  );
}

/**
 * The screen's half of the chapter reorder (#953 PR2b), handed to every
 * `BookItem`: each open book runs its own gesture over its own rows, and all
 * of them share the one write, the one live region and the focus hand-off.
 */
interface ChapterReorder {
  readonly enabled: boolean;
  /** The shelf's scrolling container. */
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** Each chapter row's `<li>`, from the screen's row registry. */
  readonly nodeFor: (id: string) => HTMLElement | null;
  readonly onLift: (row: ChapterRow) => void;
  /** The one write: `row` was released at `toIndex` among its book's rows. */
  readonly onDrop: (row: ChapterRow, toIndex: number) => void;
  /** A lifted row was put back without a write. */
  readonly onCancel: (row: ChapterRow) => void;
}

interface BookItemProps {
  book: BookCard;
  expanded: boolean;
  onToggle: () => void;
  onNewChapter: () => void;
  onOpenShareMenu: () => void;
  onOpenChapter: (chapterId: ChapterId) => void;
  /** This book's `+` is the guided step (#604). */
  guidedAddChapter: boolean;
  /**
   * This book's expand toggle is the guided step (#604) — the chapter row the
   * chain wants is inside a list this book has closed.
   */
  guidedToggle: boolean;
  /** The chapter row that is the guided step, if it is one of this book's. */
  guidedChapterId: ChapterId | null;
  setNode: (id: string, el: HTMLElement | null) => void;
  reorder: ChapterReorder;
  /**
   * Press-and-hold reorder of the book itself (#338): the shelf's
   * `onPointerDown` for this book's row. The whole row button — cover and
   * name — is the hold area; a tap released before the hold still opens or
   * closes the book.
   */
  onHoldStart?: (e: ReactPointerEvent) => void;
  /** This book is the one lifted. */
  lifted: boolean;
  /** Its paint offset while a book is lifted, in px; `null` when none is. */
  reorderY: number | null;
}

function BookItem({
  book,
  expanded,
  onToggle,
  onNewChapter,
  onOpenShareMenu,
  onOpenChapter,
  guidedAddChapter,
  guidedToggle,
  guidedChapterId,
  setNode,
  reorder,
  onHoldStart,
  lifted,
  reorderY,
}: BookItemProps) {
  const listId = `chapters-${book.bookId}`;
  // This book's chapter reorder (#953 PR2b): the Segments list's gesture over
  // this card's rows. Collapsing the book switches it off, which lets go of a
  // row in hand without a write.
  const gesture = useReorderGesture<ChapterId>({
    enabled: reorder.enabled && expanded,
    ids: book.chapters.map((chapter) => chapter.chapterId),
    nodeFor: reorder.nodeFor,
    scrollRef: reorder.scrollRef,
    onLift: (index) => {
      const row = book.chapters[index];
      if (row) reorder.onLift(row);
    },
    onDrop: (chapterId, _fromIndex, toIndex) => {
      const row = book.chapters.find((c) => c.chapterId === chapterId);
      if (row) reorder.onDrop(row, toIndex);
    },
    onCancel: (index) => {
      const row = book.chapters[index];
      if (row) reorder.onCancel(row);
    },
  });
  const drag = gesture.drag;
  // The facilitator's name (#264), else the placeholder its slot renders
  // (#169) — `ChapterItem`'s `heading` one level up the tree.
  const heading = strings.bookHeading(book.name, book.number);
  return (
    <li
      className={cn("books-card", lifted && "books-card-lifted")}
      ref={(el) => setNode(book.bookId, el)}
      style={
        reorderY === null
          ? undefined
          : ({ "--reorder-y": `${reorderY}px` } as CSSProperties)
      }
    >
      <div className="books-card-head">
        <button
          type="button"
          onClick={onToggle}
          onPointerDown={onHoldStart}
          // The book's hold area (#338). The card already keeps a long press
          // from selecting text or raising the phone's callout
          // (`o4/books.css`, `.books-card`).
          data-reorder-handle={onHoldStart ? "" : undefined}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={strings.bookRow(heading, book.chapters.length, expanded)}
          // The toggle carries the guide class itself, like the chapter row —
          // it is a plain button, not a `Control`.
          className={cn("books-card-hit", guidedToggle && "is-guided")}
        >
          <>
            {/* The cover, in the book's own colour (#957): the stored key,
                  or #957's id-derived fallback, both through
                  `resolveCoverKey`. The hex reaches the stylesheet as a
                  custom property set inline — the one way a per-book colour
                  can get there, and the boundary `cover-picker.tsx` already
                  draws for its swatches: a cover colour is the book's
                  identity, not a themed role (`lib/cover-colour.ts`'s
                  docblock argues it). Every other colour on the card is a
                  layer-2 role in `o4/books.css`. */}
            <span
              className="books-cover"
              aria-hidden="true"
              style={
                {
                  "--book-cover": coverColourHex(
                    resolveCoverKey({
                      id: book.bookId,
                      coverColourKey: book.coverColourKey ?? null,
                    })
                  ),
                } as CSSProperties
              }
            >
              <Icon
                name={expanded ? "book-open" : "book"}
                size={expanded ? 36 : 34}
              />
            </span>
            <span className="books-name" dir="auto">
              {heading}
            </span>
          </>
        </button>
        <Control
          icon="plus"
          label={strings.addChapter(heading)}
          variant="quiet"
          className="books-ghost"
          guided={guidedAddChapter}
          onClick={onNewChapter}
        />
        {/* Overflow ⋮ after the + distinguishes this object menu from the
            global menu (#589). The new-book focus hand-off targets the row's toggle
            button above, not either Control (George R4 P2-1) — this ordering
            is no longer load-bearing for that hand-off, only for the
            read/visual order: expand, add, manage. */}
        <Control
          icon="more"
          label={strings.bookMenuOpen(heading)}
          variant="quiet"
          className="books-ghost"
          onClick={onOpenShareMenu}
        />
      </div>

      {expanded && (
        <ul
          id={listId}
          className="books-chapters"
          data-reordering={drag ? "" : undefined}
        >
          {book.chapters.map((chapter, index) => (
            <ChapterItem
              key={chapter.chapterId}
              chapter={chapter}
              onOpen={() => onOpenChapter(chapter.chapterId)}
              guided={chapter.chapterId === guidedChapterId}
              setNode={setNode}
              onHoldStart={gesture.holdStart(index)}
              lifted={drag?.fromIndex === index}
              // While a row is lifted: it follows the finger and the rows
              // between its slot and the target slide one slot to make room.
              // Paint only; the order is not touched until the drop.
              reorderY={
                drag
                  ? drag.fromIndex === index
                    ? drag.offset
                    : reorderShift(index, drag.fromIndex, drag.toIndex) *
                      drag.pitch
                  : null
              }
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface ChapterItemProps {
  chapter: ChapterRow;
  onOpen: () => void;
  /** This row is the guided step (#604). */
  guided: boolean;
  setNode: (id: string, el: HTMLElement | null) => void;
  /**
   * Press-and-hold reorder (#953 PR2b): the book's `onPointerDown` for this
   * row. The whole row button is the hold area, as in the
   * workbench; a tap released before the hold still opens the chapter.
   */
  onHoldStart?: (e: ReactPointerEvent) => void;
  /** This row is the one lifted. */
  lifted: boolean;
  /** Its paint offset while a row is lifted, in px; `null` when none is. */
  reorderY: number | null;
}

function ChapterItem({
  chapter,
  onOpen,
  guided,
  setNode,
  onHoldStart,
  lifted,
  reorderY,
}: ChapterItemProps) {
  // The passage label the facilitator set (#264), else "Chapter {number}".
  const heading = strings.chapterHeading(chapter.name, chapter.number);
  return (
    <li
      ref={(el) => setNode(chapter.chapterId, el)}
      className={lifted ? "books-lifted" : undefined}
      style={
        reorderY === null
          ? undefined
          : ({ "--reorder-y": `${reorderY}px` } as CSSProperties)
      }
    >
      <button
        type="button"
        onClick={onOpen}
        onPointerDown={onHoldStart}
        // `o4/books.css` reads it to keep a long press from selecting text
        // or raising the phone's callout.
        data-reorder-handle={onHoldStart ? "" : undefined}
        aria-label={strings.openChapter(heading)}
        // The row is a plain button rather than a `Control`, so it carries the
        // guide class itself; the ring is drawn inside its own box, which is
        // what keeps it out of the scroll container's clip (3-components.css).
        className={cn("books-chapter", guided && "is-guided")}
      >
        <O4ChapterFace chapter={chapter} />
      </button>
    </li>
  );
}

/**
 * The chapter row's face (#942, state 03): the number in a 44 badge, the
 * chapter's title line, one progress dot per segment, and a chevron.
 *
 * All of it is decoration — the row button's own name (`strings.openChapter`)
 * already carries the heading, typed title included — so each part is
 * `aria-hidden` and nothing here enters the reading order.
 *
 * The title line is the chapter's heading (`strings.chapterHeading`): the name
 * the facilitator typed (`Chapter.name`, #264), or the default "Chapter N" the
 * New Chapter prompt offered (#609) when it has none. A chapter always has a
 * name to show (#1219), so the line is always drawn and the badge always steps
 * back behind it, as the design reference's §3 and §7 describe for a titled
 * row. The default is derived here at read time rather than stored, so a
 * reorder (#953) renumbers it with the badge. A title that was only spoken is
 * tier 2 (after the training) and is not drawn here.
 */
function O4ChapterFace({ chapter }: { chapter: ChapterRow }) {
  const dots = dotStates(chapter);
  const [size, gap] = dotFit(dots.length, TITLED_DOT_ROOM);
  return (
    <>
      <span className="books-chapter-num is-dim" aria-hidden="true">
        {chapter.number}
      </span>
      <span className="books-chapter-mid" aria-hidden="true">
        <span
          className="books-chapter-title"
          dir={chapter.name === null ? undefined : "auto"}
        >
          {strings.chapterHeading(chapter.name, chapter.number)}
        </span>
        <span
          className="books-dots"
          style={
            {
              "--dot": `${size}px`,
              "--dot-gap": `${gap}px`,
            } as CSSProperties
          }
        >
          {dots.map((state, i) => (
            <i key={i} data-state={state} />
          ))}
        </span>
      </span>
      <span className="books-chapter-go" aria-hidden="true">
        <Icon name="chevron-right" size={28} />
      </span>
    </>
  );
}

/**
 * One dot per segment: finished, then recorded, then empty.
 *
 * GROUPED, not in segment order. The shelf's row carries counts
 * (`finishedCount`, `recordedCount`, `totalCount`, from `chapterProgress` in
 * `lib/storage/books.ts`), not each segment's state, so the dots read as a
 * progress bar split into segments rather than as a map of which segment is
 * which. The workbench draws them in segment order; that needs a per-segment
 * read the shelf does not make today.
 *
 * `recordedCount` counts segments holding a take, finished ones included, so
 * the recorded-but-not-finished dots are the difference, clamped to what is
 * left after the finished ones.
 */
function dotStates(chapter: ChapterRow): SegmentRowState[] {
  const { finishedCount, recordedCount, totalCount } = chapter;
  const finished = Math.min(finishedCount, totalCount);
  const recorded = Math.max(
    0,
    Math.min(recordedCount - finishedCount, totalCount - finished)
  );
  return [
    ...Array<SegmentRowState>(finished).fill("finished"),
    ...Array<SegmentRowState>(recorded).fill("recorded"),
    ...Array<SegmentRowState>(totalCount - finished - recorded).fill("empty"),
  ];
}

/**
 * The dots' column on the narrowest supported phone, in px — the width the
 * fit is computed against, so the dots never outgrow the 44px middle column
 * at any supported width (a wider column only ever wraps onto fewer rows).
 * The design reference's 206 is the column's cap (`.books-dots` max-width),
 * not a width a phone is guaranteed to give: at 360px the chain below leaves
 * 194.
 *
 * 320 (the narrowest width this repo supports, `e2e/edit-history-cue.spec.ts`)
 * − 2 × 8 (`.app-shell`'s side padding, `--p-space-3`)
 * − 2 × (10 + 1) (`.books-card`'s padding and border)
 * − (12 + 16) (`.books-chapter`'s left and right padding)
 * − 44 (`.books-chapter-num`) − 2 × 14 (the row's two gaps)
 * − 28 (the chevron) = 154. `tests/books-o4.test.ts` re-derives it from the
 * stylesheets.
 */
const DOT_COLUMN = 154;
/** Size/gap steps, largest first (the design reference, §3). */
const DOT_STEPS: readonly (readonly [number, number])[] = [
  [13, 6],
  [11, 5],
  [9, 4],
  [7, 3],
  [5, 2],
];

/**
 * The dots' height under the title line, in px: the 44px middle column less
 * the 20px title line and its 5px gap. Every row has the title line since
 * #1219, so this is the only height the fit is asked for.
 */
const TITLED_DOT_ROOM = 19;

/**
 * The size and gap of a chapter row's dots, in px: the largest step whose
 * wrapped rows fit in `height` ({@link TITLED_DOT_ROOM}). Past what the
 * smallest step can hold, the smallest step is returned anyway and the dots
 * wrap onto more rows: the row's height is a floor, not a cap
 * (`o4/books.css`, #1229), so it grows rather than clipping a dot. The
 * workbench's steps, fitted against {@link DOT_COLUMN} rather than the
 * workbench's 206.
 */
function dotFit(count: number, height: number): readonly [number, number] {
  for (const step of DOT_STEPS) {
    const [size, gap] = step;
    const perRow = Math.floor((DOT_COLUMN + gap) / (size + gap));
    const rows = Math.ceil(count / perRow);
    if (rows * (size + gap) - gap <= height) return step;
  }
  return DOT_STEPS[DOT_STEPS.length - 1]!;
}
