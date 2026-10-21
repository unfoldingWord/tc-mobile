/**
 * What a shared chapter MP3's ID3 tag says (#252, S7), from the book and the
 * chapter it came from. The bytes are `lib/audio/id3.ts`'s; this module only
 * chooses the words.
 *
 * - TIT2 is the chapter's own name and TALB the book's, and only when someone
 *   typed one: an unnamed chapter or book gets no frame, not the English
 *   placeholder the screen renders, which would freeze one UI language into a
 *   file that leaves the phone (#169). TRCK still says which chapter it is.
 * - COMM is the template's attribution as it read when the book was made, and
 *   only for a book made from a template (ADR 0006 implication 2). A blank
 *   book has nothing to attribute.
 * - TCOP is not written yet. It is the chosen licence's label, and that label
 *   comes from #1566's helper (`lib/export/licence-tag.ts`), which is not on
 *   develop as this lands; one label table, not two, so this waits for it.
 *
 * Nothing else about the book, the phone or the person goes into the tag.
 */

import { type Id3Fields, withId3v2 } from "@/lib/audio/id3";
import { getBook, getChapter } from "@/lib/storage/books";
import type { Book, Chapter, ChapterId } from "@/types/domain";

/** The tag fields for one chapter of `book`. */
export function chapterId3Fields(
  book: Pick<Book, "name" | "provenance">,
  chapter: Pick<Chapter, "name" | "number">
): Id3Fields {
  return {
    title: chapter.name,
    album: book.name,
    track: chapter.number,
    copyright: null,
    comment:
      book.provenance.kind === "template" ? book.provenance.attribution : null,
  };
}

/**
 * A shared chapter file as its parts (`withId3v2`): the chapter's tag, read
 * from storage, then `mp3` itself, the same buffer. `mp3` alone when the
 * chapter or its book is gone, rather than failing a share over its label.
 * Share Chapter hands these straight to `new File(parts)`.
 */
export async function chapterFileParts(
  chapterId: ChapterId,
  mp3: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>[]> {
  const chapter = await getChapter(chapterId);
  const book = chapter ? await getBook(chapter.bookId) : undefined;
  if (!chapter || !book) return [mp3];
  return withId3v2(mp3, chapterId3Fields(book, chapter));
}
