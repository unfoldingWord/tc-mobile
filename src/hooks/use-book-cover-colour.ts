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
 * in-flight guard plus a one-slot coalescing queue (#1046 item 4; DRI
 * 2026-09-28: "Last tap wins"), nothing else. There is no shared error state
 * to bleed between screens, for the same reason `useEraseSegment`'s docblock
 * gives: each caller holds its own Notice. What a call's promise resolves to
 * (a queued call gets `"queued"`; the call that started the chain gets the
 * last write's outcome) is `SetCoverColourResult`'s docblock below.
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
 * The outcome of a call to `setCoverColour`.
 *
 * `"queued"` (#1046 item 4; DRI 2026-09-28: **"Last tap wins"** — "The second
 * tap queues behind the first, and the cover ends on the colour they tapped
 * last") is what a call for a book gets back while an earlier write for that
 * SAME book is still in flight. It is never a real answer about the colour
 * that call tried to set: the call is not refused, but its `key` overwrites
 * whatever was already queued for that book (`pending`, below) — so of a
 * rapid A -> B -> C burst, only C (the last one) ever reaches the store; B is
 * coalesced away and never written, exactly like an intermediate value any
 * "last write wins" queue drops. Once the in-flight write settles, the hook
 * writes the queued value next, and loops until nothing is left queued. Only
 * the ORIGINAL caller that started the still-running write — never a queued
 * one — eventually resolves with the real `{ ok }` / `{ failed }` outcome of
 * whichever write turned out to be last; every queued caller's own promise
 * resolves immediately with `"queued"`, which a caller must treat as "no
 * answer yet, do nothing", the same way it treated the old `"busy"`.
 *
 * An earlier write's FAILURE does not stop the queue: `performSetCoverColour`
 * already reports it to the failure funnel regardless of what this hook does
 * with the return value (AGENTS.md's failure-funnel list), and the user's
 * most recently tapped colour still deserves its own attempt rather than
 * being abandoned because an earlier, now-superseded write failed. Only the
 * LAST attempted write's outcome is returned to the original caller. When
 * that last write failed but an earlier one in the same chain committed, the
 * failure carries `committed: true`: the stored colour did change, so the
 * caller must re-read the store as well as show the failure.
 *
 * A call for a DIFFERENT book proceeds regardless — the guard and the queue
 * are both keyed per book, not per hook instance.
 */
type SetCoverColourResult =
  | { ok: true; book: Book }
  | "queued"
  | { failed: FailureKey; committed?: true };

export interface UseBookCoverColour {
  /** Set `bookId`'s cover colour to `key` (or `null` to clear it back to the
   *  derived fallback, `lib/cover-colour.ts`'s `resolveCoverKey`). */
  setCoverColour(
    bookId: BookId,
    key: CoverColourKey | null
  ): Promise<SetCoverColourResult>;
  /** True while ANY write is in flight, across every book, including any
   *  coalesced follow-up writes queued for the same book — a picker could
   *  disable its swatches on this, the same shape `useEraseSegment`'s
   *  `erasing` disables its Erase button, though the O4 picker
   *  (`o4-book-menu.tsx`'s `O4CoverPick`) deliberately does not: see that
   *  component's own docblock for why it relies on the `"queued"` result
   *  instead. */
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
  // The one queued-but-not-yet-written value per book (#1046 item 4). A
  // `Map`, not a plain object keyed by presence, so a queued `null` (clearing
  // the colour) is distinguishable from "nothing queued".
  const pending = useRef<Map<BookId, CoverColourKey | null>>(new Map());

  const setCoverColour = useCallback(
    async (
      bookId: BookId,
      key: CoverColourKey | null
    ): Promise<SetCoverColourResult> => {
      // Marked busy before the first `await`, not after (AGENTS.md): a
      // second call for the SAME book made in the same tick sees the book
      // already in flight and queues instead of racing this one.
      if (inFlight.current.has(bookId)) {
        pending.current.set(bookId, key);
        return "queued";
      }
      inFlight.current.add(bookId);
      setSettingCoverColour(true);
      try {
        let writeKey = key;
        let outcome = await performSetCoverColour(bookId, writeKey);
        // Whether ANY write in the chain reached the store: a success followed
        // by a failed queued write still changed the stored colour, so the
        // caller must re-read it rather than keep showing the old one.
        let committed = outcome.ok;
        // Coalescing loop: after each write settles, check whether a later
        // call queued a newer colour while this one was in flight. If so,
        // write THAT next (the write that just finished is what gets
        // superseded, not the other way round) and loop again — an earlier
        // write's failure does not stop the chain (see the docblock above).
        // Only the outcome of the LAST write in the chain is returned.
        while (pending.current.has(bookId)) {
          writeKey = pending.current.get(bookId)!;
          pending.current.delete(bookId);
          outcome = await performSetCoverColour(bookId, writeKey);
          committed ||= outcome.ok;
        }
        if (outcome.ok) return outcome;
        return committed
          ? { failed: outcome.key, committed: true }
          : { failed: outcome.key };
      } finally {
        inFlight.current.delete(bookId);
        pending.current.delete(bookId);
        setSettingCoverColour(inFlight.current.size > 0);
      }
    },
    []
  );

  return { setCoverColour, settingCoverColour };
}
