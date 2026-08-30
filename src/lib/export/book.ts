/**
 * Book export — a book's chapters as a zip of per-chapter MP3s.
 *
 * The "share a whole book" half of the export path (#18 / B7, A4): Share Chapter
 * is one MP3, Share Book is one zip of chapter MP3s. It composes the chapter
 * export (`exportChapterMp3`) over `getChaptersOfBook` and archives the results
 * with `fflate`. Like `chapter.ts` it is free of the browser — the `Blob` +
 * `navigator.share` handoff is the hook layer on top — so the whole
 * gather-encode-zip path is unit-tested in Node.
 */

import { type EncodeMp3Options } from "@/lib/audio/mp3";
import { exportChapterMp3 } from "@/lib/export/chapter";
import { getChaptersOfBook } from "@/lib/storage/books";
import type { BookId } from "@/types/domain";
import { zipSync, type Zippable } from "fflate";

interface BookExport {
  /** The zip bytes, ready to wrap in a Blob for the share sheet. */
  readonly zip: Uint8Array;
  /** Chapters that contributed an MP3 to the zip. */
  readonly chapters: number;
  /** Chapters with no resolvable audio, left out of the zip entirely. */
  readonly missing: number;
}

/**
 * Encode each of a book's chapters, in `book.chapterIds` order, to an MP3 and
 * archive them into one zip. Returns `null` when no chapter had resolvable audio
 * (nothing to share) or when the run was cancelled during the gather.
 *
 * `nameChapter` supplies each zip entry's filename from the chapter's number:
 * naming is translator-facing copy, so it is injected by the hook (from
 * `strings`) rather than baked in here, keeping this module free of UI text.
 *
 * `shouldContinue` is the same cancellation seam `exportChapterMp3` takes,
 * checked before each chapter's blocking encode as well as threaded into it:
 * a book is several synchronous encodes, so a share the user has already
 * dismissed must be able to stop between chapters, not only within one.
 *
 * The archive stores rather than deflates (`level: 0`): an MP3 is already
 * compressed, so deflating it spends a second synchronous pass for ~no size gain.
 * The whole encode-and-zip still blocks the main thread until B8 (#34) moves it
 * to a worker.
 */
export async function exportBookZip(
  bookId: BookId,
  nameChapter: (chapterNumber: number) => string,
  options: EncodeMp3Options = {},
  shouldContinue?: () => boolean
): Promise<BookExport | null> {
  const chapters = await getChaptersOfBook(bookId);

  const entries: Zippable = {};
  let written = 0;
  let missing = 0;
  for (const chapter of chapters) {
    if (shouldContinue && !shouldContinue()) return null;
    const result = await exportChapterMp3(chapter.id, options, shouldContinue);
    if (result === null) {
      // exportChapterMp3 returns null for an empty chapter AND for a run
      // cancelled during its gather. Re-check to tell them apart: still live
      // means this chapter simply had no audio → count it and go on; cancelled
      // means stop the whole book.
      if (shouldContinue && !shouldContinue()) return null;
      missing++;
      continue;
    }
    // Copy into a plain Uint8Array (see chapter.ts): the encoder's
    // ArrayBufferLike-backed view is not what fflate's Zippable expects.
    entries[nameChapter(chapter.number)] = new Uint8Array(result.mp3);
    written++;
  }
  if (written === 0) return null;

  return { zip: zipSync(entries, { level: 0 }), chapters: written, missing };
}
