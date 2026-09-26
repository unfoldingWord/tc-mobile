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
 * The optimistic card a create inserts carries the key the store returned
 * too, so a book created with a colour (#943's picker) does not show its
 * id-derived fallback until the reload lands.
 */

/**
 * Two seams on the real store, both off unless a case turns them on:
 * `holdLoads` parks every shelf load so a case can read the optimistic card
 * before the reload replaces it, and `createAs` makes `createBook` store and
 * return a chosen key — no production create does that yet, so without it
 * the optimistic card's key would be `null` either way.
 */
const seams = vi.hoisted(() => ({
  holdLoads: null as Promise<void> | null,
  createAs: null as string | null,
}));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: async () => {
      if (seams.holdLoads) await seams.holdLoads;
      return actual.listBooks();
    },
    createBook: async (name: string) => {
      const book = await actual.createBook(name);
      if (seams.createAs === null) return book;
      await actual.setBookCoverColour(book.id, seams.createAs);
      return { ...book, coverColourKey: seams.createAs };
    },
  };
});

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
  seams.holdLoads = null;
  seams.createAs = null;
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

it("puts the created book's key on its optimistic card, before the reload lands", async () => {
  await mount();
  let release!: () => void;
  seams.holdLoads = new Promise((resolve) => (release = resolve));
  seams.createAs = "teal";

  await act(async () => {
    const outcome = await hook().createBook("Mark");
    expect(outcome.ok).toBe(true);
  });
  // The reload is parked, so this is the optimistic card.
  const [card] = hook().books;
  expect(card?.name).toBe("Mark");
  expect(card?.coverColourKey).toBe("teal");

  seams.holdLoads = null;
  await act(async () => release());
});
