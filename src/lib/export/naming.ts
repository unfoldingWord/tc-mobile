/**
 * Export filenames — what a shared chapter MP3 and a shared book zip are called
 * once they leave the phone.
 *
 * These were `strings` entries (translator-facing copy), but a filename is not
 * copy: it interpolates a book name the translator typed into a `File` name that
 * a share target, a filesystem and a zip's central directory all have to accept.
 * That is a data rule, so it lives in `lib/` where it is pure, DOM-free and
 * testable (Q-18, #163).
 *
 * S-11 — two devices, or two books with the same name, produce the same
 * filename — is NOT solved here. Disambiguating a share belongs to the export
 * manifest (#115); a device id baked into the name would only make it noisier.
 */

/**
 * Characters no filename may carry: the two path separators, the set Windows
 * reserves (`: * ? " < > |`, which Android's MediaStore and iOS share targets
 * also reject or mangle), and every control character. A `/` in a book name is
 * the case that matters — `1/2 Kings` shared as `1/2 Kings - Chapter 1.mp3` is a
 * name a target may read as a directory, and one Windows will not write at all.
 *
 * The control range is `\p{Cc}` rather than a literal escape range: the two
 * match the same characters, and the property escape keeps a raw control
 * character out of the source.
 */
const UNSAFE = /[\p{Cc}/\\:*?"<>|]+/gu;

/** What a name becomes when sanitising leaves nothing to call it. */
const FALLBACK = "Book";

/**
 * A book name reduced to something safe to put in a filename: every run of
 * unsafe characters becomes a single `_`, surrounding whitespace and trailing
 * dots go (a trailing dot is dropped silently by Windows, which would make the
 * extension the whole name), and a name with nothing left but separators falls
 * back rather than producing `" - Chapter 1.mp3"`, `".zip"` or `"_.zip"`.
 *
 * The style is `uniqueEntryName`'s in `book.ts`: keep the translator's name
 * recognisable, change only what would break, never drop the file.
 */
function safeName(book: string): string {
  const cleaned = book
    .trim()
    .replace(UNSAFE, "_")
    .trim()
    .replace(/\.+$/, "")
    .trim();
  return /^[_.]*$/.test(cleaned) ? FALLBACK : cleaned;
}

/** The filename for Share Chapter: one chapter's segments as one MP3. */
export function shareFilename(book: string, chapter: number): string {
  return `${safeName(book)} - Chapter ${chapter}.mp3`;
}

/** The filename for Share Book: the book's chapters as a zip of MP3s. */
export function shareBookFilename(book: string): string {
  return `${safeName(book)}.zip`;
}
