/**
 * Write a book planned from a template package (#253, part of #1450): the
 * book, every chapter and every segment, in ONE readwrite transaction. The
 * plan is `planBookFromTemplate`'s (`lib/templates/plan.ts`); this module adds
 * the ids, the shelf slot and the rows' defaults, and writes.
 *
 * **One transaction, all or nothing.** The shelf read, the id checks, every
 * put and the shelf renumber share one `books`/`chapters`/`segments`
 * transaction with strict durability. A request that fails aborts it by
 * itself; a put that throws is aborted here (`abortQuietly`), because an
 * IndexedDB transaction otherwise commits the puts already issued. So a
 * failure leaves no book, no chapter and no segment, and the shelf as it was.
 *
 * **Idempotent on the caller's ids.** The caller mints every id once per
 * intent to create (one tap) and passes the same ids on a retry. A run whose
 * book id is already stored, made from the same package version at the same
 * planned time, is that same create replayed: it writes nothing and returns
 * the stored book. Chosen over keying on the template, because a
 * second deliberate create from the same package is a second book (#253: a
 * translator may want two attempts), and over refusing outright, because a
 * retry after a failure of unknown outcome must succeed rather than report an
 * error for a book that exists. Any other use of a stored id is refused
 * before anything is written: a put would silently replace another book's
 * chapter or segment.
 *
 * What it writes from the plan, and what it leaves out:
 * - Chapter `number` is the plan's (R7), never the position, and each
 *   segment stays in the chapter the plan lists it under (R6).
 * - `provenance` and `licence` exactly as planned (D5).
 * - Titles are NOT written: `Book.name`, `Chapter.name` and `Segment.label`
 *   stay `null`. Whether a title is written into the book or rendered at read
 *   time from `templateKey` is open with the DRI (#1450); `templateKey` is
 *   stored on every row, which is what either answer reads.
 * - `thumbnail` is not written: no row has a field for it yet.
 */

import type {
  BookPlan,
  PlannedChapter,
  PlannedSegment,
} from "@/lib/templates/plan";
import type {
  Book,
  BookId,
  Chapter,
  ChapterId,
  Segment,
  SegmentId,
} from "@/types/domain";
import {
  abortQuietly,
  assertBookNameFree,
  byShelfPosition,
  nextBookNumber,
} from "./books";
import { getDb } from "./db";

/** The caller's ids for one create, in the plan's shape and order. */
export interface TemplateBookIds {
  readonly book: BookId;
  readonly chapters: readonly {
    readonly id: ChapterId;
    readonly segments: readonly SegmentId[];
  }[];
}

/** Refuse ids that do not fit the plan, or that repeat, before any write. */
function assertIdsFit(plan: BookPlan, ids: TemplateBookIds): void {
  const fits =
    ids.chapters.length === plan.chapters.length &&
    plan.chapters.every(
      (chapter, c) =>
        ids.chapters[c]?.segments.length === chapter.segments.length
    );
  if (!fits) throw new Error("Template ids do not match the plan's shape");
  const seen = new Set<string>([ids.book]);
  for (const id of ids.chapters.flatMap((c) => [c.id, ...c.segments])) {
    if (seen.has(id)) throw new Error(`Template id repeated: ${id}`);
    seen.add(id);
  }
}

/**
 * The stored book is this same create, replayed: made from the same package
 * version at the same planned time. Neither field changes after creation, so
 * a replay still matches after the translator has added, moved or renamed
 * chapters in the book it made.
 */
function isSameCreate(stored: Book, plan: BookPlan): boolean {
  const ref = plan.provenance.template;
  return (
    stored.provenance.kind === "template" &&
    stored.provenance.template.id === ref.id &&
    stored.provenance.template.version === ref.version &&
    stored.createdAt === plan.createdAt
  );
}

/** A planned chapter as a row: unnamed, its segments in the plan's order. */
function chapterRow(
  planned: PlannedChapter,
  ids: TemplateBookIds["chapters"][number],
  bookId: BookId
): Chapter {
  return {
    id: ids.id,
    bookId,
    number: planned.number,
    name: null,
    segmentIds: ids.segments,
    createdAt: planned.createdAt,
    modifiedAt: planned.modifiedAt,
    templateKey: planned.templateKey,
  };
}

