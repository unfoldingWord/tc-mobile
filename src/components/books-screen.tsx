import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { EMPTY_STATE_NODE, focusTargetAfterDelete } from "./delete-focus";
import { EmptyState } from "./empty-state";
import { EraseConfirm } from "./erase-confirm";
import { FailureLogPanel } from "./failure-log-panel";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { encoderNotice } from "./encoder-notice";
import {
  shareErrorText,
  shareGapText,
  shareProgressText,
} from "./share-error-copy";
import { shareErrorGlyph, shareOutcomeGlyph } from "./share-outcome-glyph";
import { ShareProgress } from "./share-progress";
import { strings } from "./strings";
import { useFailureCount } from "@/hooks/failure-log";
import { encoderHealth, subscribeToEncoderHealth } from "@/hooks/mp3-codec";
import { shareOverlayOwnsScreen } from "@/hooks/share-progress";
import { readSharePlatform } from "@/hooks/share-target";
import { useBookShare } from "@/hooks/use-book-share";
import { useBooks } from "@/hooks/use-books";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import {
  useScreenLayers,
  type ScreenLayerBehavior,
} from "@/hooks/use-screen-layers";
import { useStoragePersistence } from "@/hooks/use-storage-persistence";
import { useTheme } from "@/hooks/use-theme";
import type { Layer } from "@/lib/nav/layer-stack";
import { cn } from "@/lib/utils";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * Every overlay this screen can put over the shelf, as a system-Back layer
 * (#452 PR3, #374). The union is what makes `useScreenLayers`' behaviour
 * record total — a row added here with no behaviour, or a behaviour for an id
 * that no longer exists, is a `tsc` error rather than a Back that silently
 * does nothing.
 *
 * Five, matching the design's "PR3 — Books' overlays" (the book ≡ menu and its
 * rename mode are ONE overlay: rename is a mode inside the same panel, so it
 * opens no second layer and Back from the rename field closes the menu, just
 * as the panel's own Close does).
 *
 * `books:log-clear-confirm` is the one the design's overlay catalogue does not
 * list: `FailureLogPanel`'s Clear confirm (#205) portals OVER the global menu
 * rather than replacing it, so it is a genuine second layer. Left unregistered,
 * a Back with it up would have dismissed the global menu UNDERNEATH it and left
 * the confirm standing over nothing.
 *
 * NOT a layer: `<ShareProgress>` (#491). It goes up and comes down on the share
 * flow's own timeline (a minimum hold, then an outcome hold) rather than on any
 * click, so registering it would mean popping a layer from a timer — an effect,
 * which invariant 6 forbids. It is folded into the book ≡ menu's `busy()`
 * instead, which is what Amendment D asks for and is also exactly right: the
 * overlay's whole lifetime is the window in which that menu's own close is a
 * no-op (`onCloseShareMenu`'s early return), so Back must refuse rather than
 * run a `dismiss()` that does nothing.
 */
type BooksLayerId =
  | "books:global-menu"
  | "books:log-clear-confirm"
  | "books:new-book"
  | "books:book-menu"
  | "books:delete-confirm";

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
    newBookPlaceholder,
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
  // Durable storage (#12). A book exists only because a write committed, so a
  // successful shelf read that finds one is "after the first successful write"
  // reached from the read side — the trigger the hook's docblock explains. The
  // marker is non-null only when the browser explicitly said it has NOT
  // promised to keep this data, THIS render still has a book on the shelf (a
  // delete back to empty must not leave a stale warning up, George R1 P2-1),
  // and the app is not the Capacitor training shell (native storage is not
  // evicted the same way; `lib/storage/persistence.ts`). Unknown (no API, a
  // rejected query) says nothing.
  const storage = useStoragePersistence(loaded && books.length > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  // #171. The global menu is the only place a theme switch belongs: it is a
  // once-per-session decision about the light you are standing in, not a
  // per-screen action, and putting it in the header would spend a header slot
  // on a control nobody taps twice a day.
  const theme = useTheme();
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
  // Both halves of Try again, in one handler so a later edit cannot drop one:
  // re-read the shelf, and hand the failure count's ladder back.
  const onRetryShelf = useCallback(() => {
    setFailureRetryToken((t) => t + 1);
    reload();
  }, [reload]);
  // The New Book dialog (#314). `null` is closed; a string is open, and IS the
  // value the name field is seeded with — the "Book NNN" placeholder the hook
  // derives from the loaded shelf. Held as the seed rather than a boolean so the
  // field's starting text and the dialog's open state cannot disagree, so each
  // open remounts `NameEdit` with a fresh seed (Menu unmounts its children when
  // closed, which is what resets a half-typed name), and so Confirm can tell an
  // untouched field from a typed one.
  const [newBookSeed, setNewBookSeed] = useState<string | null>(null);
  // A failed create, scoped to THIS dialog. Not the hook's shared `error`: that
  // channel also carries an addChapter or rename failure, which would then be
  // announced (Notice is `role="alert"`) inside a New Book dialog that has not
  // failed at anything — on the one-tap create path, to someone who may not read
  // the words disowning it (Frank R1 P3, George R1 P2-2).
  const [newBookError, setNewBookError] = useState<string | null>(null);
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
  // Cleared on a successful create, where `pendingFocus` takes over instead.
  const newBookReturnFocus = useRef<HTMLElement | null>(null);
  // Share Book (B7): the per-book ≡ menu. Which book's menu is open, and one
  // share flow for the screen — only one menu is open at a time (its scrim blocks
  // reaching a second row's trigger), so a single flow is enough. `shareMenuBook`
  // resolves the id back to a row, auto-closing the menu if that book vanishes.
  const [shareMenuBookId, setShareMenuBookId] = useState<BookId | null>(null);
  // Whether the open book ≡ menu is in rename mode (the name field showing) or
  // its action list. Resets to the action list every time the menu closes.
  const [renamingBook, setRenamingBook] = useState(false);
  // The rename write is in flight (#383) — forwarded to NameEdit's Confirm as
  // `busy`. Reset to `false` at every site that bumps `bookMenuSession` (open,
  // close, arm-a-share) as well as on settle: a still-pending rename for book
  // A left this `true` across a menu close, so opening book B's ≡ showed B's
  // FRESH Confirm as busy before B's own Save was ever tapped (Frank r1,
  // #384) — a session-token comparison would fix it too, but reading
  // `bookMenuSession.current` (a ref) during render to compare against is
  // banned (`react-hooks/refs`), so the reset instead happens at each place
  // that already advances the session.
  const [savingBookName, setSavingBookName] = useState(false);
  // The same flag as a live ref (#452 PR3, the design's F4). `savingBookName`
  // above is last render's answer and drives NameEdit's `busy`; this is what
  // the book-≡ menu's `Layer.busy()` reads, because the system-Back handler
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
  // `shareMenuBookId` because tapping Delete closes the ≡ menu — mirroring the
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
  // Per-viewer UI state, so it lives here and not on disk. Collapsed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<BookId>>(new Set());
  // What to scroll to once the list next reloads — a freshly made book or
  // chapter. A ref, not state: creating one patches `books` directly (no
  // `reload()` needed — see `useBooks.createBook`/`addChapter`, George R4
  // P2-2), so the `books` change already re-renders us; clearing a ref here
  // avoids a setState-in-effect cascade.
  const pendingScroll = useRef<string | null>(null);
  // The empty-state CTA unmounts on the create it triggers. Without this, focus
  // falls to the document and the first header stop takes over — on a chapter
  // that would be Back, one activation from leaving. Hand focus to the new row.
  const pendingFocus = useRef<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  const setNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

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
  // unregisters the layer and releases the entry protecting it, leaving the
  // overlay on screen with the next Back walking out of the app (#494 item 3).
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
    setNewBookError(null);
    return true;
  }, []);

  /**
   * Closing the book ≡ menu (scrim, Escape, close button, a system Back) ends
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
   * unregisters the layer and releases its history entry while the menu stays
   * open. One source, no window.
   */
  const closeBookMenuState = useCallback(() => {
    if (bookShare.ownsScreen()) return false;
    bookMenuSession.current += 1;
    setShareMenuBookId(null);
    setRenamingBook(false);
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
   */
  const closeDeleteConfirmState = useCallback(() => {
    if (deleteTargetId !== null) pendingFocus.current = deleteTargetId;
    setDeleteTargetId(null);
  }, [deleteTargetId]);

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
    "books:delete-confirm": {
      // The same live ref `deleteBook` flips to refuse a second Confirm, so
      // Back and Confirm agree about "in flight" by construction.
      busy: isDeleting,
      dismiss: closeDeleteConfirmState,
    },
  });

  // The global menu's ONE open and ONE close. Every entry point — the ≡, the
  // panel's Close, Escape, a scrim tap, the log panel's `onDone` — goes through
  // this pair, so no call site can forget the registration.
  const openGlobalMenu = useCallback(() => {
    setMenuOpen(true);
    layers.open("books:global-menu");
  }, [layers]);
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

  useEffect(() => {
    const id = pendingScroll.current;
    if (id !== null) {
      nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
      pendingScroll.current = null;
    }
    const focusId = pendingFocus.current;
    // HOLD the hand-off while the delete confirm is up. The shelf is `inert`
    // then (see the wrapper below), and an element inside an inert subtree
    // cannot take focus at all — so focusing here would be a silent no-op and
    // the pending target would be consumed and lost. `deleteTargetId` going
    // null is exactly the moment `inert` comes off, and it is in this effect's
    // deps, so the hand-off runs on that render instead. This is the repo's own
    // lesson, learned twice: a focus fix that ignores `inert` is dead code
    // (#364; docs/progress_tracker.md).
    if (focusId !== null && deleteTargetId === null) {
      // The row's first <button> is the expand/collapse toggle. Landing here
      // instead of the add-chapter Control is a DELIBERATE step back from an
      // earlier round: targeting `.control` put a live, activating native
      // button under focus as the direct continuation of Confirm's own Enter
      // — and a still-held Enter key-repeats `click` on whatever is focused,
      // so a facilitator holding Enter through Confirm wrote MULTIPLE
      // undeletable chapters before the per-book latch could catch up (the
      // latch only stops OVERLAPPING calls; it releases the instant each
      // write resolves, and a `put` is typically faster than OS key-repeat —
      // George R4 P2-1). A stray re-activation of the toggle just re-collapses
      // the row — visible immediately, undone by one more tap, and it writes
      // nothing — so it is the safe landing spot even though Add-chapter is
      // the more useful one Tab further on.
      nodes.current.get(focusId)?.querySelector<HTMLElement>("button")?.focus();
      pendingFocus.current = null;
    }
    // Keyed on ALL THREE: `books` covers create/add-chapter and a successful
    // delete, `deleteTargetId` covers the render on which the delete confirm
    // comes down, and `newBookSeed` covers the render on which the New Book
    // dialog closes. A create now inserts the row into `books` (in the hook)
    // and closes the dialog (here) as two setStates in one async continuation;
    // React batches those into a single commit, but this hand-off must not
    // DEPEND on that — if they ever split, the `books` render would run this
    // effect before the refs below were set and the focus would be lost for
    // good. Re-running on either close edge makes the order irrelevant; a run
    // with nothing pending is a no-op.
  }, [books, deleteTargetId, newBookSeed]);

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
  // hamburger or a row's ≡ sits one tap away, which is how two `aria-modal`
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
    setNewBookSeed(newBookPlaceholder);
    // Registered in the SAME handler that opens it (invariant 6), and after
    // the state above for the same reason that ordering is documented as
    // unobservable in `use-nav-stack.ts`'s `openChapter`: the layer is on the
    // stack before this gesture returns either way.
    layers.open("books:new-book");
  }, [layers, newBookPlaceholder]);

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
  // render that removes `inert`. A create clears the ref, because `pendingFocus`
  // hands focus to the new row's toggle button instead (George R5 P3 — this
  // comment used to say "add-chapter control", which is what an earlier round
  // targeted before George R4 P2-1 moved the landing to the toggle; see the
  // `pendingFocus` effect above for why).
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
      // the store derive the name INSIDE its write transaction — the one-tap
      // create the corner + used to be, race-safety and all. Sending the
      // rendered string instead would take the supplied-name path, which is
      // deliberately never made unique: two documents open on the same shelf
      // both render "Book 001" and would both write it (George R1 P2-3).
      //
      // Compared TRIMMED, because the caret lands in the pre-filled text and a
      // stray trailing space would otherwise slip "Book 001 " down the supplied
      // path — trimmed to the same duplicate this mapping exists to prevent
      // (George R2 P3-5). A genuinely typed name goes through as typed; a blank
      // or whitespace-only one is not an error either and lands on the same
      // fallback, in the store.
      const name = typed.trim() === newBookSeed ? "" : typed;
      const outcome = await createBook(name);
      if (!outcome.ok) {
        // A failed create keeps the dialog OPEN with the reason in its own
        // Notice — the screen's Notice sits behind the scrim — and the typed
        // name stays in the field for another try. Releasing the latch here, and
        // only here, is what makes that retry (and Cancel) work again.
        creatingBook.current = false;
        setCreatingBookBusy(false);
        setNewBookError(outcome.message);
        return;
      }
      const { book } = outcome;
      newBookReturnFocus.current = null;
      setNewBookSeed(null);
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
      pendingScroll.current = book.id;
      pendingFocus.current = book.id;
      // No `finally`: on success the latch stays held until the next open edge.
      // See its declaration — releasing it here reopens the double-create window
      // between the write resolving and the panel actually unmounting.
    },
    [createBook, layers, newBookSeed]
  );

  const onNewChapter = useCallback(
    async (bookId: BookId) => {
      const chapter = await addChapter(bookId);
      if (!chapter) return; // failed create surfaced through the hook's Notice
      setExpanded((prev) => new Set(prev).add(bookId));
      pendingScroll.current = chapter.id;
    },
    [addChapter]
  );

  // The book whose ≡ menu is open, resolved from the shelf. `null` closes the
  // menu — including if the book is gone by the time this render runs.
  const shareMenuBook = books.find((b) => b.bookId === shareMenuBookId) ?? null;
  // Open a book's ≡ menu, ending any prior menu session so a rename still in
  // flight from the previous one cannot close this one.
  const onOpenShareMenu = useCallback(
    (bookId: BookId) => {
      bookMenuSession.current += 1;
      setShareMenuBookId(bookId);
      // A different book's still-pending rename must not show THIS book's fresh
      // Confirm as busy before it has even been tapped (Frank r1, #384).
      setSavingName(false);
      layers.open("books:book-menu");
    },
    [layers, setSavingName]
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
  // Back; making it a silent no-op is what sends them there. **That asymmetry
  // is gone as of #452 PR3, which is what #374 and #393 were waiting for:**
  // system Back now routes through this menu's own `Layer`, so both exits obey
  // the same `busy()`. Whether a rename in flight should be one of the
  // conditions that refuses them is #452 open question 7, for the requirements
  // owner — the mechanism no longer prejudges it.
  const onCloseShareMenu = useCallback(() => {
    if (closeBookMenuState()) layers.close("books:book-menu");
  }, [closeBookMenuState, layers]);
  // Commit the typed book name (#264), then close the menu on success. A failed
  // write keeps the menu open with the reason in its own Notice — the screen's
  // Notice sits behind the scrim, so a rename needs a channel inside the panel.
  const onSaveBookName = useCallback(
    (name: string) => {
      if (!shareMenuBookId) return;
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
      void renameBook(shareMenuBookId, name)
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
    [renameBook, setSavingName, shareMenuBookId, onCloseShareMenu]
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
  // The overlay's own capture/restore pair (#96/#97, George r2 P2-1, #491) —
  // see `segments-screen.tsx`'s own copy of this comment for why capture must
  // happen synchronously in the tap handlers below, never from an effect.
  const focusRestore = useFocusRestore();
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
    void bookShare.prepare(
      shareMenuBook.bookId,
      strings.shareBookFilename(shareMenuBook.name),
      (n) => strings.shareFilename(shareMenuBook.name, n)
    );
  }, [focusRestore, bookShare, setSavingName, shareMenuBook]);
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
  // Share speaks inside its own menu, not the shelf: the two-gesture flow keeps
  // the menu open across prepare → ready → send. Map its error code to copy here.
  const bookShareErrorText = shareErrorText(bookShare.error, "book");
  const sharePartial = shareOutcomeGlyph("partial");
  // Mark and tone for the error line, from the same table (#178); `undefined`
  // for `encoder` and for no error, which is `Notice`'s own default.
  const bookShareErrorMark = shareErrorGlyph(bookShare.error);
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
    { missing: bookShare.missing, partial: bookShare.partialSegments },
    "book"
  );
  // The Share Control's glyph/variant/busy across idle → preparing → ready
  // (#354) — the same table Share Chapter and NameEdit's Confirm use, so
  // "busy" and "ready" never borrow each other's mark or Confirm's. Its idle
  // mark is the platform's own (#490), read from the Capacitor runtime.
  const bookShareAffordance = shareControlAffordance(
    bookShare.status,
    readSharePlatform(),
    bookShare.sendUnconfirmed
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
  // Cancel / Escape / scrim — see `closeDeleteConfirmState` above, plus the
  // layer. A system Back reaches the state half directly (the adapter
  // unregisters the layer itself), so both exits end in the same place.
  const closeDeleteConfirm = useCallback(() => {
    closeDeleteConfirmState();
    layers.close("books:delete-confirm");
  }, [closeDeleteConfirmState, layers]);
  // The book underneath the confirm can also vanish WITHOUT going through
  // this screen's own delete flow — a second tab or a pre-`autoUpdate` page
  // deleting it, the same shape `reportUnlessStale` (`use-books.ts`) guards
  // against. `deleteTarget` resolving to null already takes the dialog and
  // `inert` down (both now key off `deleteTargetId` directly, below), but
  // nothing cleared `deleteTargetId` itself, so the focus hold stayed latched
  // with no confirm left to close it and no `pendingFocus` ever recorded —
  // silently swallowing the NEXT hand-off too (George R10 P2-3).
  //
  // The setState is pushed past a microtask so it is not SYNCHRONOUS within
  // the effect body — `react-hooks/set-state-in-effect` flags exactly that
  // shape, and refs (`pendingFocus`, `armedShelf`) may not be read or written
  // during render (`react-hooks/refs`), which rules out doing this inline in
  // the render body instead. Matches how every other effect in this hook
  // already only calls its setters from inside an async callback (the load
  // effect's `void (async () => { ... })()`, below).
  useEffect(() => {
    if (deleteTargetId === null || deleteTarget !== null) return;
    const targetId = deleteTargetId;
    void Promise.resolve().then(() => {
      pendingFocus.current = focusTargetAfterDelete(
        "ok",
        targetId,
        armedShelf.current
      );
      setDeleteTargetId(null);
      // The confirm comes down here without any tap, so its layer has to come
      // down here too — a registered layer whose overlay is gone is #494 item
      // 3's trap, and this path is the one way to reach it on Books.
      //
      // This is an EFFECT closing a layer, which invariant 6 does NOT forbid:
      // what it forbids is REGISTRATION keyed on an effect, because that is
      // what an unstable dependency can fire spuriously. Both deps here are
      // plain state values and `layers` is memoized (`use-screen-layers.ts`),
      // so there is no hook-returned object literal to destabilise the array —
      // the round-6 P1 shape cannot occur.
      layers.close("books:delete-confirm");
    });
  }, [deleteTarget, deleteTargetId, layers]);
  // Arm the confirm from the ≡ menu, closing the menu first — the same shape as
  // the Segments row menu, where Erase closes the row menu and the screen owns
  // the target. `shareMenuBookId` is read BEFORE the close clears it.
  // Arm the confirm from the ≡ menu, closing the menu through the ONE close path
  // — which resets the share.
  //
  // Round 4 tried to keep an armed zip alive across the confirm, so Cancel would
  // not cost a whole-book encode (George R4 P2-3). That broke the invariant the
  // unchanged share hook is written on: `useBookShare` is one screen-level flow
  // with NO owning bookId, and its `preparing`/`ready` state is only ever safe
  // because every menu close resets it. With it kept alive, opening ANOTHER
  // book's ≡ rendered that book's menu off the first book's flow — "Share now"
  // there would hand Practice's archive to the share sheet from Mark's menu
  // (Frank R5 P2 and George R5 P2-1, raised independently), and resetting at
  // confirm-time instead threw away a ready zip of a book still on disk whenever
  // the delete then failed (George R5 P2-2).
  //
  // Two new P2s from one accommodation is the siblings signal, not a chain: the
  // approach is wrong, not the details. So this returns to the behaviour that
  // stood clean through rounds 1-3, and giving the share flow an owning bookId —
  // which is what would make R4 P2-3 safely fixable — is #363, its own change to
  // its own unchanged code.
  const onArmDelete = useCallback(() => {
    // No `shareOverlayOwnsScreen` guard here any more (#491): Delete sits
    // inside the panel's `inert` subtree (see `<Menu>`'s own `inert` prop
    // below), so it is unreachable by click, keyboard or AT activation for
    // the whole time the guard used to check — the primitive covers it now,
    // not a per-handler check.
    const bookId = shareMenuBookId;
    // Registered BEFORE the menu's own layer is unregistered, so the floor's
    // layer stack never passes through empty on the way (#452 PR3). It would
    // otherwise release the floor entry and immediately re-arm it — a
    // `pushState` issued behind a `history.back()` that has not landed, which
    // is exactly the coalescing/desync hazard `travel-guard.ts` exists to keep
    // out of this adapter. Going 1 → 2 → 1 instead, the entry never moves.
    // The React state below still closes the menu and opens the confirm in the
    // order it always did; only the two registrations are interleaved.
    layers.open("books:delete-confirm");
    onCloseShareMenu();
    // Captured NOW, while the row this confirm targets is still on screen —
    // the auto-close effect above needs this "before" shelf, because by the
    // time it detects the vanish, `books` has already moved on without it.
    armedShelf.current = books.map((b) => b.bookId);
    setDeleteTargetId(bookId);
  }, [books, layers, onCloseShareMenu, shareMenuBookId]);
  const onConfirmDelete = useCallback(() => {
    if (deleteTargetId === null) return;
    // The shelf order as it is right now, captured while the row is still on
    // screen — `focusTargetAfterDelete` needs it to name the row that will take
    // this one's place.
    const shelfBefore = books.map((b) => b.bookId);
    // No share reset here: arming the confirm already closed the menu through
    // `onCloseShareMenu`, which reset it. Resetting again at confirm time is what
    // George R5 P2-2 caught — the store write is fallible, so on a failed delete
    // it would discard a ready zip of a book that is still on disk.
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
      // failure the row survives but the confirm carrying the focused Cancel
      // unmounts, so it falls to the document just the same. Which node each
      // case wants is decided by `focusTargetAfterDelete`, which is pure and has
      // a test table — the ordering below is the half no test here can observe.
      pendingFocus.current = focusTargetAfterDelete(
        result,
        deleteTargetId,
        shelfBefore
      );
      setDeleteTargetId(null);
      // Both outcomes take the confirm down, so both take its layer down.
      // `"busy"` returned above the `if`s, leaving both standing — which is
      // right: the first delete still owns them.
      layers.close("books:delete-confirm");
    })();
  }, [books, deleteBook, deleteTargetId, layers]);

  // `deleteFailed` only ever RELABELS the hook's current error — they are one
  // state there, so the label cannot outlive what it labels. A *reload* no
  // longer takes this line down (it would race the delete's own error off the
  // screen); what clears it is another delete, or any write that succeeds
  // (George R4 P2-2 / Frank R4 P2).
  const noticeText = deleteFailed ? strings.deleteBookFailed : error;

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

  return (
    // While the menu is open, take the whole shelf chrome — New Book included —
    // out of the focus/pointer tree for AT/switch users, matching how Segments
    // inerts behind its dialogs (G8: aria-modal alone is not trusted to hide the
    // background). The Menu portals to <body>, so it stays live above this (#77).
    <div
      className="flex h-full flex-col gap-[14px]"
      inert={
        menuOpen ||
        shareMenuBook !== null ||
        deleteTargetId !== null ||
        newBookSeed !== null ||
        // The share overlay joins the shelf's inert conditions (George r1 P2
        // #1/#2, #491): AT gesture navigation does not dispatch the `Tab`
        // keydowns `<ShareProgress>` intercepts, so this is what keeps that
        // path off the shelf/New Book while the overlay is up — including
        // through the outcome hold, after `shareMenuBook` may already be null.
        shareOverlayOwnsScreen(bookShare.progress) ||
        undefined
      }
    >
      <header className="flex items-center justify-end gap-[6px] px-[4px] py-[2px]">
        {!showEmpty && (
          <Control
            icon="plus"
            label={strings.newBook}
            variant="primary"
            size={26}
            disabled={loading || loadFailed}
            onClick={onNewBook}
          />
        )}
        {/* State-in-place on the control itself, which AGENTS.md prefers to a
            message bubble: while the failure log is non-empty the ≡ carries an
            alert mark and says so in its name. The `control-hinted` wrapper is
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
              failureCount > 0
                ? strings.menuOpenWithFailures(failureCount)
                : strings.menuOpen
            }
            variant="quiet"
            onClick={openGlobalMenu}
          />
          {failureCount > 0 && (
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

      {/* Two standing background conditions can be true at once — the browser
          has not promised to keep this storage (#12), AND the encoder has
          stopped working (#166) — and they are about different subsystems, so
          #279's precedent (encoderLine's own line, not folded into the
          load/delete/loading slot above, which stays exclusive and acute-first)
          extends to both rather than making one dominant CSS-flag over the
          other: each is `&&`-rendered on its own, and BOTH may show stacked.
          Neither collides with the slot above — both need a completed,
          non-loading read, which is exactly when `noticeText` is falsy and
          `loading` is false; there is no gate keying on that here because
          `storage` and `encoderLine` are themselves already `null` until then
          (`useStoragePersistence` requires `hasContent`, i.e. a loaded shelf;
          `encoderHealth()` has nothing to report before a book exists to
          encode from).

          Order: storage first, encoder second. Storage's risk is total and
          unrecoverable (browser eviction, no restore path) where encoder's
          copy explicitly promises nothing is lost — the more severe standing
          risk reads first, same principle the load-failure/loading slot above
          already applies by being exclusive and ordered acute-first.
          `notice-tone.ts`'s `info` docblock names this exact case (a standing
          condition, not only a completed-event caveat) after George round 1
          P3-3 flagged the original wording as covering only the latter. */}
      {storage === "not-persisted" && (
        <Notice tone="info">{strings.storageNotPersisted}</Notice>
      )}
      {encoderLine && (
        <Notice tone={encoderLine.tone}>{encoderLine.text}</Notice>
      )}

      <div className="flex-1 overflow-y-auto">
        {showEmpty ? (
          // Registered as a focus target like a book row: deleting the last book
          // unmounts the row that had focus, and this CTA is the only control
          // left to hand it to (#337).
          <div className="h-full" ref={(el) => setNode(EMPTY_STATE_NODE, el)}>
            <EmptyState
              headline={strings.booksEmpty}
              teach={strings.booksEmptyTeach}
              ctaLabel={strings.newBook}
              ctaIcon="plus"
              onCta={onNewBook}
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-[10px]">
            {books.map((book) => (
              <BookItem
                key={book.bookId}
                book={book}
                expanded={expanded.has(book.bookId)}
                onToggle={() => toggle(book.bookId)}
                onNewChapter={() => void onNewChapter(book.bookId)}
                onOpenShareMenu={() => onOpenShareMenu(book.bookId)}
                onOpenChapter={onOpenChapter}
                setNode={setNode}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The global menu: the failure-log panel, then the theme toggle.

          THE PANEL COMES FIRST, and the order is load-bearing. `Menu` lands
          focus on its first actionable child on open, and while the log is
          non-empty the ≡ is named "Open menu. N problems recorded." — reaching
          the report is its whole point. So the report is what a switch/AT
          user must land on, not a control that flips the theme (George R1 P2
          on #457). The panel is mounted only while the log holds something,
          so a phone that has never failed opens on the toggle, as before.

          The toggle (#171): a complete light theme has existed in
          `2-semantic.css` since the pivot with nothing able to select it,
          written for the one condition that makes this app unusable — direct
          equatorial sun on a dark screen.

          ONE control that flips, not two rows or a three-state cycle: its
          label names the DESTINATION so AT does not announce the state a user
          already has, and `nextTheme` is an involution so the only promise a
          text-free glyph can make — tap twice and you are back — holds. The
          menu stays OPEN across the tap, so the translator sees the screen
          change behind the scrim and can tap straight back if they guessed
          wrong; that is the affordance doing the explaining, which is the
          `state-in-place` rule this repo prefers over a message. */}
      <Menu open={menuOpen} onClose={closeGlobalMenu}>
        {failureCount > 0 && (
          <FailureLogPanel
            count={failureCount}
            onDone={closeGlobalMenu}
            onClearConfirmOpen={onClearConfirmOpen}
            onClearConfirmClose={onClearConfirmClose}
          />
        )}
        <Control
          icon={theme.theme === "dark" ? "sun" : "moon"}
          label={
            theme.theme === "dark"
              ? strings.useLightTheme
              : strings.useDarkTheme
          }
          variant="quiet"
          onClick={theme.toggle}
        />
      </Menu>

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
        />
        {/* THIS dialog's own failure channel — never the shared `error`, which
            also carries a failed addChapter or rename and would announce one
            here as if naming had gone wrong. */}
        {newBookError && <Notice>{newBookError}</Notice>}
      </Menu>

      {/* The per-book ≡ menu. Mirrors the Segments chapter menu: two gestures in
          the same spot — "Share book" encodes + zips (tap 1), then a primary
          "Share now" hands the File to the sheet in a fresh activation (tap 2) —
          with the busy state, a gap warning, and any error riding inside the
          panel because the flow keeps it open. */}
      <Menu
        open={shareMenuBook !== null}
        onClose={onCloseShareMenu}
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
        {renamingBook && shareMenuBook ? (
          <>
            {/* Rename the book in place (#264). The store seeds the field with
                the current name so a small fix is an edit, not a retype. */}
            <NameEdit
              initialValue={shareMenuBook.name}
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
                nothing had submitted yet (George stand-in P3-2). The remaining
                instances of that class — a failed create or add-chapter reaching
                this panel the same way — are pre-existing and belong to #172,
                which is about raw browser strings in Notices generally. */}
            {error && !deleteFailed && <Notice>{error}</Notice>}
          </>
        ) : (
          <>
            <Control
              icon="edit"
              label={strings.renameBook}
              variant="quiet"
              // No `shareOverlayOwnsScreen` guard here any more (#491): this
              // control sits inside the panel's `inert` subtree above (see
              // `<Menu>`'s own `inert` prop), so it is unreachable by click,
              // keyboard or AT activation for the whole time the guard used
              // to check — the primitive covers it now, not a per-handler
              // check.
              onClick={() => setRenamingBook(true)}
            />
            {bookShare.status === "ready" ? (
              <Control
                ref={shareControlRef}
                icon={bookShareAffordance.icon}
                label={strings.shareSend}
                variant={bookShareAffordance.variant}
                className={bookShareAffordance.className}
                autoFocus
                onClick={onSendBookShare}
              />
            ) : (
              // `busy` (not disabled) while preparing: the control must stay
              // enabled/focusable — a re-tap is already a no-op via the hook's
              // `preparingRef`, and disabling it would drop this control out of
              // Menu's `FOCUSABLE` set, breaking the Tab trap (George R-B7) —
              // and now also paints and reads that wait (#354; see
              // `control-affordance.ts`).
              <Control
                ref={shareControlRef}
                icon={bookShareAffordance.icon}
                label={
                  bookShare.status === "preparing"
                    ? strings.shareBookPreparing
                    : bookShare.sendUnconfirmed
                      ? strings.shareBookUnconfirmed
                      : strings.shareBook
                }
                variant={bookShareAffordance.variant}
                busy={bookShareAffordance.busy}
                onClick={onPrepareBookShare}
              />
            )}
            {bookShare.status === "preparing" && (
              <Notice tone="busy">{strings.shareBookPreparing}</Notice>
            )}
            {bookShare.status === "ready" && bookShareHasGap && (
              // A heads-up once the zip is armed, not a wait (#112). Covers
              // both whole chapters left out AND segments missing inside
              // chapters that shipped (#116) — see `bookShareGapText` above.
              // Its own mark since #178, so "some of the book went" does not
              // wear the same glyph as an unrelated standing condition.
              <Notice tone={sharePartial.tone} icon={sharePartial.icon}>
                {bookShareGapText}
              </Notice>
            )}
            {bookShareErrorText && (
              // See the Segments menu: `nothing` and `failed` share the
              // `alert` tone (#147), so the mark carries the difference (#178);
              // the tone rides from the same table (George R3 P3).
              <Notice
                tone={bookShareErrorMark?.tone}
                icon={bookShareErrorMark?.icon}
              >
                {bookShareErrorText}
              </Notice>
            )}
            {/* Destructive, so it sits last — the same place Delete holds in the
                Segments row menu (#80). It arms the shared two-tap confirm; it
                never deletes on this tap. */}
            <Control
              icon="trash"
              label={strings.deleteBook}
              variant="quiet"
              onClick={onArmDelete}
            />
          </>
        )}
      </Menu>

      {/* The SAME confirm the segment Erase uses — one dialog, parameterised by
          its copy, never a second one. Focus lands on Cancel, Escape and a scrim
          tap cancel, and both are no-ops once the delete is in flight. */}
      <EraseConfirm
        open={deleteTargetId !== null}
        title={strings.deleteBookConfirmTitle(deleteTarget?.name ?? "")}
        confirmLabel={strings.deleteBookConfirm}
        cancelLabel={strings.eraseCancel}
        busy={deleting}
        onConfirm={onConfirmDelete}
        onCancel={closeDeleteConfirm}
      />

      {/* The share modal (#491), a sibling of the book menu — see the Segments
          screen for why: it outlives the menu's close, and `send()` resolves
          only after its outcome glyph has cleared. `onCancel` is wired to
          `bookShare.reset` directly, not `onCloseShareMenu` (George r1 P2
          #1/#2) — see `onCloseShareMenu`'s own comment. */}
      <ShareProgress
        progress={bookShare.progress}
        scope="book"
        onCancel={bookShare.reset}
        onDismiss={bookShare.dismissProgress}
      />
    </div>
  );
}

interface BookItemProps {
  book: BookCard;
  expanded: boolean;
  onToggle: () => void;
  onNewChapter: () => void;
  onOpenShareMenu: () => void;
  onOpenChapter: (chapterId: ChapterId) => void;
  setNode: (id: string, el: HTMLElement | null) => void;
}

function BookItem({
  book,
  expanded,
  onToggle,
  onNewChapter,
  onOpenShareMenu,
  onOpenChapter,
  setNode,
}: BookItemProps) {
  const listId = `chapters-${book.bookId}`;
  return (
    <li ref={(el) => setNode(book.bookId, el)}>
      <div className="border-edge flex items-center gap-[8px] border-b px-[4px]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={strings.bookRow(
            book.name,
            book.chapters.length,
            expanded
          )}
          className="flex min-w-0 flex-1 items-center gap-[10px] border-0 bg-transparent py-[10px] text-left"
        >
          <span className="text-ink-muted flex-none">
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={20}
            />
          </span>
          <span className="t-title text-ink min-w-0 truncate">{book.name}</span>
        </button>
        <Control
          icon="plus"
          label={strings.addChapter(book.name)}
          variant="quiet"
          onClick={onNewChapter}
        />
        {/* Overflow ≡ after the +. The new-book focus hand-off targets the
            row's toggle button above, not either Control (George R4 P2-1) —
            this ordering is no longer load-bearing for that hand-off, only
            for the read/visual order: expand, add, manage. */}
        <Control
          icon="menu"
          label={strings.bookMenuOpen(book.name)}
          variant="quiet"
          onClick={onOpenShareMenu}
        />
      </div>

      {expanded && (
        <ul id={listId} className="flex flex-col">
          {book.chapters.map((chapter) => (
            <ChapterItem
              key={chapter.chapterId}
              chapter={chapter}
              onOpen={() => onOpenChapter(chapter.chapterId)}
              setNode={setNode}
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
  setNode: (id: string, el: HTMLElement | null) => void;
}

function ChapterItem({ chapter, onOpen, setNode }: ChapterItemProps) {
  const { number, name, finishedCount, totalCount } = chapter;
  // The passage label the facilitator set (#264), else "Chapter {number}".
  const heading = strings.chapterHeading(name, number);
  // An empty chapter shows no counter — "0/0" would read as a failed 21, not
  // as "nothing here yet" (spec §2.4).
  const hasCounter = totalCount > 0;
  const allDone = hasCounter && finishedCount === totalCount;
  return (
    <li ref={(el) => setNode(chapter.chapterId, el)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={strings.openChapter(heading)}
        className="flex w-full items-center justify-between gap-[10px] border-0 bg-transparent py-[10px] pr-[6px] pl-[30px] text-left"
      >
        <span className="text-ink min-w-0 truncate">{heading}</span>
        {hasCounter && (
          <span
            // All finished glows green (--s-done) — the wordless "chapter
            // complete" read, matching the green finished rows. Amber is now
            // "audio exists", not "finished" (George R3 P2).
            className={cn("t-count", "flex-none", allDone && "text-done")}
          >
            {finishedCount}/{totalCount}
          </span>
        )}
      </button>
    </li>
  );
}
