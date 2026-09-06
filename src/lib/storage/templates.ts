/**
 * Template Library — storage half (#253, part of B7's #33).
 *
 * Q2 (2026-08-23, `docs/design/pivot-plan.md`) settled the shape: a template
 * is a **structure generator that may carry content**, not a content pack —
 * one interface, an optional payload, rather than two incompatible models.
 * OBS is structure *and* content (it supplies both the chapter/segment shape
 * and the reference each segment gets, `lib/obs/catalog.ts`'s `obsTemplate`);
 * a Bible book is structure only (`lib/scripture/books.ts`'s
 * `bibleBookTemplate` — the translator records into the segments themselves).
 *
 * `createBookFromTemplate` below is the one writer this lane adds: the first
 * writer of `Segment.reference` (`SegmentRef`, `src/types/domain.ts`) and of
 * `Book.provenance` (v5, `lib/storage/db.ts`). Its caller is the Template
 * Library picker's UI half (#246, `hooks/use-template-library.ts`).
 */

import { getDb } from "./db";
import type {
  Book,
  BookId,
  BookProvenance,
  Chapter,
  ChapterId,
  Segment,
  SegmentId,
  SegmentRef,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

/**
 * One chapter's starting shape, as a template describes it.
 *
 * Not exported: nothing outside this file needs the name — `Template`'s
 * `chapters()` return type carries the shape structurally, which is all a
 * future importer of `Template` (#246) needs.
 */
interface TemplateChapter {
  /** 1-based, matching `Chapter.number`. */
  readonly number: number;
  /** At least one — `Chapter.segmentIds` (D-IDX) requires a non-empty chapter. */
  readonly segments: readonly { readonly reference: SegmentRef | null }[];
}

/**
 * A structure generator that may carry content (Q2's recorded default).
 *
 * `chapters()` is synchronous and pure on purpose: any data a template needs
 * from elsewhere (OBS's catalogue chunk, fetched by dynamic `import()`) is
 * resolved BEFORE the `Template` value is built, so `createBookFromTemplate`'s
 * transaction never awaits network or bundle-chunk I/O while it holds the
 * write lock open — the same reason `saveTake` builds its clip metadata
 * before opening its transaction.
 */
export interface Template {
  /** Stable id for the picker, e.g. `"obs"` or `"bible:RUT"`. Not persisted. */
  readonly id: string;
  /** Human title — also the stem of the default Book name (see below). */
  readonly title: string;
  /** Stamped onto `Book.provenance` verbatim. */
  readonly source: BookProvenance;
  chapters(): readonly TemplateChapter[];
}

/** Structural equality on `BookProvenance`, keyed on the union's discriminant. */
function sameSource(a: BookProvenance | null, b: BookProvenance): boolean {
  if (a === null) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "obs" && b.kind === "obs") {
    return a.catalogVersion === b.catalogVersion;
  }
  if (a.kind === "scripture" && b.kind === "scripture") {
    return a.book === b.book;
  }
  return a.kind === "user" && b.kind === "user";
}

/**
 * Create a Book, its Chapters and their starting Segments from a Template, in
 * ONE readwrite transaction over `books`/`chapters`/`segments` — the
 * `AGENTS.md` bar of get-or-create in one transaction, never two, applied to a
 * bulk write rather than a single row.
 *
 * **Idempotency (#253 point 3).** A repeated import of the same template does
 * NOT silently dedupe: a translator may genuinely want a second, independent
 * attempt at OBS, or a second Bible book in a different language, and a tap
 * that appears to do nothing on the second press would read as broken to a
 * facilitator at the training. Instead, a repeated import creates a SECOND
 * Book with identical structure, and — when `name` is not given — the default
 * name disambiguates it: this transaction counts the existing books whose
 * `provenance` matches this exact `template.source` (not merely their name
 * text, so a hand-renamed book never miscounts) and appends that count plus
 * one as a zero-padded suffix, mirroring `createNextBook`'s "Book 001" scheme
 * — "Open Bible Stories 001", then "Open Bible Stories 002" on the next
 * import. The count is read inside this same transaction, exactly why
 * `createNextBook` counts inside its own transaction: two overlapping imports
 * are serialised by IndexedDB, so the second one sees the first's write and
 * cannot collide on the same name. An explicit `name` bypasses the counter.
 *
 * Returns the new `BookId`.
 *
 * Called by the Template Library picker (#246, `hooks/use-template-library.ts`),
 * which resolves either `obsTemplate()` or `bibleBookTemplate(code)` and
 * passes the result here.
 */
export async function createBookFromTemplate(
  template: Template,
  name?: string,
  opts: { now?: number } = {}
): Promise<BookId> {
  const now = opts.now ?? Date.now();
  const templateChapters = template.chapters();

  const db = await getDb();
  const tx = db.transaction(["books", "chapters", "segments"], "readwrite", {
    // Strict durability: until this resolves, this transaction holds the ONLY
    // copy of the book's structure — the same bar `openTakeTx` holds for a
    // recording (#179).
    durability: "strict",
  });

  let bookName = name;
  if (bookName === undefined) {
    const existing = await tx.objectStore("books").getAll();
    const count = existing.filter((b) =>
      sameSource(b.provenance, template.source)
    ).length;
    bookName = `${template.title} ${String(count + 1).padStart(3, "0")}`;
  }

  const bookId = uuid() as BookId;
  const chapterIds: ChapterId[] = [];

  for (const templateChapter of templateChapters) {
    const chapterId = uuid() as ChapterId;
    const segmentIds: SegmentId[] = [];

    for (const [i, templateSegment] of templateChapter.segments.entries()) {
      const segment: Segment = {
        id: uuid() as SegmentId,
        chapterId,
        index: i + 1,
        reference: templateSegment.reference,
        activeTakeId: null,
        status: "not-started",
      };
      segmentIds.push(segment.id);
      await tx.objectStore("segments").put(segment);
    }

    const chapter: Chapter = {
      id: chapterId,
      bookId,
      number: templateChapter.number,
      segmentIds,
    };
    chapterIds.push(chapterId);
    await tx.objectStore("chapters").put(chapter);
  }

  const book: Book = {
    id: bookId,
    name: bookName,
    languageCode: null,
    provenance: template.source,
    chapterIds,
    createdAt: now,
    updatedAt: now,
  };
  await tx.objectStore("books").put(book);
  await tx.done;
  return bookId;
}
