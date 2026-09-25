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
 *
 * **Share your work (#987)** sits here too, beside the book export rather than
 * in a file of its own: `exportLibraryZip` is the same per-book chapter loop,
 * run once per book into ONE streaming archive with each book under its own
 * folder, so there is one encode-and-archive path for both shares, not two.
 */

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { SEGMENT_GAP_SECONDS, exportChapterMp3 } from "@/lib/export/chapter";
import {
  listBooks,
  resolveBookChapters,
  resolveChapterClipIds,
} from "@/lib/storage/books";
import { getClipMeta } from "@/lib/storage/clips";
import { filenameSafe } from "@/lib/utils";
import type { AudioCodec } from "@/types/audio";
import type { BookId, Chapter } from "@/types/domain";
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
 * A name `taken` does not already hold, disambiguating a collision with a
 * ` (2)`, ` (3)`, … suffix placed between `stem` and `ext`. `taken` holds
 * names as `key` maps them, so a caller can widen what counts as the same
 * name (see {@link folderKey}); the name returned is the unmapped one.
 */
function uniqueName(
  taken: Set<string>,
  stem: string,
  ext: string,
  key: (name: string) => string = (name) => name
): string {
  if (!taken.has(key(`${stem}${ext}`))) return `${stem}${ext}`;
  let n = 2;
  while (taken.has(key(`${stem} (${n})${ext}`))) n++;
  return `${stem} (${n})${ext}`;
}

/**
 * What makes two folder names the SAME folder once the zip is extracted. iOS
 * Files (APFS by default), Windows and macOS compare names without regard to
 * case or Unicode normalization, so "Mark/" and "mark/" would merge there and
 * one book's chapters would overwrite the other's. Lower-casing an NFC form
 * approximates that comparison; it is deliberately wider than any one
 * filesystem, since a spurious " (2)" costs nothing and a merge loses audio.
 */
function folderKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
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
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  return uniqueName(taken, stem, ext);
}

/**
 * One streaming archive and what it has emitted so far. `ondata` fires
 * synchronously from `push`/`end` for a pass-through entry (nothing here is
 * deferred to a worker), so by the time `zip.end()` returns every chunk, the
 * central directory included, is in `chunks`. An error is surfaced as a
 * rejection of the whole export rather than a partial archive: a zip missing its
 * directory is not a share.
 */
interface ZipSink {
  readonly zip: Zip;
  readonly chunks: Uint8Array<ArrayBuffer>[];
  /** The first error fflate reported, if any. */
  error(): Error | null;
}

function openZipSink(): ZipSink {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) {
      zipError ??= err;
      return;
    }
    chunks.push(chunk);
  });
  return { zip, chunks, error: () => zipError };
}

/** What one book's chapter loop added to the archive. */
interface ChaptersAdded {
  readonly written: number;
  readonly missing: number;
  readonly partialSegments: number;
  readonly partialChapters: number;
}

/**
 * Encode each of `chapters`, in order, and append it to `sink` as a stored
 * entry named `folder` + `nameChapter(number)`. The ONE chapter loop both
 * Share Book and Share your work run (#987): the library export calls it once
 * per book with that book's folder, Share Book once with no folder — which is
 * what makes each library folder the same layout Share Book produces.
 *
 * Returns `null` when cancelled (the caller abandons the whole archive), and
 * throws on an encode or archive error. `missing` here is chapters with no
 * resolvable audio; the caller adds any dangling chapter ids on top.
 */
