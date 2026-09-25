/**
 * Book export — a book's chapters as a zip of per-chapter MP3s.
 *
 * The "share a whole book" half of the export path (#18 / B7, A4): Share Chapter
 * is one MP3, Share Book is one zip of chapter MP3s. It composes the chapter
 * export (`exportChapterMp3`) over `resolveBookChapters` and archives the results
 * with `fflate`. Like `chapter.ts` it is free of the browser — the `Blob` +
 * `navigator.share` handoff is the hook layer on top — so the whole
 * gather-encode-zip path is unit-tested in Node.
 *
 * The archive is built INCREMENTALLY (B8, #34 R2 residual). `zipSync` over a map
 * of entries held every chapter's MP3 AND the finished archive at once — ~2x the
 * archive, ~240 MB on a long fully-recorded book, against the ~80 MB Share
 * Chapter was rewritten to stay under. fflate's streaming `Zip` emits the archive
 * as chunks while each chapter is appended, and a stored (level 0) entry's data
 * chunk IS the MP3 buffer, not a copy — so the chunks hold the archive once, and
 * the hook hands them to `File` as parts without ever concatenating them into a
 * second buffer. Peak is one chapter's PCM, its MP3, and the archive so far.
 */

import { type StepReporter, exportChapterMp3 } from "@/lib/export/chapter";
import { resolveBookChapters } from "@/lib/storage/books";
import type { AudioCodec } from "@/types/audio";
import type { BookId } from "@/types/domain";
import { Zip, ZipPassThrough } from "fflate";

interface BookExport {
  /**
   * The zip archive as the ordered chunks fflate emitted it in. Concatenated they
   * are the archive; the hook passes them straight to `new File(chunks, …)` so
   * no single archive-sized buffer is ever allocated on this side (see header).
   */
  readonly chunks: ReadonlyArray<Uint8Array<ArrayBuffer>>;
  /** Chapters that contributed an MP3 to the zip. */
  readonly chapters: number;
  /**
   * Chapters left out of the zip: no resolvable audio, OR a `chapterIds` entry
   * whose chapter record is gone (counted by `resolveBookChapters`). A book with
   * a hole must not share "as if whole" (Frank R-B7-book P2).
   */
  readonly missing: number;
  /**
   * Segments missing INSIDE chapters that DID make it into the zip — the sum of
   * each included chapter's own `exportChapterMp3` `missing` count (#116). A
   * book whose three chapters each omit one segment reports `missing === 0`
   * (every chapter shipped something) and `partialSegments === 3`; before this
   * field existed that per-chapter count was read and discarded here, so a
   * book with the exact hole Share Chapter warns about showed no Notice at the
   * book grain at all.
   */
  readonly partialSegments: number;
  /**
   * How many DISTINCT included chapters hold those `partialSegments` — the
   * chapters whose own `exportChapterMp3` `missing` was above zero (#446).
   * `partialSegments` alone cannot say this: one chapter with two gaps and two
   * chapters with one gap each both sum to 2, so copy built from the sum alone
   * could not name the chapter count. Always `0` when `partialSegments` is `0`,
   * and never more than it.
   */
  readonly partialChapters: number;
}

