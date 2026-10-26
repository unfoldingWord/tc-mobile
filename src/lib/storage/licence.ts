/**
 * The one write of a book's licence after it is created (#1455, storage half).
 *
 * D5-licence (`lock-template`): "Books made from a template are CC BY-SA 4.0;
 * other books choose". R20 (`empty-preselect`): "Empty until someone chooses;
 * CC BY-SA 4.0 is pre-selected when they share". So a book made blank starts
 * at `null` (`createBook`), a template book is written CC BY-SA 4.0 by
 * `createBookFromPlan`, and this is where a choice for a blank book lands.
 * The pre-selection is the share step's, not this store's: nothing here
 * writes a licence nobody chose.
 *
 * Kept out of `books.ts`, which is already the tree's long file.
 */

import type { Book, BookId } from "@/types/domain";
import type { LicenceId } from "@/types/template";
import { abortQuietly } from "./books";
import { getDb } from "./db";

/**
 * A licence write aimed at a book made from a template. Its licence is fixed
 * by D5, and the lock is `provenance.kind === "template"` (`Book.licence`).
 */
export class TemplateLicenceLockedError extends Error {
  constructor(readonly bookId: BookId) {
    super(`A template book's licence is fixed: ${bookId}`);
    this.name = "TemplateLicenceLockedError";
  }
}

/**
 * Set a blank book's licence. Get-then-put in ONE readwrite transaction.
 *
 * - A template book is refused with {@link TemplateLicenceLockedError} for
 *   every value, its current one included, and nothing is written: a caller
 *   that offers the choice on such a book is the defect.
 * - `null` is "not chosen" and may be written; which choice, if any, a
 *   share step stores as `null` is that step's call (whether "Other" is
 *   `all-rights-reserved` is open, U1a).
 * - The value the book already holds is a no-op: no put, `modifiedAt` stays.
 * - A change stamps `modifiedAt` and leaves `updatedAt`: choosing a licence is
 *   not shelf activity (as `setBookLanguageOnce`).
 *
 * A missing book throws `No such book: <id>`, the shape `isStaleBookFailure`
 * reads.
 */
export async function setBookLicence(
  id: BookId,
  licence: LicenceId | null,
  now: number = Date.now()
): Promise<Book> {
  const db = await getDb();
  const tx = db.transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (!book || book.provenance.kind === "template") {
    // A thrown error does not roll the transaction back; left alone it
    // autocommits with `done` never observed. Abort it and own the rejection.
    await abortQuietly(() => tx.abort(), tx.done);
    if (!book) throw new Error(`No such book: ${id}`);
    throw new TemplateLicenceLockedError(id);
  }
  if (book.licence === licence) {
    await tx.done; // idempotent no-op: no write.
    return book;
  }
  const updated: Book = { ...book, licence, modifiedAt: now };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}
