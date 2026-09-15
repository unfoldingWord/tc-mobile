import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EmptyState } from "./empty-state";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { strings } from "./strings";
import { useBookShare } from "@/hooks/use-book-share";
import { useBooks } from "@/hooks/use-books";
import { cn } from "@/lib/utils";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard, ChapterRow } from "@/types/view";

/**
 * The focus-target key for the empty state's CTA.
 *
 * `setNode` is keyed by book and chapter id (both UUIDs), so a literal with a
 * non-UUID shape cannot collide with a row.
 */
const EMPTY_STATE_NODE = "books-empty-state";

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
  // guards a failed *read* only. A failed create also sets `error`, but once
  // the shelf is known-empty that failure must keep the invite — and its CTA,
  // the only enabled create — up with the error in the Notice, not tear it down
  // and strand focus (George R3 P2).
  const loadFailed = error !== null && !loaded;
  // The empty state carries its own present primary CTA, so the header create
  // control would be a second, equal "New book" — two CTAs read as none
  // (ui-craft §21), and a screen reader would announce it twice. Hide the
  // corner + exactly while the invite is up; it returns once the shelf fills.
  const showEmpty = loaded && books.length === 0;
  const [menuOpen, setMenuOpen] = useState(false);
  // Share Book (B7): the per-book ≡ menu. Which book's menu is open, and one
  // share flow for the screen — only one menu is open at a time (its scrim blocks
  // reaching a second row's trigger), so a single flow is enough. `shareMenuBook`
  // resolves the id back to a row, auto-closing the menu if that book vanishes.
  const [shareMenuBookId, setShareMenuBookId] = useState<BookId | null>(null);
  // Whether the open book ≡ menu is in rename mode (the name field showing) or
  // its action list. Resets to the action list every time the menu closes.
  const [renamingBook, setRenamingBook] = useState(false);
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
  // chapter. A ref, not state: creating one calls `reload()`, so the `books`
  // change already re-renders us; clearing a ref here avoids a setState-in-
  // effect cascade.
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
    if (focusId !== null) {
      // The row's first <button> is the expand/collapse toggle; a second
      // activation there would collapse the new book. Target the add-chapter
      // Control (`.control`) — the actual next action (George R3 P3).
      nodes.current
        .get(focusId)
        ?.querySelector<HTMLElement>("button.control")
        ?.focus();
      pendingFocus.current = null;
    }
  }, [books]);

  const toggle = useCallback((id: BookId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onNewBook = useCallback(async () => {
    // Only a create from the invite (the corner + is hidden while empty) hands
    // off focus, so a corner-+ create on a populated shelf doesn't yank it.
    const fromEmpty = books.length === 0;
    const book = await createBook();
    if (!book) return; // failed create surfaced through the hook's Notice
    // A new book opens expanded — the next action is adding its first chapter.
    setExpanded((prev) => new Set(prev).add(book.id));
    pendingScroll.current = book.id;
    if (fromEmpty) pendingFocus.current = book.id;
  }, [createBook, books]);

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
  }, []);
  // Closing the menu (scrim, Escape, close button) ends the flow: drop any armed
  // File so a stale "ready" cannot linger behind a closed menu (mirrors Segments).
  const onCloseShareMenu = useCallback(() => {
    bookMenuSession.current += 1;
    setShareMenuBookId(null);
    setRenamingBook(false);
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
      void renameBook(shareMenuBookId, name).then((book) => {
        if (book && bookMenuSession.current === session) onCloseShareMenu();
      });
    },
    [renameBook, shareMenuBookId, onCloseShareMenu]
  );
  // Tap 1 — encode the book's chapters into a zip and arm the send gesture. The
  // menu stays open across both gestures (the shelf is `inert` behind it), so the
  // panel is what the translator is looking at.
  const onPrepareBookShare = useCallback(() => {
    if (!shareMenuBook) return;
    // Arming a share ends the current rename-close session: a rename resolving
    // after this must not close the menu and drop the encode we are preparing.
    bookMenuSession.current += 1;
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

  // ── Delete a book (#337) ──────────────────────────────────────────────────
  // The book the confirm names, resolved from the shelf each render — so a book
  // that is no longer there takes its dialog down with it rather than leaving a
  // confirm armed for a row that does not exist.
  const deleteTarget = books.find((b) => b.bookId === deleteTargetId) ?? null;
  const closeDeleteConfirm = useCallback(() => setDeleteTargetId(null), []);
  // Arm the confirm from the ≡ menu, closing the menu first — the same shape as
  // the Segments row menu, where Erase closes the row menu and the screen owns
  // the target. `shareMenuBookId` is read BEFORE the close clears it.
  const onArmDelete = useCallback(() => {
    const bookId = shareMenuBookId;
    onCloseShareMenu();
    setDeleteTargetId(bookId);
  }, [onCloseShareMenu, shareMenuBookId]);
  const onConfirmDelete = useCallback(() => {
    if (deleteTargetId === null) return;
    // Where focus goes once this row unmounts, decided while the row is still on
    // screen: the book that slides into its place, else the one above it, else
    // the empty state's CTA — the only control left on an emptied shelf. Without
    // it focus falls to the document and a keyboard or switch user lands nowhere,
    // the same hole the new-book hand-off above closes.
    const index = books.findIndex((b) => b.bookId === deleteTargetId);
    const neighbour = books[index + 1] ?? books[index - 1] ?? null;
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
        // The hook drops the row in the same turn it commits, so this render
        // already mounts the neighbour (or the empty-state CTA) and the
        // `[books]` effect below can consume this. The later reload is a second
        // chance at it, so a race here costs a frame, not the focus.
        pendingFocus.current = neighbour?.bookId ?? EMPTY_STATE_NODE;
      }
      setDeleteTargetId(null);
    })();
  }, [books, deleteBook, deleteTargetId]);

  // `deleteFailed` only ever RELABELS the hook's current error — the hook sets
  // and clears the two together — so a successful reload takes this line down
  // with the error it labelled, and any later failure speaks for itself.
  const noticeText = deleteFailed ? strings.deleteBookFailed : error;

  return (
    // While the menu is open, take the whole shelf chrome — New Book included —
    // out of the focus/pointer tree for AT/switch users, matching how Segments
    // inerts behind its dialogs (G8: aria-modal alone is not trusted to hide the
    // background). The Menu portals to <body>, so it stays live above this (#77).
    <div
      className="flex h-full flex-col gap-[14px]"
      inert={
        menuOpen || shareMenuBook !== null || deleteTarget !== null || undefined
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
            onClick={() => void onNewBook()}
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
              onCta={() => void onNewBook()}
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
              onCancel={() => setRenamingBook(false)}
            />
            {/* A failed rename speaks here — the screen's Notice is behind the
                scrim — while the field stays up for another try. */}
            {error && <Notice>{error}</Notice>}
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
                icon="share"
                label={strings.shareSend}
                variant="primary"
                autoFocus
                onClick={onSendBookShare}
              />
            ) : (
              <Control
                icon="share"
                label={strings.shareBook}
                variant="quiet"
                onClick={onPrepareBookShare}
              />
            )}
            {bookShare.status === "preparing" && (
              <Notice tone="busy">{strings.shareBookPreparing}</Notice>
            )}
            {bookShare.status === "ready" && bookShare.missing > 0 && (
              // A heads-up once the zip is armed, not a wait (#112).
              <Notice tone="info">
                {strings.shareBookMissing(bookShare.missing)}
              </Notice>
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
        open={deleteTarget !== null}
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
        {/* Overflow ≡ after the +, so the add-chapter Control stays the row's
            first `.control` — the target the new-book focus hand-off relies on. */}
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
