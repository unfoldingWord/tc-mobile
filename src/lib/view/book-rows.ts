/**
 * Pure derivations over the Books shelf's view model (`BookCard`/`ChapterRow`).
 *
 * Same split `lib/view/segment-rows.ts` already uses: the shapes stay in
 * `types/view.ts` (compiled erasable, `tests/types-erasable.test.ts`,
 * audit finding L-17 #160), the behaviour over them lives here.
 */

import type { BookCard } from "@/types/view";

/**
 * Does at least one chapter, in at least one book on the shelf, hold a
 * recorded take?
 *
 * #542 Part B (DRI decision, 2026-09-24): the storage-pressure line's copy
 * (`strings.storageLow`/`storageCritical` — "mark segments finished", "share
 * your work and remove it") only makes sense once there is a recording to
 * reclaim. The gate this replaces, "the shelf holds at least one book"
 * (`hasContent` in `books-screen.tsx`), let a book with zero chapters, or a
 * chapter with zero recorded segments, show the full warning with no
 * remediation available.
 *
 * Reads `ChapterRow.recordedCount` — segments with `activeTakeId !== null`,
 * from `chapterProgress` (`lib/storage/books.ts`) — rather than
 * `finishedCount` (too narrow: a "draft" segment has reclaimable bytes too)
 * or `totalCount` (too wide: an unrecorded segment has nothing to reclaim).
 * `books` is already the full shelf `useBooks` holds in memory for the Books
 * screen, and `recordedCount` is already computed there from the SAME
 * `getSegmentsOfChapter` read `finishedCount`/`totalCount` use — so this is a
 * plain fold over data already in memory, no extra IndexedDB read.
 */
export function hasReclaimableAudio(books: readonly BookCard[]): boolean {
  return books.some((book) =>
    book.chapters.some((chapter) => chapter.recordedCount > 0)
  );
}
