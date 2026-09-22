import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { clearAllStores } from "./support";
import {
  addChapter,
  createBook,
  getBook,
  getChapter,
  renameBook,
  renameChapter,
} from "@/lib/storage/books";

/**
 * The ordering guarantee #394 rides on (#394, deferred from #384 round 4).
 *
 * Frank's scenario: rename a book to "Mark", close the menu, reopen, and
 * rename it to "Luke" before "Mark" settles — if "Mark"'s write settles
 * second, the newer name is silently lost, and no latch anywhere would have
 * stopped it. The resolution chosen here is the documented one the issue
 * itself offered ("accept last-write-wins as a documented, deliberate
 * trade-off"), because the spec already makes last-write-wins the only
 * ordering this app can produce, on every engine:
 *
 * > All implementations have a strict ordering of transactions with
 * > overlapping scopes; ... the read/write transactions similarly block later
 * > read/write and read-only transactions.
 *
 * (`w3c/IndexedDB` PR #319, merged into the spec.)
 *
 * `renameBook` and `renameChapter` both do get-then-put inside ONE readwrite
 * transaction per call, created immediately on call. So creation order is
 * tap order, overlapping readwrite transactions run sequentially in creation
 * order, and the later-typed rename must therefore commit last — the feared
 * "older name wins" outcome is not merely unobserved, it is unreachable. The
 * same holds across two tabs of the same origin: ordering is enforced at the
 * database level, not the connection level, so even there the chronologically
 * later rename lands last.
 *
 * What that leaves, deliberately NOT built:
 *
 *  1. A per-target ref-latch or promise lane (the issue's other option). It
 *     would serialize nothing the engine does not already serialize, and
 *     this repo's rule is that a guard must go red when what it guards is
 *     removed — a lane here has no red path, because its absence cannot
 *     change any observed outcome.
 *  2. Queueing (rather than last-write-wins) for cross-tab renames — two
 *     renames typed on different devices are two different intents, and the
 *     spec already orders them chronologically.
 *
 * If either rename is ever refactored into separate read-tx/write-tx halves,
 * or into a read outside its transaction, these cases are what go red: they
 * pin the OUTCOME (the second call's value is what the store holds), not the
 * mechanism, which is the property the menu's tap sequence actually needs.
 *
 * Red-first line: `tests/storage.test.ts` covers rename idempotency and the
 * single-rename write; this file exists because nothing covered two
 * overlapping calls at all until now — the probe version of these cases was
 * written BEFORE any production change and passed without one, which is
 * precisely why the commit for #394 is docs + this pin, not a new guard.
 */
beforeEach(clearAllStores);

describe("concurrent renames of one target resolve last-call-wins (#394)", () => {
  it("book: two renames started back-to-back leave the later call's name", async () => {
    const book = await createBook("probe");
    const first = renameBook(book.id, "Mark");
    const second = renameBook(book.id, "Luke");
    await Promise.all([first, second]);
    expect((await getBook(book.id))?.name).toBe("Luke");
  });

  it("book: the property holds across a burst, not just once", async () => {
    const book = await createBook("probe");
    for (let round = 0; round < 20; round += 1) {
      await Promise.all([
        renameBook(book.id, `older-${round}`),
        renameBook(book.id, `newer-${round}`),
      ]);
      expect((await getBook(book.id))?.name).toBe(`newer-${round}`);
    }
  });

  it("book: renames of DIFFERENT books do not serialize the shelf into a wrong outcome either", async () => {
    const a = await createBook("A-book");
    const b = await createBook("B-book");
    await Promise.all([
      renameBook(a.id, "A-renamed"),
      renameBook(b.id, "B-renamed"),
    ]);
    expect((await getBook(a.id))?.name).toBe("A-renamed");
    expect((await getBook(b.id))?.name).toBe("B-renamed");
  });

  it("chapter: two renames started back-to-back leave the later call's name", async () => {
    const book = await createBook("probe");
    const chapter = await addChapter(book.id);
    await Promise.all([
      renameChapter(chapter.id, "Mark 6"),
      renameChapter(chapter.id, "Mark 9"),
    ]);
    expect((await getChapter(chapter.id))?.name).toBe("Mark 9");
  });

  it("chapter: a book rename and a chapter rename of one book overlap in scope — both survive, neither clobbers the other", async () => {
    // renameBook writes the book; renameChapter writes the chapter AND bumps
    // the parent book's updatedAt in the same transaction. Their scopes
    // overlap on `books`, so the engine serializes them; what must hold is
    // that each landing is complete, not partial.
    const book = await createBook("probe");
    const chapter = await addChapter(book.id);
    await Promise.all([
      renameBook(book.id, "Luke"),
      renameChapter(chapter.id, "Luke 3"),
    ]);
    expect((await getBook(book.id))?.name).toBe("Luke");
    expect((await getChapter(chapter.id))?.name).toBe("Luke 3");
  });
});
