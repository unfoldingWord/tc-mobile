import "fake-indexeddb/auto";

import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportLibraryZip, memoryArchiveSink } from "@/lib/export/book";
import {
  addChapter,
  addSegment,
  createBook,
  deleteBook,
  getBook,
  listBooks,
  moveBook,
  renameBook,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import { strings } from "@/lib/strings";
import type { BookId } from "@/types/domain";
import { clearAllStores, testCodec } from "./support";

/**
 * The user's own shelf order (#338, which absorbed #1186): `Book.shelfPosition`
 * and `moveBook`, the book twin of #953's `moveChapter`.
 *
 * The rules under test: the shelf reads the stored position, not `createdAt`;
 * a move writes a dense 0..N-1 order in one transaction and is not activity
 * on the book (no `updatedAt`); a new book lands at the top; and the library
 * share keeps the order it had before #338 (newest created first) until the
 * requirements owner says otherwise.
 */

beforeEach(clearAllStores);
afterEach(() => vi.restoreAllMocks());

/** Three books on a strictly increasing clock: the shelf shows C, B, A. */
async function shelfOfThree(): Promise<[BookId, BookId, BookId]> {
  let t = 1_000;
  const a = await createBook("A", null, (t += 10));
  const b = await createBook("B", null, (t += 10));
  const c = await createBook("C", null, (t += 10));
  return [a.id, b.id, c.id];
}

const shelfIds = async () => (await listBooks()).map((b) => b.id);
const positions = async () => (await listBooks()).map((b) => b.shelfPosition);

/** Count IndexedDB writes at the boundary. */
const spyPut = () => vi.spyOn(IDBObjectStore.prototype, "put");

/** Let the first `okCalls` puts through, then throw on the next. */
function failPutAfter(okCalls: number) {
  const real = IDBObjectStore.prototype.put;
  let calls = 0;
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    calls++;
    if (calls > okCalls) throw new Error("injected put failure");
    return real.apply(this, args);
  });
}

describe("createBook: a new book lands at the top (#338)", () => {
  it("puts each new book at position 0 and keeps the order dense", async () => {
    const [a, b, c] = await shelfOfThree();
    expect(await shelfIds()).toEqual([c, b, a]);
    expect(await positions()).toEqual([0, 1, 2]);
  });

  it("lands on top of an order the user set, keeping that order below it", async () => {
    const [a, b, c] = await shelfOfThree();
    await moveBook(a, 0); // the user's order: A, C, B
    const d = await createBook("D", null, 1);
    expect(await shelfIds()).toEqual([d.id, a, c, b]);
    expect(await positions()).toEqual([0, 1, 2, 3]);
  });

  it("closes the gap a delete leaves, on the next create", async () => {
    const [a, b, c] = await shelfOfThree();
    await deleteBook(b);
    expect(await shelfIds()).toEqual([c, a]);
    const d = await createBook("D");
    expect(await shelfIds()).toEqual([d.id, c, a]);
    expect(await positions()).toEqual([0, 1, 2]);
  });
});

describe("moveBook (#338)", () => {
  it("moves a book to an absolute position and renumbers the shelf densely", async () => {
    const [a, b, c] = await shelfOfThree();

    const order = await moveBook(a, 0);

    expect(order.map((book) => book.id)).toEqual([a, c, b]);
    expect(order.map((book) => book.shelfPosition)).toEqual([0, 1, 2]);
    expect(await shelfIds()).toEqual([a, c, b]);
    expect(await positions()).toEqual([0, 1, 2]);
  });

  it("orders the shelf by the stored position, not by creation", async () => {
    const [a, b, c] = await shelfOfThree();
    await moveBook(c, 2);
    // C is the newest, and it is at the bottom.
    expect(await shelfIds()).toEqual([b, a, c]);
  });

  it("is not activity on the book: no updatedAt, createdAt or other field moves", async () => {
    const [a] = await shelfOfThree();
    const before = await getBook(a);

    await moveBook(a, 0);

    expect(await getBook(a)).toEqual({ ...before!, shelfPosition: 0 });
  });

  it("writes only the books whose position changes", async () => {
    const [a, b, c] = await shelfOfThree();
    await createBook("D", null, 9_999); // D, C, B, A
    const put = spyPut();

    await moveBook(b, 1); // D, B, C, A: only B and C change

    expect(put).toHaveBeenCalledTimes(2);
    expect(await shelfIds()).toEqual([expect.any(String), b, c, a]);
  });

  it("writes nothing for a drop where it started, and a re-run lands in the same state", async () => {
    const [a, b, c] = await shelfOfThree();
    await moveBook(a, 1);
    const put = spyPut();

    await moveBook(a, 1);
    await moveBook(b, 2);

    expect(put).not.toHaveBeenCalled();
    expect(await shelfIds()).toEqual([c, a, b]);
  });

  it("clamps a target past either end to that end", async () => {
    const [a, b, c] = await shelfOfThree();
    await moveBook(c, 99);
    expect(await shelfIds()).toEqual([b, a, c]);
    await moveBook(c, -5);
    expect(await shelfIds()).toEqual([c, b, a]);
  });

  it("refuses a non-integer target and an unknown book, writing nothing", async () => {
    const [a] = await shelfOfThree();
    const put = spyPut();
    await expect(moveBook(a, 0.5)).rejects.toThrow(RangeError);
    await expect(moveBook("nope" as BookId, 0)).rejects.toThrow(
      "No such book: nope"
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("rolls back whole when a write fails part-way", async () => {
    const [a, b, c] = await shelfOfThree();
    failPutAfter(1);

    await expect(moveBook(a, 0)).rejects.toThrow("injected put failure");
    vi.restoreAllMocks();

    expect(await shelfIds()).toEqual([c, b, a]);
    expect(await positions()).toEqual([0, 1, 2]);
  });

  it("keeps the order a rename leaves (a rename does not move a book)", async () => {
    const [a, b, c] = await shelfOfThree();
    await moveBook(a, 0);
    await renameBook(b, "Bee");
    expect(await shelfIds()).toEqual([a, c, b]);
  });
});

describe("the library share keeps creation order (#338: assumption, needs the requirements owner)", () => {
  const nameBook = (book: { name: string | null; number: number }) =>
    strings.bookHeading(book.name, book.number);
  const nameChapter = (
    book: { name: string | null; number: number },
    n: number
  ) => strings.shareFilename(strings.bookHeading(book.name, book.number), n);

  async function recordedBook(name: string, at: number): Promise<BookId> {
    const book = await createBook(name, null, at);
    const chapter = await addChapter(book.id);
    const segment = await addSegment(chapter.id);
    await saveTake(
      segment.id,
      newClipId(),
      Int16Array.from({ length: 100 }, () => 100),
      CANONICAL_SAMPLE_RATE
    );
    return book.id;
  }

  it("zips books newest-created first even after the user reorders the shelf", async () => {
    const earlier = await recordedBook("Earlier", 1_000);
    await recordedBook("Later", 2_000);
    await moveBook(earlier, 0);
    expect((await listBooks()).map((b) => b.name)).toEqual([
      "Earlier",
      "Later",
    ]);

    const sink = memoryArchiveSink();
    await exportLibraryZip(nameBook, nameChapter, testCodec(), sink);
    const bytes = new Uint8Array(
      sink.chunks.reduce((n, chunk) => n + chunk.length, 0)
    );
    let at = 0;
    for (const chunk of sink.chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    expect(Object.keys(unzipSync(bytes))).toEqual([
      "Later/Later - Chapter 1.mp3",
      "Earlier/Earlier - Chapter 1.mp3",
    ]);
  });
});
