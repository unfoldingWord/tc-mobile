// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useLanguageAsk } from "@/hooks/use-language-ask";
import type { Book, BookId } from "@/types/domain";

/**
 * Two picks in the same render (#1630, bench round 1): a double tap reaches
 * the ask's `choose` twice before React re-renders, so both calls hold the
 * same closure. The ask must write once and hand back a book once, because
 * Export project runs only on a non-null result (`books-screen.tsx`'s
 * `onPickLanguage`, pinned in `tests/export-project-handler.test.ts`).
 */

const setBookLanguageOnce = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/books", () => ({ setBookLanguageOnce }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

type Ask = ReturnType<typeof useLanguageAsk>;
const latestAsk: { current: Ask | null } = { current: null };
function Probe({ outRef }: { outRef: { current: Ask | null } }) {
  const ask = useLanguageAsk();
  useEffect(() => {
    outRef.current = ask;
  });
  return null;
}

let root: Root;
beforeEach(async () => {
  setBookLanguageOnce.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = "<div id='root'></div>";
  root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(createElement(Probe, { outRef: latestAsk }))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("writes once and hands back the book once for two picks in one render", async () => {
  const bookId = "b1" as BookId;
  await act(async () => latestAsk.current!.ask(bookId));
  let release: (book: Book) => void = () => {};
  setBookLanguageOnce.mockImplementation(
    () => new Promise<Book>((resolve) => (release = resolve))
  );

  // One closure for both taps: nothing re-renders between them.
  const { choose } = latestAsk.current!;
  let results: (Book | null)[] = [];
  await act(async () => {
    const first = choose("fr");
    const second = choose("en");
    release({ id: bookId, languageCode: "fr" } as Book);
    results = await Promise.all([first, second]);
  });

  expect(setBookLanguageOnce).toHaveBeenCalledTimes(1);
  expect(setBookLanguageOnce).toHaveBeenCalledWith(bookId, "fr");
  expect(results.filter((r) => r !== null)).toHaveLength(1);
  expect(results[0]?.languageCode).toBe("fr");
  expect(results[1]).toBeNull();
});
