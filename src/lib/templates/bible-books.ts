/**
 * The Bible book table (#1606, child of #1450 and #253): the 66 books of the
 * standard Protestant canon, in canonical order, each with its USFM code, its
 * English name and its chapter count. A Bible-book template and the picker
 * read a book's code, name and size from this one source.
 *
 * Chapter counts follow KJV versification, the standard Protestant canon:
 * 929 chapters in the Old Testament, 260 in the New, 1189 in all.
 * Versification differences between traditions (Deuterocanon, chapter splits
 * that differ) are out of scope, and so are localized names: titles in other
 * languages wait on the dataset. `code` is the same code a template's
 * `SegmentSpan.book` and `TemplatePackage.bookCode` carry.
 *
 * It lives in `lib/` beside the planner because it is pure data with no
 * browser API, and `lib/` unlisted paths default to T1 (AGENTS.md, Risk tiers).
 */

type Testament = "OT" | "NT";

export interface BibleBook {
  /** USFM book code, "GEN" to "REV". */
  readonly code: string;
  readonly name: string;
  readonly chapterCount: number;
  readonly testament: Testament;
}

/** [code, English name, chapter count], Old Testament first. */
const OLD_TESTAMENT: readonly (readonly [string, string, number])[] = [
  ["GEN", "Genesis", 50],
  ["EXO", "Exodus", 40],
  ["LEV", "Leviticus", 27],
  ["NUM", "Numbers", 36],
  ["DEU", "Deuteronomy", 34],
  ["JOS", "Joshua", 24],
  ["JDG", "Judges", 21],
  ["RUT", "Ruth", 4],
  ["1SA", "1 Samuel", 31],
  ["2SA", "2 Samuel", 24],
  ["1KI", "1 Kings", 22],
  ["2KI", "2 Kings", 25],
  ["1CH", "1 Chronicles", 29],
  ["2CH", "2 Chronicles", 36],
  ["EZR", "Ezra", 10],
  ["NEH", "Nehemiah", 13],
  ["EST", "Esther", 10],
  ["JOB", "Job", 42],
  ["PSA", "Psalms", 150],
  ["PRO", "Proverbs", 31],
  ["ECC", "Ecclesiastes", 12],
  ["SNG", "Song of Solomon", 8],
  ["ISA", "Isaiah", 66],
  ["JER", "Jeremiah", 52],
  ["LAM", "Lamentations", 5],
  ["EZK", "Ezekiel", 48],
  ["DAN", "Daniel", 12],
  ["HOS", "Hosea", 14],
  ["JOL", "Joel", 3],
  ["AMO", "Amos", 9],
  ["OBA", "Obadiah", 1],
  ["JON", "Jonah", 4],
  ["MIC", "Micah", 7],
  ["NAM", "Nahum", 3],
  ["HAB", "Habakkuk", 3],
  ["ZEP", "Zephaniah", 3],
  ["HAG", "Haggai", 2],
  ["ZEC", "Zechariah", 14],
  ["MAL", "Malachi", 4],
];

const NEW_TESTAMENT: readonly (readonly [string, string, number])[] = [
  ["MAT", "Matthew", 28],
  ["MRK", "Mark", 16],
  ["LUK", "Luke", 24],
  ["JHN", "John", 21],
  ["ACT", "Acts", 28],
  ["ROM", "Romans", 16],
  ["1CO", "1 Corinthians", 16],
  ["2CO", "2 Corinthians", 13],
  ["GAL", "Galatians", 6],
  ["EPH", "Ephesians", 6],
  ["PHP", "Philippians", 4],
  ["COL", "Colossians", 4],
  ["1TH", "1 Thessalonians", 5],
  ["2TH", "2 Thessalonians", 3],
  ["1TI", "1 Timothy", 6],
  ["2TI", "2 Timothy", 4],
  ["TIT", "Titus", 3],
  ["PHM", "Philemon", 1],
  ["HEB", "Hebrews", 13],
  ["JAS", "James", 5],
  ["1PE", "1 Peter", 5],
  ["2PE", "2 Peter", 3],
  ["1JN", "1 John", 5],
  ["2JN", "2 John", 1],
  ["3JN", "3 John", 1],
  ["JUD", "Jude", 1],
  ["REV", "Revelation", 22],
];

const rows = (
  table: readonly (readonly [string, string, number])[],
  testament: Testament
): BibleBook[] =>
  table.map(([code, name, chapterCount]) => ({
    code,
    name,
    chapterCount,
    testament,
  }));

/** The 66 books in canonical order: 39 Old Testament, then 27 New. */
export const BIBLE_BOOKS: readonly BibleBook[] = [
  ...rows(OLD_TESTAMENT, "OT"),
  ...rows(NEW_TESTAMENT, "NT"),
];

/**
 * The row for a USFM code, or undefined for a code outside the 66.
 *
 * @pivotpending Read by the Bible-book template builder and the picker
 * (#1450); only tests import it until they land.
 */
export function bibleBookByCode(code: string): BibleBook | undefined {
  return BIBLE_BOOKS.find((book) => book.code === code);
}
