import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EmptyState } from "./empty-state";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { strings } from "./strings";
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
  const { books, loading, error, reload, createBook, addChapter } = useBooks();
  // A first-mount shelf-read failure leaves `books` at [] with `error` set —
  // indistinguishable from a genuinely empty shelf unless we say so. Reading it
  // as empty would show "start a book" and a live New Book over a shelf that
  // may hold books merely unavailable, inviting new data on top (Frank r8, the
  // Books sibling of the Segments load-failure guard). The Notice is the
  // recovery; the menu stays reachable.
  const loadFailed = error !== null && books.length === 0;
  const [menuOpen, setMenuOpen] = useState(false);
  // Per-viewer UI state, so it lives here and not on disk. Collapsed by default.
  const [expanded, setExpanded] = useState<ReadonlySet<BookId>>(new Set());
  // What to scroll to once the list next reloads — a freshly made book or
  // chapter. A ref, not state: creating one calls `reload()`, so the `books`
  // change already re-renders us; clearing a ref here avoids a setState-in-
  // effect cascade.
  const pendingScroll = useRef<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  const setNode = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  useEffect(() => {
    const id = pendingScroll.current;
    if (id === null) return;
    nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
    pendingScroll.current = null;
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
    const book = await createBook();
    if (!book) return; // failed create surfaced through the hook's Notice
    // A new book opens expanded — the next action is adding its first chapter.
    setExpanded((prev) => new Set(prev).add(book.id));
    pendingScroll.current = book.id;
  }, [createBook]);

  const onNewChapter = useCallback(
    async (bookId: BookId) => {
      const chapter = await addChapter(bookId);
      if (!chapter) return; // failed create surfaced through the hook's Notice
      setExpanded((prev) => new Set(prev).add(bookId));
      pendingScroll.current = chapter.id;
    },
    [addChapter]
  );

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <header className="flex items-center justify-end gap-[6px] px-[4px] py-[2px]">
        <Control
          icon="plus"
          label={strings.newBook}
          variant="primary"
          size={26}
          disabled={loading || loadFailed}
          onClick={() => void onNewBook()}
        />
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
        {!loading && !loadFailed && books.length === 0 ? (
          <EmptyState
            headline={strings.booksEmpty}
            teach={strings.booksEmptyTeach}
            ctaLabel={strings.newBook}
            ctaIcon="plus"
            onCta={() => void onNewBook()}
            disabled={loading || loadFailed}
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
                onOpenChapter={onOpenChapter}
                setNode={setNode}
              />
            ))}
          </ul>
        )}
      </div>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

interface BookItemProps {
  book: BookCard;
  expanded: boolean;
  onToggle: () => void;
  onNewChapter: () => void;
  onOpenChapter: (chapterId: ChapterId) => void;
  setNode: (id: string, el: HTMLElement | null) => void;
}

function BookItem({
  book,
  expanded,
  onToggle,
  onNewChapter,
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
  const { number, finishedCount, totalCount } = chapter;
  // An empty chapter shows no counter — "0/0" would read as a failed 21, not
  // as "nothing here yet" (spec §2.4).
  const hasCounter = totalCount > 0;
  const allDone = hasCounter && finishedCount === totalCount;
  return (
    <li ref={(el) => setNode(chapter.chapterId, el)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={strings.openChapter(number)}
        className="flex w-full items-center justify-between gap-[10px] border-0 bg-transparent py-[10px] pr-[6px] pl-[30px] text-left"
      >
        <span className="min-w-0 truncate" style={{ color: "var(--s-ink)" }}>
          {number} — {strings.chapterName(number)}
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
