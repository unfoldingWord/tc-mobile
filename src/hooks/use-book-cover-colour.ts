import { useCallback, useRef, useState } from "react";

import { setBookCoverColour as setBookCoverColourInStore } from "@/lib/storage/books";
import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import type { CoverColourKey } from "@/lib/cover-colour";
import type { Book, BookId } from "@/types/domain";

/**
 * Set a book's cover colour. Reusable: each caller mounts its own instance.
 *
 * Mounted by the O4 book menu (#949, `books-screen.tsx`). The new-book sheet
 * (#943) does not mount it yet.
 *
 * Built the way `useEraseSegment` is: the store call lives in a plain async
 * function (`performSetCoverColour`, exercised in Node against the real store
 * through fake-indexeddb) and the hook is thin React glue over it — an
 * in-flight guard, nothing else. There is no shared error state to bleed
 * between screens, for the same reason `useEraseSegment`'s docblock gives:
 * each caller gets the outcome of the call IT made and holds its own Notice.
 */

/**
 * The actual write, minus React. Never throws: a failure is caught, reported
 * to the funnel under `"book-cover-colour"` (AGENTS.md's failure-funnel list,
 * updated in this same PR), and returned as a `strings`-mapped
 * {@link FailureKey} (#172) — never the raw store message.
 *
 * `tests/use-book-cover-colour.test.ts` exercises it directly, the same split
 * `use-erase-segment.ts`'s `performErase` draws.
 */
export async function performSetCoverColour(
  bookId: BookId,
  key: CoverColourKey | null
): Promise<{ ok: true; book: Book } | { ok: false; key: FailureKey }> {
  try {
    const book = await setBookCoverColourInStore(bookId, key);
    return { ok: true, book };
  } catch (cause) {
    // One row per real failure (#456); console.error kept beside it, exactly
    // as `performErase` does.
    console.error("Setting a book's cover colour failed", cause);
    reportFailure(cause, "book-cover-colour");
    return {
      ok: false,
      key: failureKey(cause, "saveFailed"),
    };
  }
}

/**
 * The outcome of a call to `setCoverColour`. `"busy"` mirrors
 * `useEraseSegment`'s `EraseResult`: a second call for the SAME book while
 * its first write is still in flight is REFUSED, not a result, so a caller
 * must not treat it as an answer about the colour it just tried to set. A
 * call for a DIFFERENT book proceeds regardless (#1046 item 4) — the guard
 * is per-book, not per hook instance.
 */
type SetCoverColourResult =
  { ok: true; book: Book } | "busy" | { failed: FailureKey };

export interface UseBookCoverColour {
  /** Set `bookId`'s cover colour to `key` (or `null` to clear it back to the
   *  derived fallback, `lib/cover-colour.ts`'s `resolveCoverKey`). */
  setCoverColour(
    bookId: BookId,
    key: CoverColourKey | null
  ): Promise<SetCoverColourResult>;
  /** True while ANY write is in flight, across every book — a picker could
   *  disable its swatches on this, the same shape `useEraseSegment`'s
   *  `erasing` disables its Erase button, though the O4 picker
   *  (`o4-book-menu.tsx`'s `O4CoverPick`) deliberately does not: see that
   *  component's own docblock for why it relies on the per-book `"busy"`
   *  refusal instead. */
  settingCoverColour: boolean;
}

/**
 * `books-screen.tsx` (#949) is the only production caller today, mounting
 * one instance for the whole shelf — so the in-flight guard below is keyed
 * by `bookId`, not a single flag, or a write for one book in flight would
 * spuriously refuse an unrelated write for a different book as `"busy"`.
 * The new-book sheet (#943) does not mount this hook (see the docblock
 * above); if a second caller ever does, each `useBookCoverColour()` call
 * gets its own React state and its own guard, same as any other hook.
 */
export function useBookCoverColour(): UseBookCoverColour {
  const [settingCoverColour, setSettingCoverColour] = useState(false);
  const inFlight = useRef<Set<BookId>>(new Set());

  const setCoverColour = useCallback(
    async (
      bookId: BookId,
      key: CoverColourKey | null
    ): Promise<SetCoverColourResult> => {
      // Marked busy before the first `await`, not after (AGENTS.md), so a
      // second call for the SAME book made in the same tick is refused
      // rather than racing this one.
      if (inFlight.current.has(bookId)) return "busy";
      inFlight.current.add(bookId);
      setSettingCoverColour(true);
      try {
        const result = await performSetCoverColour(bookId, key);
        return result.ok ? result : { failed: result.key };
      } finally {
        inFlight.current.delete(bookId);
        setSettingCoverColour(inFlight.current.size > 0);
      }
    },
    []
  );

  return { setCoverColour, settingCoverColour };
}