async function addChaptersToZip(
  sink: ZipSink,
  chapters: readonly Chapter[],
  folder: string,
  nameChapter: (chapterNumber: number) => string,
  codec: AudioCodec,
  shouldContinue?: () => boolean
): Promise<ChaptersAdded | null> {
  let missing = 0;
  // Sum of each INCLUDED chapter's own `result.missing` — see `BookExport`
  // above. Chapters left out entirely contribute to `missing`, not here; a
  // chapter counts toward at most one of the two.
  let partialSegments = 0;
  // How many of those included chapters had any gap at all (#446).
  let partialChapters = 0;
  // Per book: two books may each hold a "Chapter 1.mp3", and each is its own
  // folder, so a collision is only ever within one book.
  const taken = new Set<string>();
  let written = 0;
  for (const chapter of chapters) {
    if (shouldContinue && !shouldContinue()) return null;
    const result = await exportChapterMp3(chapter.id, codec, shouldContinue);
    if (result === null) {
      // exportChapterMp3 returns null for an empty chapter AND for a run
      // cancelled during its gather. Re-check to tell them apart: still live
      // means this chapter simply had no audio → count it and go on; cancelled
      // means stop the whole export.
      if (shouldContinue && !shouldContinue()) return null;
      missing++;
      continue;
    }
    const name = uniqueEntryName(taken, nameChapter(chapter.number));
    taken.add(name);
    // Stored entry: fflate computes the CRC over the MP3 and emits the buffer
    // itself as the data chunk. `result.mp3` is dropped after this iteration;
    // the archive's reference to it is the one copy that remains.
    const entry = new ZipPassThrough(`${folder}${name}`);
    sink.zip.add(entry);
    entry.push(result.mp3, true);
    const zipError = sink.error();
    if (zipError) throw zipError;
    partialSegments += result.missing;
    if (result.missing > 0) partialChapters++;
    written++;
  }
  return { written, missing, partialSegments, partialChapters };
}

