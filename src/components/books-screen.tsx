import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EmptyState } from "./empty-state";
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
  // The New Book dialog (#314). `null` is closed; a string is open, and IS the
  // value the name field is seeded with — the "Book NNN" placeholder peeked off
  // disk, or "" if that read failed. Held as the seed rather than a boolean so
  // the field's starting text and the dialog's open state cannot disagree, and
  // so each open remounts `NameEdit` with a fresh seed (Menu unmounts its
  // children when closed, which is what resets a half-typed name).
  const [newBookSeed, setNewBookSeed] = useState<string | null>(null);
  // A failed create, scoped to THIS dialog. Not the hook's shared `error`: that
  // channel also carries an addChapter or rename failure, which would then be
  // announced (Notice is `role="alert"`) inside a New Book dialog that has not
  // failed at anything — on the one-tap create path, to someone who may not read
  // the words disowning it (Frank R1 P3, George R1 P2-2).
  const [newBookError, setNewBookError] = useState<string | null>(null);
  // Latches across the create's await. It stops a second Confirm, and it is what
  // `onCancelNewBook` checks: once the write is committing, dismissal is a no-op
  // rather than a promise the store cannot keep.
  const creatingBook = useRef(false);
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
  // hands focus to the new row's add-chapter control instead.
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
      try {
        setNewBookError(null);
        // An untouched field means "the placeholder is fine", so send "" and let
        // the store derive the name INSIDE its write transaction — the one-tap
        // create the corner + used to be, race-safety and all. Sending the
        // rendered string instead would take the supplied-name path, which is
        // deliberately never made unique: two documents open on the same shelf
        // both render "Book 001" and would both write it (George R1 P2-3). A
        // typed name is a deliberate choice and goes through as typed; a blank
        // or whitespace-only one is not an error either, and lands on the same
        // fallback.
        const name = typed === newBookSeed ? "" : typed;
        const outcome = await createBook(name);
        if (!outcome.ok) {
          // A failed create keeps the dialog OPEN with the reason in its own
          // Notice — the screen's Notice sits behind the scrim — and the typed
          // name stays in the field for another try.
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
      } finally {
        creatingBook.current = false;
      }
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

  return (
    // While the menu is open, take the whole shelf chrome — New Book included —
    // out of the focus/pointer tree for AT/switch users, matching how Segments
    // inerts behind its dialogs (G8: aria-modal alone is not trusted to hide the
    // background). The Menu portals to <body>, so it stays live above this (#77).
    <div
      className="flex h-full flex-col gap-[14px]"
      inert={
        menuOpen || shareMenuBook !== null || newBookSeed !== null || undefined
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
      {error ? (
        <Notice>
          <span className="min-w-0 flex-1">{error}</span>
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
          <EmptyState
            headline={strings.booksEmpty}
            teach={strings.booksEmptyTeach}
            ctaLabel={strings.newBook}
            ctaIcon="plus"
            onCta={onNewBook}
          />
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
      >
        <NameEdit
          initialValue={newBookSeed ?? ""}
          fieldLabel={strings.bookNameField}
          saveLabel={strings.createBook}
          onSave={(name) => void onConfirmNewBook(name)}
          onCancel={onCancelNewBook}
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
          </>
        )}
      </Menu>
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
