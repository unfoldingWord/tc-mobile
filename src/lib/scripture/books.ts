/**
 * The 66-book Protestant canon's USFM identifiers and chapter counts.
 *
 * `src/data/scripture-books.json` is the data; this module is its reader plus
 * `bibleBookTemplate`, the Template Library's "structure only" template (Q2,
 * `docs/design/pivot-plan.md`) — a Bible book supplies its chapter count and
 * one starter segment per chapter (`"{ch}"`: `{ book, scope: String(chapter) }`,
 * the whole-chapter scope in `lib/scripture/scope.ts`'s grammar), which the
 * translator then divides further with the Segments screen's "+" (A3).
 *
 * Chapter counts are standard USFM/Paratext versification — the same across
 * major English versions and unfoldingWord's own book metadata — cross-checked
 * against the well-known whole-Bible total of 1189 chapters (929 OT + 260 NT),
 * which `tests/scripture-books.test.ts` pins alongside spot checks (GEN 50,
 * PSA 150, OBA 1) named in #253's fix shape.
 */

import scriptureBooksData from "@/data/scripture-books.json";
import type { Template } from "@/lib/storage/templates";

export interface ScriptureBook {
  /** USFM book code, e.g. "RUT", "1CO". */
  readonly code: string;
  /** English name, e.g. "Ruth", "1 Corinthians". */
  readonly name: string;
  readonly chapters: number;
}

const SCRIPTURE_BOOKS = scriptureBooksData as readonly ScriptureBook[];

/** All 66 books, in canonical (Genesis → Revelation) order. */
export function listScriptureBooks(): readonly ScriptureBook[] {
  return SCRIPTURE_BOOKS;
}

export function getScriptureBook(code: string): ScriptureBook | undefined {
  return SCRIPTURE_BOOKS.find((b) => b.code === code);
}

/**
 * The "Book of the Bible" template: one Chapter per chapter of the named
 * book, one starter Segment per Chapter, referenced to its whole chapter.
 * Structure only — Q2's other half of the union, no content attached.
 *
 * Throws for an unknown USFM code rather than silently building an empty
 * book: a typo'd code is a bug in the caller (the picker, #246), not a
 * translator choice to honour.
 *
 * @pivotpending No caller yet — #246 (Template Library UI) is the picker
 * that calls this and hands the result to `createBookFromTemplate`. This
 * lane (#253, part of #33) builds only the storage/lib half.
 */
export function bibleBookTemplate(code: string): Template {
  const book = getScriptureBook(code);
  if (!book) throw new Error(`Unknown scripture book code: ${code}`);

  return {
    id: `bible:${book.code}`,
    title: book.name,
    source: { kind: "scripture", book: book.code },
    chapters: () =>
      Array.from({ length: book.chapters }, (_, i) => {
        const number = i + 1;
        return {
          number,
          segments: [{ reference: { book: book.code, scope: String(number) } }],
        };
      }),
  };
}
