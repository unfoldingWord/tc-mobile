/**
 * A chapter's slot (#1272, the requirements owner's answer B): its 1-based
 * place among its book's resolvable chapters, from the top. "The fifth chapter
 * slot is always 5", so a move changes which chapter holds a slot, never what
 * the slot reads.
 *
 * The resolvable chapters are `resolveBookChapters`'s: `Book.chapterIds` in
 * order, a dangling id dropped. Every count here is over that same list, so a
 * slot is the place the Books screen and Share Book count too.
 *
 * `Chapter.number` is not a slot. It is read only as the number a template
 * gave its chapter ({@link templateChapterNumber}); the DRI ruled no schema
 * change on #1272 (S1), so it stays stored and a move does not touch it. Pure:
 * no DOM, no storage.
 */

import type { Chapter, ChapterId } from "@/types/domain";

/** Each of the book's resolvable chapters, in order, with its slot. */
export function withSlots<T>(
  chapters: readonly T[]
): { chapter: T; slot: number }[] {
  return chapters.map((chapter, i) => ({ chapter, slot: i + 1 }));
}

/** The slot of `id` among the book's resolvable chapters, or `null` if absent. */
export function slotOf(
  chapters: readonly Pick<Chapter, "id">[],
  id: ChapterId
): number | null {
  const i = chapters.findIndex((c) => c.id === id);
  return i < 0 ? null : i + 1;
}

/**
 * The highest slot in the book: its resolvable chapter count. A shared file's
 * number is padded to this (#1233), so every file of one book sorts in the
 * book's order.
 */
export function highestSlot(chapters: readonly unknown[]): number {
  return chapters.length;
}

/**
 * The number a template gave this chapter, or `null` for a chapter someone
 * added by hand, whose stored number is only the max + 1 it was created with.
 * Export project writes this, not the slot (the DRI on #1272, Q5 (b)).
 */
export function templateChapterNumber(
  chapter: Pick<Chapter, "number" | "templateKey">
): number | null {
  return chapter.templateKey === null ? null : chapter.number;
}

/**
 * The number in a chapter's default title, "Chapter N" (#1272). The DRI's
 * Q1 (b): an unnamed template chapter keeps its template's number wherever it
 * moves, and an unnamed chapter added by hand reads its slot. With "Always
 * show chapter numbers" on (S12) the label is the sequential number, which is
 * the slot for every chapter. The badge is always the slot; only this title
 * can differ from it.
 */
export function headingNumber(
  slot: number,
  templateNumber: number | null,
  alwaysNumber: boolean
): number {
  return alwaysNumber ? slot : (templateNumber ?? slot);
}
