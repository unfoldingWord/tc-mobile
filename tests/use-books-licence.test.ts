import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import { createBook } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * #1579 item 3: each shelf card carries its book's licence (#1566), so the
 * Books screen's Share Book can name its files with it. The hook is mounted
 * for real over fake-indexeddb, the harness `use-books-cover-colour.test.ts`
 * uses. No production path sets a licence yet (S6), so the stored row is
 * written directly.
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

it("loads each book's stored licence onto its card, and null where none is chosen", async () => {
  const licensed = await createBook("Mark");
  const db = await getDb();
  await db.put("books", { ...licensed, licence: "CC-BY-4.0" });
  const unchosen = await createBook("Ruth");
  await mount();

  const byId = new Map(hook().books.map((card) => [card.bookId, card]));
  expect(byId.get(licensed.id)?.licence).toBe("CC-BY-4.0");
  expect(byId.get(unchosen.id)?.licence).toBeNull();
});

it("puts the created book's licence on its optimistic card", async () => {
  await mount();
  await act(async () => {
    const outcome = await hook().createBook("Mark");
    expect(outcome.ok).toBe(true);
  });
  // A new book has no licence chosen; the card says so rather than omitting it.
  expect(hook().books[0]?.licence).toBeNull();
});
