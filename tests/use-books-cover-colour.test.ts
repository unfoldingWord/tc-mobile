import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import { createBook, setBookCoverColour } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * The shelf carries each book's stored cover key through to its card (#942),
 * so the O4 cover can resolve it with `resolveCoverKey` (#957) instead of
 * only ever seeing the id-derived fallback. The hook is mounted for real over
 * fake-indexeddb — the harness `tests/use-books-failure-key.test.ts` uses —
 * so the load path (`loadBookCard`) is the real code.
 *
 * The optimistic card a create inserts carries no key: a fresh book has
 * never chosen one, and a card without the field resolves exactly like a
 * `null` one (`types/view.ts`), so the reload that follows is what brings the
 * stored value in.
 */

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useBooks> | null } = {
  current: null,
};

function Probe() {
  const result = useBooks();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

beforeEach(async () => {
  // Clear every store rather than deleting the database (AGENTS.md).
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
}

it("loads each book's stored cover key onto its card, and null where none was chosen", async () => {
  const chosen = await createBook("Mark");
  await setBookCoverColour(chosen.id, "plum");
  const unchosen = await createBook("Ruth");
  await mount();

  const byId = new Map(hook().books.map((card) => [card.bookId, card]));
  expect(byId.get(chosen.id)?.coverColourKey).toBe("plum");
  expect(byId.get(unchosen.id)?.coverColourKey).toBeNull();
});
