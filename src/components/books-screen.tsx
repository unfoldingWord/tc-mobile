import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { EMPTY_STATE_NODE, focusTargetAfterDelete } from "./delete-focus";
import { EmptyState } from "./empty-state";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { encoderNotice } from "./encoder-notice";
import { strings } from "./strings";
import { encoderHealth, subscribeToEncoderHealth } from "@/hooks/mp3-codec";
import { useBookShare } from "@/hooks/use-book-share";
import { useBooks } from "@/hooks/use-books";
import { cn } from "@/lib/utils";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

interface BooksScreenProps {
  /** Open a chapter's Segments screen. Owned by App (slice 4) for navigation. */
  onOpenChapter: (chapterId: ChapterId) => void;
}

/**
 * B2 — the Books screen, and the app's home (G2).
 *
 * The whole bar is two icons: New Book and the menu. Everything else is the
 * book/chapter tree. Books are collapsed by default (F1) so a long shelf stays
 * short; a book the translator just made opens expanded and scrolls into view,
 * because the next thing they do is add a chapter to it.
 */
export function BooksScreen({ onOpenChapter }: BooksScreenProps) {
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  }, [newBookPlaceholder]);

  // Cancel, Escape, the panel's Close, a scrim tap: all the same outcome —
  // nothing is created, and focus goes back where it came from.
  const onCancelNewBook = useCallback(() => {
    // Mid-create, dismissal does nothing. The IndexedDB write cannot be recalled
    // once Confirm has run, so tearing the dialog down here would make "Cancel
    // creates nothing" false AND let the create's continuation expand and steal
    // focus for a book the closing gesture disowned (Frank R1 P2 / George R1
    // P2-4, both lenses). Holding the panel for the length of one `put` is the
    // same "in-flight owns the panel" rule EraseConfirm applies to its own
    // committing action.
    if (creatingBook.current) return;
    setNewBookSeed(null);
    setNewBookError(null);
  }, []);

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
    [createBook, newBookSeed]
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
  const onOpenShareMenu = useCallback((bookId: BookId) => {
    bookMenuSession.current += 1;
    setShareMenuBookId(bookId);
    // A different book's still-pending rename must not show THIS book's fresh
    // Confirm as busy before it has even been tapped (Frank r1, #384).
    setSavingBookName(false);
  }, []);
  // Closing the menu (scrim, Escape, close button) ends the flow: drop any armed
  // File so a stale "ready" cannot linger behind a closed menu (mirrors Segments).
  //
  // This is Menu's actual `onClose` — a Menu-level guard that blocked it while
  // `savingBookName` was true (round 3/4 of #384's review) was REVERTED: it
  // stopped the scrim/Close/Escape-elsewhere from unmounting the menu mid-write,
  // but system Back still could (a separate mechanism, `lib/nav/navigation.ts`'s
  // `popAction`), and a Menu-only guard funnels a user onto exactly that worse
  // exit (George R5 P2) — Close used to work, so nobody reached for system Back;
  // making it a silent no-op is what sends them there. Fixing this properly
  // needs the nav layer's `overlayBlocksClose`/`overlayDismissal` absorbing
  // system Back too, tracked at #393 (with #374, the same gap for Books' other
  // menus) rather than shipped as a partial fix here.
  const onCloseShareMenu = useCallback(() => {
    bookMenuSession.current += 1;
    setShareMenuBookId(null);
    setRenamingBook(false);
    setSavingBookName(false);
    bookShare.reset();
  }, [bookShare]);
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
      setSavingBookName(true);
      void renameBook(shareMenuBookId, name)
        .then((book) => {
          if (book && bookMenuSession.current === session) onCloseShareMenu();
        })
        .finally(() => {
          // Guarded the same way the close above is: a stale settle from a
          // session this screen has already moved past (a newer open, close,
          // or armed share) must not touch state a newer session now owns.
          if (bookMenuSession.current === session) setSavingBookName(false);
        });
    },
    [renameBook, shareMenuBookId, onCloseShareMenu]
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
    setSavingBookName(false);
  }, []);
  // Tap 1 — encode the book's chapters into a zip and arm the send gesture. The
  // menu stays open across both gestures (the shelf is `inert` behind it), so the
  // panel is what the translator is looking at.
  const onPrepareBookShare = useCallback(() => {
    if (!shareMenuBook) return;
    // Arming a share ends the current rename-close session: a rename resolving
    // after this must not close the menu and drop the encode we are preparing.
    bookMenuSession.current += 1;
    setSavingBookName(false);
    void bookShare.prepare(
      shareMenuBook.bookId,
      strings.shareBookFilename(shareMenuBook.name),
      (n) => strings.shareFilename(shareMenuBook.name, n)
    );
  }, [bookShare, shareMenuBook]);
  // Tap 2 — hand the armed zip to the OS share sheet. Close the menu once the
  // flow is done, but NOT on `retry` (the File is still armed) or `failed` (its
  // error Notice lives in the menu and must stay visible).
  const onSendBookShare = useCallback(() => {
    void bookShare.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onCloseShareMenu();
    });
  }, [bookShare, onCloseShareMenu]);
  // Share speaks inside its own menu, not the shelf: the two-gesture flow keeps
  // the menu open across prepare → ready → send. Map its error code to copy here.
  const bookShareErrorText =
    bookShare.error === "nothing"
      ? strings.shareBookNothing
      : bookShare.error === "failed"
        ? strings.shareBookFailed
        : null;
  // The book-grain gap Notice (#116): `missing` (whole chapters left out) and
  // `partialSegments` (segments missing inside chapters that DID ship) are two
  // different counts that can both be non-zero for the same book. One Notice,
  // not two — the copy combines when both are present rather than stacking.
  const bookShareGapText =
    bookShare.missing > 0 && bookShare.partialSegments > 0
      ? strings.shareBookMissingAndPartial(
          bookShare.missing,
          bookShare.partialSegments
        )
      : bookShare.missing > 0
        ? strings.shareBookMissing(bookShare.missing)
        : bookShare.partialSegments > 0
          ? strings.shareBookPartial(bookShare.partialSegments)
          : null;
  // The Share Control's glyph/variant/busy across idle → preparing → ready
  // (#354) — the same table Share Chapter and NameEdit's Confirm use, so
  // "busy" and "ready" never borrow each other's mark or Confirm's.
  const bookShareAffordance = shareControlAffordance(bookShare.status);

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
  const closeDeleteConfirm = useCallback(() => {
    // Cancel / Escape / scrim unmount the confirm with focus still on Cancel.
    // `onConfirmDelete` below already hands focus off after both of ITS
    // outcomes; a plain close never did, so a keyboard/switch user landed on
    // `document` on the path they actually take most (George R10 P2-2). The
    // row is untouched, so the target is just the book the confirm was
    // armed for; the effect above runs once `deleteTargetId` goes null and
    // `inert` lifts.
    if (deleteTargetId !== null) pendingFocus.current = deleteTargetId;
    setDeleteTargetId(null);
  }, [deleteTargetId]);
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
    });
  }, [deleteTarget, deleteTargetId]);
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
    const bookId = shareMenuBookId;
    onCloseShareMenu();
    // Captured NOW, while the row this confirm targets is still on screen —
    // the auto-close effect above needs this "before" shelf, because by the
    // time it detects the vanish, `books` has already moved on without it.
    armedShelf.current = books.map((b) => b.bookId);
    setDeleteTargetId(bookId);
  }, [books, onCloseShareMenu, shareMenuBookId]);
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
    })();
  }, [books, deleteBook, deleteTargetId]);

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
        <Control
          icon="menu"
          label={strings.menuOpen}
          variant="quiet"
          onClick={() => setMenuOpen(true)}
        />
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
              onClick={reload}
            />
          )}
        </Notice>
      ) : (
        loading && <Notice tone="busy">{strings.loadingBooks}</Notice>
      )}

      {/* The encoder has stopped working (#166). Its own line, not the slot
          above: that slot is the shelf's load/delete channel and is exclusive,
          and this is a standing background condition rather than something the
          translator just did. It sits under it so a load failure — which has a
          recovery — is still read first. */}
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

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />

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
              onClick={() => setRenamingBook(true)}
            />
            {bookShare.status === "ready" ? (
              <Control
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
                icon={bookShareAffordance.icon}
                label={
                  bookShare.status === "preparing"
                    ? strings.shareBookPreparing
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
            {bookShare.status === "ready" && bookShareGapText && (
              // A heads-up once the zip is armed, not a wait (#112). Covers
              // both whole chapters left out AND segments missing inside
              // chapters that shipped (#116) — see `bookShareGapText` above.
              <Notice tone="info">{bookShareGapText}</Notice>
            )}
            {bookShareErrorText && <Notice>{bookShareErrorText}</Notice>}
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
      <div
        className="flex items-center gap-[8px] px-[4px]"
        style={{ borderBottom: "1px solid var(--s-edge)" }}
      >
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
          <span className="flex-none" style={{ color: "var(--s-ink-muted)" }}>
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={20}
            />
          </span>
          <span
            className="t-title min-w-0 truncate"
            style={{ color: "var(--s-ink)" }}
          >
            {book.name}
          </span>
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
        <span className="min-w-0 truncate" style={{ color: "var(--s-ink)" }}>
          {heading}
        </span>
        {hasCounter && (
          <span
            className={cn("t-count", "flex-none")}
            // All finished glows green (--s-done) — the wordless "chapter
            // complete" read, matching the green finished rows. Amber is now
            // "audio exists", not "finished" (George R3 P2).
            style={allDone ? { color: "var(--s-done)" } : undefined}
          >
            {finishedCount}/{totalCount}
          </span>
        )}
      </button>
    </li>
  );
}
