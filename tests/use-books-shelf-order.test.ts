import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import { createBook, setBookCoverColour } from "@/lib/storage/books";
import type { BookId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * #1185: books stay put. The shelf the hook holds keeps each card where it
 * is through an add chapter, a rename and a cover colour change, both in the
 * optimistic patch (read while every shelf load is parked) and after the
 * reload that follows it; a new book still lands first.
 *
 * The hook is mounted for real over fake-indexeddb, the harness
 * `tests/use-books-cover-colour.test.ts` uses. The seam wraps `listBooks`:
 * `holdLoads` parks it so a case can read the patched shelf before the
 * reload replaces it, and `listed` records the order each call returned, so
 * a case can tell the reload's read has happened. The patched shelf already
 * matches the expected order, so waiting on the shelf alone would pass
 * before the reload lands.
 */

const seams = vi.hoisted(() => ({
  holdLoads: null as Promise<void> | null,
  listed: [] as string[][],
}));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: async () => {
      if (seams.holdLoads) await seams.holdLoads;
      const books = await actual.listBooks();
      seams.listed.push(books.map((book) => book.id));
      return books;
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
const order = () => hook().books.map((card) => card.bookId);

beforeEach(async () => {
  await clearAllStores();
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
  seams.listed = [];
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

/**
 * Parks every shelf load until the returned function is called. That
 * function releases them, waits for a `listBooks` read made after the
 * release, and returns the order that read returned.
 */
function holdLoads(): () => Promise<string[]> {
  let release!: () => void;
  seams.holdLoads = new Promise((resolve) => (release = resolve));
  const before = seams.listed.length;
  return async () => {
    seams.holdLoads = null;
    await act(async () => release());
    await vi.waitFor(() => expect(seams.listed.length).toBeGreaterThan(before));
    return seams.listed.at(-1)!;
  };
}

/** Three books with distinct, early creation times; the shelf shows them
 *  newest-created first: [third, second, first]. */
async function threeBooks(): Promise<[BookId, BookId, BookId]> {
  const first = await createBook("First", null, 1_000);
  const second = await createBook("Second", null, 2_000);
  const third = await createBook("Third", null, 3_000);
  return [third.id, second.id, first.id];
}

it("an add chapter keeps the card in place, in the patch and after the reload", async () => {
  const shelf = await threeBooks();
  await mount();
  expect(order()).toEqual(shelf);

  const release = holdLoads();
  await act(async () => {
    expect(await hook().addChapter(shelf[1], "")).not.toBeNull();
  });
  // The reload is parked: this is the optimistic patch.
  expect(order()).toEqual(shelf);
  expect(hook().books[1]?.chapters).toHaveLength(1);

  // The reload read the store in the same order, and the shelf shows it.
  expect(await release()).toEqual(shelf);
  await vi.waitFor(() => expect(order()).toEqual(shelf));
});

it("a real rename keeps the card in place, in the patch and after the reload", async () => {
  const shelf = await threeBooks();
  await mount();

  const release = holdLoads();
  await act(async () => {
    expect(await hook().renameBook(shelf[2], "Mark")).not.toBeNull();
  });
  expect(order()).toEqual(shelf);
  expect(hook().books[2]?.name).toBe("Mark");

  // The reload read the store in the same order, and the shelf shows it.
  expect(await release()).toEqual(shelf);
  await vi.waitFor(() => expect(order()).toEqual(shelf));
});

it("a cover colour change keeps the card in place after the reload", async () => {
  // The Books screen's path: the store write, then `reload()`
  // (`books-screen.tsx`'s `onChooseCover`). There is no optimistic patch.
  // The LAST card is recoloured, so a write that floated it would move it.
  const shelf = await threeBooks();
  await mount();

  await setBookCoverColour(shelf[2], "forest");
  await act(async () => hook().reload());

  // Wait for the reload by the card's id, not its slot, so a moved card
  // fails on the order below rather than timing out here.
  await vi.waitFor(() =>
    expect(
      hook().books.find((card) => card.bookId === shelf[2])?.coverColourKey
    ).toBe("forest")
  );
  expect(order()).toEqual(shelf);
});

it("the order survives a remount after all three writes", async () => {
  // The issue's own check: add a chapter to the second card, rename the
  // third, recolour the first. A strictly increasing clock for the writes
  // alone, so each one gets its own `updatedAt` rather than a tie.
  const shelf = await threeBooks();
  await mount();
  let clock = 10_000;
  const now = vi.spyOn(Date, "now").mockImplementation(() => (clock += 10));
  await act(async () => {
    await hook().addChapter(shelf[1], "");
    await hook().renameBook(shelf[2], "Mark");
  });
  await setBookCoverColour(shelf[0], "forest");
  now.mockRestore();

  await act(async () => root.unmount());
  root = createRoot(dom.window.document.getElementById("root")!);
  await mount();

  expect(order()).toEqual(shelf);
});

it("a new book lands first, in the patch and after the reload", async () => {
  const shelf = await threeBooks();
  await mount();

  const release = holdLoads();
  let created: BookId | undefined;
  await act(async () => {
    const outcome = await hook().createBook("Luke");
    if (outcome.ok) created = outcome.book.id;
  });
  expect(created).toBeDefined();
  expect(order()).toEqual([created, ...shelf]);

  expect(await release()).toEqual([created, ...shelf]);
  await vi.waitFor(() => expect(order()).toEqual([created, ...shelf]));
});