/**
 * A zip entry name that is not already taken, disambiguating a collision with a
 * ` (2)`, ` (3)`, … suffix before the extension rather than letting the later
 * write clobber the earlier one.
 *
 * `nameChapter` derives the name from `chapter.number`, and `addChapter` permits
 * an explicit duplicate number, so two chapters CAN map to the same path. Two
 * entries under one path is a corrupt-or-ambiguous archive (Frank R-B7-book P2).
 * Renaming keeps every chapter's audio; losing a recording is unrecoverable in
 * the field, a confusing filename is not.
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
 * (nothing to share) or when the run was cancelled part-way.
 *
 * `nameChapter` supplies each zip entry's filename from the chapter's number:
 * naming is translator-facing copy, so it is injected by the hook (from
 * `strings`) rather than baked in here, keeping this module free of UI text.
 *
 * `shouldContinue` is the same cancellation seam `exportChapterMp3` takes,
 * checked before each chapter as well as threaded into it: a book is several
 * encodes, so a share the user has already dismissed must be able to stop
 * between chapters, not only within one.
 *
 * The archive stores rather than deflates: an MP3 is already compressed, so
 * deflating it spends a second pass for ~no size gain — and storing is what
 * lets fflate pass each MP3 buffer through as-is (see header).
 *
 * `onStep` reports the book's truthful progress at the CHAPTER grain (#986):
 * `(0, total)` before the first chapter, `total` being the chapters the walk
 * found (a dangling id never enters it), then `(done, total)` after each
 * chapter is resolved — its MP3 in the archive, or skipped for having no
 * audio and counted missing. `shouldContinue` is re-checked after each
 * chapter's export, before its step, so a cancel that lands while a chapter
 * is encoding returns `null` without reporting that chapter; a throw unwinds
 * before its step. Either way the count stops where it was. The native
 * staging a Share caller does after this returns adds no step. It is not
 * forwarded into `exportChapterMp3`: the book counts
 * chapters, not the segments inside them.
 *
 * Each call also carries `skipped` (#996): how many of the `done` chapters
 * were resolved with no audio — the chapters this adds to `missing` in the
 * walk. A dangling id is in `missing` but not in `total`, so it is not a
 * step and not `skipped`. A chapter that shipped with some segments missing
 * contributed audio, so it is not `skipped` (it is in `partialChapters`).
 */
export async function exportBookZip(
  bookId: BookId,
  nameChapter: (chapterNumber: number) => string,
  codec: AudioCodec,
  shouldContinue?: () => boolean,
  onStep?: StepReporter
): Promise<BookExport | null> {
  // `missing` starts at the count of `chapterIds` whose chapter record is gone —
  // those never reach the loop below, so they must be seeded here or a book with
  // a dangling chapter would export as if whole.
  const { chapters, missing: danglingChapters } =
    await resolveBookChapters(bookId);
  let missing = danglingChapters;
  // Sum of each INCLUDED chapter's own `result.missing` — see `BookExport`
  // above. Chapters left out entirely contribute to `missing`, not here; a
  // chapter counts toward at most one of the two.
  let partialSegments = 0;
  // How many of those included chapters had any gap at all (#446).
  let partialChapters = 0;

  // The streaming archive. `ondata` fires synchronously from `push`/`end` for a
  // pass-through entry (nothing here is deferred to a worker), so by the time
  // `zip.end()` returns every chunk, the central directory included, is in
  // `chunks`. An error is surfaced as a rejection of the whole export rather
  // than a partial archive: a zip missing its directory is not a share.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError ??= err;
      return;
    }
    chunks.push(chunk);
  });

  const taken = new Set<string>();
  let written = 0;
  let done = 0;
  let skipped = 0;
  if (chapters.length > 0) onStep?.(done, chapters.length, skipped);
  for (const chapter of chapters) {
    if (shouldContinue && !shouldContinue()) return null;
    const result = await exportChapterMp3(chapter.id, codec, shouldContinue);
    if (result === null) {
      // exportChapterMp3 returns null for an empty chapter AND for a run
      // cancelled during its gather. Re-check to tell them apart: still live
      // means this chapter simply had no audio → count it and go on; cancelled
      // means stop the whole book.
      if (shouldContinue && !shouldContinue()) return null;
      missing++;
      skipped++;
      onStep?.(++done, chapters.length, skipped);
      continue;
    }
    // A cancel that landed during this chapter's encode must not report its
    // step (#986); the zip is dropped with the rest of the run.
    if (shouldContinue && !shouldContinue()) return null;
    const name = uniqueEntryName(taken, nameChapter(chapter.number));
    taken.add(name);
    // Stored entry: fflate computes the CRC over the MP3 and emits the buffer
    // itself as the data chunk. `result.mp3` is dropped after this iteration;
    // the archive's reference to it is the one copy that remains.
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(result.mp3, true);
    if (zipError) throw zipError;
    partialSegments += result.missing;
    if (result.missing > 0) partialChapters++;
    written++;
    onStep?.(++done, chapters.length, skipped);
  }
  if (written === 0) return null;

  zip.end();
  if (zipError) throw zipError;
  return {
    chunks,
    chapters: written,
    missing,
    partialSegments,
    partialChapters,
  };
}
