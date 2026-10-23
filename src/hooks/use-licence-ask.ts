import { useCallback, useEffect, useRef, useState } from "react";

import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
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

/** Store the ask's pick (#1455). Never throws: reports "book-licence". */
async function performSetBookLicence(
  bookId: BookId,
  licence: LicenceId
): Promise<{ ok: true; book: Book } | { ok: false; key: FailureKey }> {
  try {
    return { ok: true, book: await setBookLicence(bookId, licence) };
  } catch (cause) {
    console.error("Saving a book's licence failed", cause);
    reportFailure(cause, "book-licence");
    return { ok: false, key: failureKey(cause, "saveFailed") };
  }
}

/**
 * The ask's book, its in-flight write and a failed write's key, shaped like
 * `useLanguageAsk`. `choose` goes busy before its first await; a run a
 * `cancel`, a newer `ask` or an unmount overtook resolves `null`, so a closed
 * ask never continues a share.
 */
export function useLicenceAsk() {
  const [askingFor, setAskingFor] = useState<BookId | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<FailureKey | null>(null);
  const session = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => () => void (session.current += 1), []);

  const ask = useCallback((bookId: BookId | null) => {
    session.current += 1;
    savingRef.current = false;
    setSaving(false);
    setFailed(null);
    setAskingFor(bookId);
  }, []);
  const cancel = useCallback(() => ask(null), [ask]);

  const choose = useCallback(
    async (licence: LicenceId): Promise<Book | null> => {
      if (askingFor === null || savingRef.current) return null;
      const mine = session.current;
      savingRef.current = true;
      setSaving(true);
      setFailed(null);
      const result = await performSetBookLicence(askingFor, licence);
      if (session.current !== mine) return null;
      savingRef.current = false;
      setSaving(false);
      if (!result.ok) {
        setFailed(result.key);
        return null;
      }
      setAskingFor(null);
      return result.book;
    },
    [askingFor]
  );

  return { askingFor, saving, failed, ask, cancel, choose };
}
