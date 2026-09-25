import { useCallback, useRef, useState } from "react";

import { setBookCoverColour as setBookCoverColourInStore } from "@/lib/storage/books";
import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import type { CoverColourKey } from "@/lib/cover-colour";
import type { Book, BookId } from "@/types/domain";

/**
 * Set a book's cover colour — the reusable hook the sheets lane (#943, the
 * new-book sheet) and the menus lane (#949, the book menu) each mount their
 * own instance of.
 *
 * @pivotpending Exported for #943 and #949 to wire up; this lane (#957) does
 * not mount either surface (item 6 of the issue: "nothing changes on
 * screen"), so this hook has no production caller yet.
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
 * @pivotpending No production caller yet — see this module's own docblock.
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
 * `useEraseSegment`'s `EraseResult`: a second call while the first is still
 * in flight is REFUSED, not a result, so a caller must not treat it as an
 * answer about the colour it just tried to set.
 */
type SetCoverColourResult =
  { ok: true; book: Book } | "busy" | { failed: FailureKey };

/**
 * @pivotpending No production caller yet — see this module's own docblock.
 */
export interface UseBookCoverColour {
  /** Set `bookId`'s cover colour to `key` (or `null` to clear it back to the
   *  derived fallback, `lib/cover-colour.ts`'s `resolveCoverKey`). */
  setCoverColour(
    bookId: BookId,
    key: CoverColourKey | null
  ): Promise<SetCoverColourResult>;
  /** True while a write is in flight — a picker disables its swatches on this,
   *  the same shape `useEraseSegment`'s `erasing` disables its Erase button. */
  settingCoverColour: boolean;
}

/**
 * @pivotpending No production caller yet — see this module's own docblock.
 * #943 and #949 are each expected to mount their own instance, the same way
 * `useEraseSegment` is mounted once and shared today.
 */
export function useBookCoverColour(): UseBookCoverColour {
  const [settingCoverColour, setSettingCoverColour] = useState(false);
  const settingRef = useRef(false);

  const setCoverColour = useCallback(
    async (
      bookId: BookId,
      key: CoverColourKey | null
    ): Promise<SetCoverColourResult> => {
      if (settingRef.current) return "busy";
      settingRef.current = true;
      setSettingCoverColour(true);
      try {
        const result = await performSetCoverColour(bookId, key);
        return result.ok ? result : { failed: result.key };
      } finally {
        settingRef.current = false;
        setSettingCoverColour(false);
      }
    },
    []
  );

  return { setCoverColour, settingCoverColour };
}