/** A planned segment as a row: unlabelled and never recorded. */
function segmentRow(
  planned: PlannedSegment,
  id: SegmentId,
  chapterId: ChapterId
): Segment {
  return {
    id,
    chapterId,
    index: planned.index,
    reference: planned.reference,
    label: null,
    activeTakeId: null,
    status: "not-started",
    createdAt: planned.createdAt,
    modifiedAt: planned.modifiedAt,
    templateKey: planned.templateKey,
    audioRevision: 0,
  };
}

/**
 * Create the planned book, top of the shelf, in the first free placeholder
 * slot (as `createBook`). `name` is the translator's, trimmed: a name another
 * book already has throws `BookNameTakenError` before anything is written, and
 * blank leaves the book unnamed. Returns the book row written, or the stored one when
 * this is a replay of the same create.
 *
 * @pivotpending #246: the template picker plans a package and writes it with
 * this; until it lands, only `tests/template-book-write.test.ts` calls it.
 */
export async function createBookFromPlan(
  plan: BookPlan,
  ids: TemplateBookIds,
  name: string = ""
): Promise<Book> {
  assertIdsFit(plan, ids);
  const db = await getDb();
  const tx = db.transaction(["books", "chapters", "segments"], "readwrite", {
    durability: "strict",
  });
  const books = tx.objectStore("books");
  const chapters = tx.objectStore("chapters");
  const segments = tx.objectStore("segments");
  try {
    const stored = await books.get(ids.book);
    if (stored) {
      if (!isSameCreate(stored, plan)) {
        throw new Error(`Book id already used by another book: ${ids.book}`);
      }
      await tx.done;
      return stored;
    }
    const taken = await Promise.all([
      ...ids.chapters.map((c) => chapters.getKey(c.id)),
      ...ids.chapters.flatMap((c) => c.segments.map((s) => segments.getKey(s))),
    ]);
    const clash = taken.find((key) => key !== undefined);
    if (clash !== undefined) {
      throw new Error(`Template id already used by another row: ${clash}`);
    }

    const shelf = await books.getAll();
    // A name the caller supplies is held to the same rule as `createBook`
    // (#1272, U4b: a second book from the same template is refused until it
    // has a different name). Blank stays unnamed, as before.
    const trimmed = name.trim();
    if (trimmed !== "") assertBookNameFree(shelf, trimmed);
    const book: Book = {
      id: ids.book,
      name: trimmed === "" ? null : trimmed,
      number: nextBookNumber(shelf),
      languageCode: null,
      chapterIds: ids.chapters.map((c) => c.id),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      coverColourKey: null,
      shelfPosition: 0,
      provenance: plan.provenance,
      licence: plan.licence,
      modifiedAt: plan.modifiedAt,
    };
    await books.put(book);
    for (const [c, planned] of plan.chapters.entries()) {
      const chapterIds = ids.chapters[c];
      if (!chapterIds) throw new Error("unreachable: ids checked above");
      await chapters.put(chapterRow(planned, chapterIds, ids.book));
      for (const [s, seg] of planned.segments.entries()) {
        const id = chapterIds.segments[s];
        if (!id) throw new Error("unreachable: ids checked above");
        await segments.put(segmentRow(seg, id, chapterIds.id));
      }
    }
    // The books already there move down one, in the order the user left them
    // (as createBook, #338). Their `modifiedAt` is this write's time, not the
    // plan's: a plan can be held before it is written, and a neighbour edited
    // meanwhile must not have its stamp moved back (#1463).
    const writtenAt = Date.now();
    for (const [index, row] of byShelfPosition(shelf).entries()) {
      if (row.shelfPosition !== index + 1) {
        await books.put({
          ...row,
          shelfPosition: index + 1,
          modifiedAt: writtenAt,
        });
      }
    }
    await tx.done;
    return book;
  } catch (cause) {
    await abortQuietly(() => tx.abort(), tx.done);
    throw cause;
  }
}
