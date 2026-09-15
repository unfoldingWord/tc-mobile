/**
 * Where focus goes after a delete resolves — derived, never decided at the
 * call site (#364).
 *
 * Deleting a book destroys the control that had focus: on success the row
 * unmounts, and on failure the confirm dialog that holds Cancel unmounts. Either
 * way a keyboard or switch user is left on the document unless something hands
 * focus on deliberately. Two rounds of review were spent getting that wrong, so
 * the CHOICE lives here as a pure function with a test table, and the screen
 * keeps only the DOM mechanics.
 *
 * **The two halves fail differently, and only one of them is testable here.**
 * This function answers "which node"; getting that wrong is a logic bug, and
 * `tests/delete-focus.test.ts` pins it in plain Node. The other half is "when" —
 * focus must move only once the shelf is no longer `inert`, because an element
 * in an inert subtree cannot take focus at all. That half is DOM ordering and
 * this repo cannot test it: `tests/` runs in Node with no jsdom and no
 * testing-library (#361). It is code-read only, and says so rather than
 * implying coverage it does not have.
 */

import type { BookId } from "@/types/domain";

/**
 * The focus-target key for the empty state's CTA.
 *
 * The screen's node map is keyed by book and chapter id (both UUIDs), so a
 * literal with a non-UUID shape cannot collide with a row. Lives here, beside
 * the only function that returns it, so the constant and its meaning cannot
 * drift apart.
 */
export const EMPTY_STATE_NODE = "books-empty-state";

/** What `deleteBook` reported. `"busy"` is not an outcome — the first call owns it. */
export type DeleteOutcome = "ok" | "failed";

/**
 * The node key the screen should focus once the delete confirm has come down.
 *
 * `shelf` is the book order **as it was before the delete**, which is what the
 * caller can still see at confirm time.
 *
 * - **failed** — the book is still on the shelf, so focus returns to its own
 *   row. Nothing moved; the Notice explains why.
 * - **ok** — the row is gone, so focus goes to whatever takes its place: the
 *   book below it (which slides up into the same position), else the book above
 *   it (deleting the last row), else the empty state's CTA, which is the only
 *   control left on an emptied shelf.
 *
 * An id that is not on the shelf resolves to the empty state rather than to
 * `shelf[0]`: `indexOf` returns -1 there, and `shelf[-1 + 1]` would silently
 * hand focus to the FIRST book — a wrong answer that looks like a right one.
 */
export function focusTargetAfterDelete(
  outcome: DeleteOutcome,
  deletedBookId: BookId,
  shelf: readonly BookId[]
): string {
  if (outcome === "failed") return deletedBookId;
  const index = shelf.indexOf(deletedBookId);
  if (index < 0) return EMPTY_STATE_NODE;
  return shelf[index + 1] ?? shelf[index - 1] ?? EMPTY_STATE_NODE;
}