/** Close the archive, surfacing any error fflate reported while writing it. */
function finishZip(sink: ZipSink): void {
  sink.zip.end();
  const zipError = sink.error();
  if (zipError) throw zipError;
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
 * checked before each chapter as well as threaded into it: a book is several
 * encodes, so a share the user has already dismissed must be able to stop
 * between chapters, not only within one.
 *
 * The archive stores rather than deflates: an MP3 is already compressed, so
 * deflating it spends a second pass for ~no size gain — and storing is what
 * lets fflate pass each MP3 buffer through as-is (see header).
 */
export async function exportBookZip(
  bookId: BookId,
  nameChapter: (chapterNumber: number) => string,
  codec: AudioCodec,
  shouldContinue?: () => boolean
): Promise<BookExport | null> {
  // `missing` starts at the count of `chapterIds` whose chapter record is gone —
  // those never reach the loop, so they must be added here or a book with a
  // dangling chapter would export as if whole.
  const { chapters, missing: danglingChapters } =
    await resolveBookChapters(bookId);
  const sink = openZipSink();
  const added = await addChaptersToZip(
    sink,
    chapters,
    "",
    nameChapter,
    codec,
    shouldContinue
  );
  if (added === null || added.written === 0) return null;

  finishZip(sink);
  return {
    chunks: sink.chunks,
    chapters: added.written,
    missing: danglingChapters + added.missing,
    partialSegments: added.partialSegments,
    partialChapters: added.partialChapters,
  };
}

interface LibraryExport {
  /** The archive as fflate's stream chunks — see {@link BookExport.chunks}. */
  readonly chunks: ReadonlyArray<Uint8Array<ArrayBuffer>>;
  /** Books that contributed a folder to the zip. */
  readonly books: number;
  /** Books left out entirely: not one chapter had resolvable audio. */
  readonly missing: number;
  /**
   * Chapters inside INCLUDED books that did not ship whole: left out (no
   * audio, or a dangling chapter id) or shipped with segments missing. One
   * unit — chapters — so copy can name it; the segment grain Share Book keeps
   * per book is not carried to the library grain.
   */
  readonly incompleteChapters: number;
  /** How many distinct included books hold those chapters. */
  readonly incompleteBooks: number;
}

/**
 * The folder a book's chapters sit under, made path-safe. The injected name is
 * copy, and a book name is free text: `filenameSafe` turns a `/` into a space
 * so "Mark/Luke" cannot become two folders, and a name that is nothing but dots
 * (`..`, `.`) or nothing at all after sanitising falls back to the book's
 * 1-based position, so no entry can climb out of the archive's root.
 */
function folderStem(label: string, position: number): string {
  const safe = filenameSafe(label);
  return /^\.*$/.test(safe) ? String(position) : safe;
}

/**
 * Share your work (#987): every book in one zip, one folder per book, each
 * folder holding exactly the entries Share Book would put in that book's own
 * zip. Books go in shelf order (`listBooks`). Returns `null` for an empty
 * library, a library with no resolvable audio anywhere, or a run cancelled
 * part-way — a clean no-op for the caller, not an error.
 *
 * `nameBook` names each folder and `nameChapter` each MP3 inside it, both from
 * the book's display name: copy is injected, as for `exportBookZip`. A folder
 * name is disambiguated against its siblings with ` (2)`, ` (3)`, … so two
 * books with one name keep both books' audio. Names that differ only in case
 * count as one name here ({@link folderKey}), so they stay apart after the
 * zip is extracted on a case-insensitive filesystem too.
 *
 * One archive for the whole run, so the peak is still one chapter's PCM, its
 * MP3 and the archive so far. `shouldContinue` is checked before each book as
 * well as threaded into each book's chapter loop. An encode or archive error
 * anywhere rejects the whole call and the chunks gathered so far are dropped
 * with it: nothing partial comes back.
 */
export async function exportLibraryZip(
  nameBook: (bookName: string) => string,
  nameChapter: (bookName: string, chapterNumber: number) => string,
  codec: AudioCodec,
  shouldContinue?: () => boolean
): Promise<LibraryExport | null> {
  const books = await listBooks();
  const sink = openZipSink();
  const takenFolders = new Set<string>();
  let included = 0;
  let missing = 0;
  let incompleteChapters = 0;
  let incompleteBooks = 0;
  for (const [index, book] of books.entries()) {
    if (shouldContinue && !shouldContinue()) return null;
    const { chapters, missing: danglingChapters } = await resolveBookChapters(
      book.id
    );
    const folder = uniqueName(
      takenFolders,
      folderStem(nameBook(book.name), index + 1),
      "",
      folderKey
    );
    const added = await addChaptersToZip(
      sink,
      chapters,
      `${folder}/`,
      (n) => nameChapter(book.name, n),
      codec,
      shouldContinue
    );
    if (added === null) return null;
    if (added.written === 0) {
      // Nothing of this book reached the archive, so its folder was never
      // created and its name stays free for a sibling.
      missing++;
      continue;
    }
    takenFolders.add(folderKey(folder));
    included++;
    const incomplete = danglingChapters + added.missing + added.partialChapters;
    incompleteChapters += incomplete;
    if (incomplete > 0) incompleteBooks++;
  }
  if (included === 0) return null;

  finishZip(sink);
  return {
    chunks: sink.chunks,
    books: included,
    missing,
    incompleteChapters,
    incompleteBooks,
  };
}

/**
 * Bytes per second of the export MP3: `lib/audio/mp3.ts` encodes 64 kbps CBR.
 * Mirrored rather than imported (that constant is private to the encoder);
 * `tests/library-export.test.ts` pins the estimate against a real encode, so
 * a higher bitrate there makes that test fail rather than this go stale.
 */
const EXPORT_MP3_BYTES_PER_SECOND = 64_000 / 8;

/**
 * A fixed allowance per chapter entry on top of its audio: the encoder's
 * priming and final-frame padding (a few ~209-byte frames) and the zip's local
 * header, data descriptor and central-directory record, each carrying the
 * entry name. Generous on purpose; the estimate must not come in under.
 */
const CHAPTER_OVERHEAD_BYTES = 4096;

/**
 * An upper estimate of the zip `exportLibraryZip` would build, in bytes, read
 * from clip metadata alone — no clip is read, decoded or encoded. `0` means
 * there is no resolvable audio anywhere (the share would be a no-op); `null`
 * means the run was cancelled.
 *
 * Walks the same resolution the export does (`resolveBookChapters`,
 * `resolveChapterClipIds`, a clip's `frameCount`), and sizes each chapter as
 * its audio plus the gaps between segments at the export bitrate, plus
 * {@link CHAPTER_OVERHEAD_BYTES}. What it needs to be is "not below the real
 * archive", which the test suite pins against a real encode.
 */
export async function estimateLibraryZipBytes(
  shouldContinue?: () => boolean
): Promise<number | null> {
  const gapFrames = Math.round(SEGMENT_GAP_SECONDS * CANONICAL_SAMPLE_RATE);
  let bytes = 0;
  for (const book of await listBooks()) {
    if (shouldContinue && !shouldContinue()) return null;
    const { chapters } = await resolveBookChapters(book.id);
    for (const chapter of chapters) {
      const { clipIds } = await resolveChapterClipIds(chapter.id);
      let frames = 0;
      let clips = 0;
      for (const clipId of clipIds) {
        const meta = await getClipMeta(clipId);
        if (!meta || meta.frameCount === 0) continue;
        frames += meta.frameCount;
        clips++;
      }
      if (clips === 0) continue;
      frames += (clips - 1) * gapFrames;
      bytes +=
        Math.ceil(
          (frames / CANONICAL_SAMPLE_RATE) * EXPORT_MP3_BYTES_PER_SECOND
        ) + CHAPTER_OVERHEAD_BYTES;
    }
  }
  return bytes;
}

/**
 * How much free space a share must see before it starts, as a multiple of the
 * estimated archive. **An assumption, not a measurement:** the archive is held
 * as a Blob (which a browser may back with disk) and, on the native route, is
 * written again to the app cache before the sheet opens, so at worst it lands
 * twice. No device reading backs this figure (AGENTS.md: record what a real
 * phone reports before treating it as tuned).
 */
const EXPORT_HEADROOM_FACTOR = 2;

/** A figure `roomForExport` is willing to compare. */
function isByteCount(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

/**
 * Whether a share of an archive of about `bytes` has room to be built, from a
 * `navigator.storage.estimate()` `usage`/`quota` pair.
 *
 * `"unknown"` when the browser gave no usable figures — the caller goes ahead,
 * because refusing on a question it could not ask would block every share on a
 * browser without the API; a real out-of-space failure still reaches the
 * failure funnel through the share flow. `"short"` when free space is under
 * {@link EXPORT_HEADROOM_FACTOR} times `bytes`. An estimate is coarse and
 * per-origin (`lib/storage/pressure.ts`'s header), so this is a guard against
 * the obvious case, not a promise the write will fit.
 *
 * Not the storage-pressure band: "Share your work" is the button ON the
 * critical-storage warning, so refusing at `"critical"` would refuse the one
 * action that warning offers. This asks whether THIS archive fits.
 */
export function roomForExport(
  usage: number | undefined,
  quota: number | undefined,
  bytes: number
): "room" | "short" | "unknown" {
  if (!isByteCount(usage) || !isByteCount(quota) || quota === 0) {
    return "unknown";
  }
  return quota - usage >= bytes * EXPORT_HEADROOM_FACTOR ? "room" : "short";
}

/**
 * A library share refused before it started because the phone reported too
 * little free space for the archive (#987). Its message is for whoever reads
 * the failure log, never the screen: the hook maps it to its own error code.
 */
export class InsufficientStorageError extends Error {
  constructor(bytes: number, usage: number, quota: number) {
    super(
      `Not enough free space to build the share: about ${bytes} bytes needed, x${EXPORT_HEADROOM_FACTOR} headroom, ${Math.max(0, quota - usage)} free (usage ${usage} of quota ${quota}).`
    );
    this.name = "InsufficientStorageError";
  }
}
