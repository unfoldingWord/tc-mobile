import { useCallback, useEffect, useRef, useState } from "react";

import { reportFailure } from "./report-failure";
import { failureKey, type FailureKey } from "./save-failure";
import { type LanguageList, loadLanguageList } from "@/lib/languages/list";
import { setBookLanguageOnce } from "@/lib/storage/books";
import type { Book, BookId } from "@/types/domain";

/** Store the ask's pick (#1492). Never throws: reports "book-language". */
export async function performSetBookLanguage(
  bookId: BookId,
  tag: string
): Promise<{ ok: true; book: Book } | { ok: false; key: FailureKey }> {
  try {
    return { ok: true, book: await setBookLanguageOnce(bookId, tag) };
  } catch (cause) {
    console.error("Saving a book's language failed", cause);
    reportFailure(cause, "book-language");
    return { ok: false, key: failureKey(cause, "saveFailed") };
  }
}

/**
 * The ask's book, its in-flight write and a failed write's key. `choose` goes
 * busy before its first await; a run a `cancel`, a newer `ask` or an unmount
 * overtook resolves `null`, so a closed ask never continues an export.
 */
export function useLanguageAsk() {
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
    async (tag: string): Promise<Book | null> => {
      if (askingFor === null || savingRef.current) return null;
      const mine = session.current;
      savingRef.current = true;
      setSaving(true);
      setFailed(null);
      const result = await performSetBookLanguage(askingFor, tag);
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

/** The bundled list as the ask reads it: loading, ready or failed. */
export type LanguageListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly list: LanguageList }
  | { readonly kind: "failed" };

/** Load the bundled list while `active`; a failure reports "language-list". */
export function useLanguageList(active: boolean) {
  const [state, setState] = useState<LanguageListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    loadLanguageList().then(
      (list) => live && setState({ kind: "ready", list }),
      (cause: unknown) => {
        reportFailure(cause, "language-list");
        if (live) setState({ kind: "failed" });
      }
    );
    return () => void (live = false);
  }, [active, attempt]);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
