import { useCallback, useEffect, useRef, useState } from "react";

import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import { getBook } from "@/lib/storage/books";
import { setBookLicence } from "@/lib/storage/licence";
import type { Book, BookId } from "@/types/domain";
import type { LicenceId } from "@/types/template";

/**
 * Whether Share Book asks which licence first (#1455, S6 `once-per-book`: "Once
 * per book, with a way to change it later"). Only a book whose licence is not
 * chosen (`null`) asks. A template book is written CC BY-SA 4.0 when it is
 * made (D5 `lock-template`), so it never reaches the ask; the writer refuses
 * one too (`TemplateLicenceLockedError`).
 */
export function needsLicenceAsk(book: {
  readonly licence?: LicenceId | null;
}): boolean {
  return (book.licence ?? null) === null;
}

/** Store the ask's pick (#1455). Reports "book-licence"; `choose` also guards a throw. */
async function performSetBookLicence(
  bookId: BookId,
  licence: LicenceId
): Promise<{ ok: true; book: Book } | { ok: false; key: FailureKey }> {
  try {
    return { ok: true, book: await setBookLicence(bookId, licence) };
  } catch (cause) {
    // A template book's licence is fixed (D5) and the writer refuses it. The
    // card only knows `null`, so a template book that somehow still reads null
    // must not trap the share inside this ask: share it as it is, untagged.
    // Matched by name, as `isBookNameTaken` is, so no class identity is needed.
    if (
      (cause as { name?: unknown } | null)?.name ===
      "TemplateLicenceLockedError"
    ) {
      try {
        const book = await getBook(bookId);
        if (book) return { ok: true, book };
      } catch (readCause) {
        // The fallback read failing is a failed save like any other: the
        // original refusal is what is reported, and the ask stays open.
        console.error("Reading a template book back failed", readCause);
      }
    }
    return failedSave(cause);
  }
}

/** The one failure result: console, funnel (which may itself throw), key. */
function failedSave(cause: unknown): { ok: false; key: FailureKey } {
  console.error("Saving a book's licence failed", cause);
  try {
    reportFailure(cause, "book-licence");
  } catch (reportCause) {
    console.error("Reporting a licence failure failed", reportCause);
  }
  return { ok: false, key: failureKey(cause, "saveFailed") };
}

/**
 * The ask's book, its in-flight write and a failed write's key, shaped like
 * `useLanguageAsk`. `choose` goes busy before its first await and clears it in
 * a `finally`, so no exit (success, a failed write, a failed fallback read, a
 * throwing callback, an unmount) leaves the ask busy. A run an unmount
 * overtook resolves `null`, so a closed ask never continues a share.
 *
 * While a write is in flight the ask cannot be left or restarted: `cancel` and
 * `ask` are no-ops and `isSaving` says so for the sheet that hosts it. A write
 * that commits is reported to `onCommitted` even if its result is dropped, so
 * the shelf never keeps showing "not chosen" for a licence that was stored.
 */
export function useLicenceAsk(onCommitted?: () => void) {
  const committed = useRef(onCommitted);
  useEffect(() => {
    committed.current = onCommitted;
  });
  const [askingFor, setAskingFor] = useState<BookId | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<FailureKey | null>(null);
  const session = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => () => void (session.current += 1), []);

  const ask = useCallback((bookId: BookId | null) => {
    if (savingRef.current) return;
    session.current += 1;
    savingRef.current = false;
    setSaving(false);
    setFailed(null);
    setAskingFor(bookId);
  }, []);
  const cancel = useCallback(() => ask(null), [ask]);
  const isSaving = useCallback(() => savingRef.current, []);

  const choose = useCallback(
    async (licence: LicenceId): Promise<Book | null> => {
      if (askingFor === null || savingRef.current) return null;
      const mine = session.current;
      savingRef.current = true;
      setSaving(true);
      setFailed(null);
      try {
        let result: Awaited<ReturnType<typeof performSetBookLicence>>;
        try {
          result = await performSetBookLicence(askingFor, licence);
        } catch (cause) {
          // Defensive: perform reports its own failures, so this is a throw
          // from somewhere it did not expect. Still a failed save.
          result = failedSave(cause);
        }
        if (result.ok) {
          try {
            committed.current?.();
          } catch (cause) {
            // The reload is best effort; the write itself committed.
            console.error("After a licence commit, the callback failed", cause);
          }
        }
        if (session.current !== mine) return null;
        if (!result.ok) {
          setFailed(result.key);
          return null;
        }
        setAskingFor(null);
        return result.book;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [askingFor]
  );

  return { askingFor, saving, failed, ask, cancel, choose, isSaving };
}
