/**
 * Book export — a book's chapters as a zip of per-chapter MP3s.
 *
 * The "share a whole book" half of the export path (#18 / B7, A4): Share Chapter
 * is one MP3, Share Book is one zip of chapter MP3s. It composes the chapter
 * export (`exportChapterMp3`) over `resolveBookChapters` and archives the results
 * with `fflate`. Like `chapter.ts` it is free of the browser — the `Blob` +
 * `navigator.share` handoff is the hook layer on top — so the whole
 * gather-encode-zip path is unit-tested in Node.
 */

import { type EncodeMp3Options } from "@/lib/audio/mp3";
import { exportChapterMp3 } from "@/lib/export/chapter";
import { resolveBookChapters } from "@/lib/storage/books";
import type { BookId } from "@/types/domain";
import { zipSync, type Zippable } from "fflate";

interface BookExport {
  /**
   * The zip bytes, ready to wrap in a Blob for the share sheet. Typed to
   * `zipSync`'s own `Uint8Array<ArrayBuffer>` so the hook hands it to `File`
   * without re-copying the whole archive (Frank/George R-B7-book P3).
   */
  readonly zip: Uint8Array<ArrayBuffer>;
  /** Chapters that contributed an MP3 to the zip. */
  readonly chapters: number;
  /**
   * Chapters left out of the zip: no resolvable audio, OR a `chapterIds` entry
   * whose chapter record is gone (counted by `resolveBookChapters`). A book with
   * a hole must not share "as if whole" (Frank R-B7-book P2).
   */
  readonly missing: number;
}

/**
 * A zip entry name that is not already taken, disambiguating a collision with a
 * ` (2)`, ` (3)`, … suffix before the extension rather than letting the later
 * write clobber the earlier one.
 *
 * `nameChapter` derives the name from `chapter.number`, and `addChapter` permits
 * an explicit duplicate number, so two chapters CAN map to the same path. A zip
 * is a plain object keyed by path — a second write to the same key silently
 * drops the first chapter's audio while `written` still counts it (Frank
 * R-B7-book P2). Renaming keeps every chapter's audio; losing a recording is
 * unrecoverable in the field, a confusing filename is not.
 */
function uniqueEntryName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let n = 2;
  while (taken.has(`${stem} (${n})${ext}`)) n++;
  return `${stem} (${n})${ext}`;
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
  // `missing` starts at the count of `chapterIds` whose chapter record is gone —
  // those never reach the loop below, so they must be seeded here or a book with
  // a dangling chapter would export as if whole.
  const { chapters, missing: danglingChapters } =
    await resolveBookChapters(bookId);
  let missing = danglingChapters;

  const entries: Zippable = {};
  const taken = new Set<string>();
  let written = 0;
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
    // No copy: `result.mp3` is a right-sized Uint8Array and `zipSync` reads it
    // into the archive synchronously, so the view can go straight into `entries`.
    const name = uniqueEntryName(taken, nameChapter(chapter.number));
    taken.add(name);
    entries[name] = result.mp3;
    written++;
  }
  if (written === 0) return null;

  return { zip: zipSync(entries, { level: 0 }), chapters: written, missing };
}
