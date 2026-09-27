import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadChapterView } from "@/hooks/use-chapter-segments";
import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import { coverColourHex, resolveCoverKey } from "@/lib/cover-colour";
import {
  addChapter,
  addSegment,
  createBook,
  setBookCoverColour,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * The last named build gap on #949: the O4 chapter/segment/recorder menus'
 * book crumb draws no cover-colour square, because neither view that feeds
 * `O4SheetHead` carried the book's colour (`o4-crumbs.tsx`'s own docblock,
 * before this PR). This is the data half — `loadChapterView` (the chapter
 * menu and, through `segments-screen.tsx`, the segment-row menu) and
 * `loadRecorderSegmentView` (the recorder menu, once `recorder.tsx` — owned
 * by the concurrent #1074/#590 PR2 lane, out of scope here — threads it
 * through). `tests/o4-menus-chapter-segment.test.ts` and
 * `tests/recorder-menu-head-o4.test.ts` cover the component half: that
 * `O4SheetHead` actually draws the square from this value.
 *
 * `resolveCoverKey` (#957) never returns "no colour" for a real book: an
 * unset `coverColourKey` resolves to a stable id-derived fallback, the same
 * one `books-screen.tsx`'s shelf row already shows. So a book with no chosen
 * colour is not a "square absent" case here — it is a "square present, at
 * its fallback colour" case, matching what the Books screen already renders
 * for that book today. The three cases below are the ones `bookCoverHex` can
 * actually take: a stored colour, an unset one (fallback), and no book to
 * read one from at all (the chapter's own `bookName` fallback's twin).
 */

beforeEach(async () => {
  // Clear every store rather than deleting the database: `deleteDatabase`
  // blocks while any connection is open (AGENTS.md).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
});

describe("the chapter view's bookCoverHex (loadChapterView, #949)", () => {
  it("is the book's stored colour, resolved the same way the shelf resolves it", async () => {
    const book = await createBook("Ruth");
    await setBookCoverColour(book.id, "teal");
    const chapter = await addChapter(book.id);
    await addSegment(chapter.id);

    const view = await loadChapterView(chapter.id);

    expect(view.bookCoverHex).toBe(coverColourHex("teal"));
  });

  it("falls back to the id-derived colour when the book has never chosen one — the same colour the shelf shows, not an absent square", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    await addSegment(chapter.id);

    const view = await loadChapterView(chapter.id);

    const expected = coverColourHex(
      resolveCoverKey({ id: book.id, coverColourKey: null })
    );
    expect(view.bookCoverHex).toBe(expected);
    // Not null: this is the "no colour SET" case, and it is not the "no
    // colour to draw" case — it has one, the fallback.
    expect(view.bookCoverHex).not.toBeNull();
  });

  it("is null when the chapter's book cannot be read — the same race bookName's \"\" fallback covers", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    await addSegment(chapter.id);
    // Delete the book underneath the chapter directly (never exposed through
    // the store's own API on purpose) to reach the race `getBook` returning
    // `undefined` covers, the same one `bookName: book?.name ?? ""` already
    // guards against.
    const db = await getDb();
    await db.delete("books", book.id);

    const view = await loadChapterView(chapter.id);

    expect(view.bookName).toBe("");
    expect(view.bookCoverHex).toBeNull();
  });
});

describe("the recorder segment view's bookCoverHex (loadRecorderSegmentView, #949)", () => {
  it("is the book's stored colour", async () => {
    const book = await createBook("Ruth");
    await setBookCoverColour(book.id, "plum");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    const view = await loadRecorderSegmentView(segment.id);

    expect(view.bookCoverHex).toBe(coverColourHex("plum"));
  });

  it("falls back to the id-derived colour when the book has never chosen one", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);

    const view = await loadRecorderSegmentView(segment.id);

    const expected = coverColourHex(
      resolveCoverKey({ id: book.id, coverColourKey: null })
    );
    expect(view.bookCoverHex).toBe(expected);
  });

  it("is null when the segment's book cannot be read", async () => {
    const book = await createBook("Ruth");
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    const db = await getDb();
    await db.delete("books", book.id);

    const view = await loadRecorderSegmentView(segment.id);

    expect(view.bookName).toBe("");
    expect(view.bookCoverHex).toBeNull();
  });
});
