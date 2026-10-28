import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { loadChapterView } from "@/hooks/use-chapter-segments";
import { loadRecorderSegmentView } from "@/hooks/use-recorder-segment";
import {
  addChapter,
  addSegment,
  createBook,
  getBook,
  getChapter,
  moveChapter,
} from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import type { BookId, ChapterId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * The chapter screens read a chapter's slot, not its stored number (#1272, the
 * requirements owner's answer B: "the fifth chapter slot is always 5").
 *
 * The case is the one the scope names: four chapters, the fourth moved to
 * second place. `moveChapter` writes only `Book.chapterIds` (S1), so in book
 * order the stored numbers read 1, 4, 2, 3, and every screen must still say
 * 1, 2, 3, 4. A chapter made from a template also carries the template's own
 * number, which its unnamed title keeps (the DRI's Q1 (b)); the badge and the
 * slot do not.
 *
 * This is the data half: the two loaders the Segments screen and the recorder
 * read. The Books card's rows are pinned in `tests/use-books-reorder.test.ts`,
 * and what each screen draws from these fields in the render tests.
 */

beforeEach(async () => {
  await clearAllStores();
});

async function movedBook(): Promise<{ bookId: BookId; ids: ChapterId[] }> {
  const book = await createBook("Mark");
  const ids: ChapterId[] = [];
  for (let i = 0; i < 4; i++) ids.push((await addChapter(book.id)).id);
  await moveChapter(ids[3]!, 1);
  return { bookId: book.id, ids };
}

/** Give one stored chapter a template's key and number, as a template create would. */
async function makeTemplateChapter(id: ChapterId, number: number) {
  const db = await getDb();
  const chapter = (await db.get("chapters", id))!;
  await db.put("chapters", {
    ...chapter,
    templateKey: `obs-${number}`,
    number,
  });
}

describe("the [1, 4, 2, 3] stored case (#1272 B)", () => {
  it("is stored as the scope describes: the move kept every stored number", async () => {
    const { bookId } = await movedBook();
    const book = (await getBook(bookId))!;
    const numbers = await Promise.all(
      book.chapterIds.map(async (id) => (await getChapter(id))!.number)
    );
    expect(numbers).toEqual([1, 4, 2, 3]);
  });

  it("the Segments view reads each chapter's slot, top to bottom 1..4", async () => {
    const { bookId } = await movedBook();
    const book = (await getBook(bookId))!;
    const views = await Promise.all(book.chapterIds.map(loadChapterView));
    expect(views.map((v) => v.chapterNumber)).toEqual([1, 2, 3, 4]);
    expect(views.map((v) => v.chapterTemplateNumber)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("the recorder view reads the slot of the segment's chapter", async () => {
    const { ids } = await movedBook();
    const segment = await addSegment(ids[3]!);
    const view = await loadRecorderSegmentView(segment.id);
    expect(view.chapterNumber).toBe(2);
    expect(view.chapterTemplateNumber).toBeNull();
  });

  it("a template chapter carries its template number beside its slot", async () => {
    const { ids } = await movedBook();
    // The chapter now in slot 3 was made from a template whose number is 7.
    await makeTemplateChapter(ids[1]!, 7);
    const view = await loadChapterView(ids[1]!);
    expect(view.chapterNumber).toBe(3);
    expect(view.chapterTemplateNumber).toBe(7);
    const segment = await addSegment(ids[1]!);
    const recorder = await loadRecorderSegmentView(segment.id);
    expect(recorder.chapterNumber).toBe(3);
    expect(recorder.chapterTemplateNumber).toBe(7);
  });
});
