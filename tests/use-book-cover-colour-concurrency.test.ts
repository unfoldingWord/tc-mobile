import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  useBookCoverColour,
  type UseBookCoverColour,
} from "@/hooks/use-book-cover-colour";
import { createBook } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { BookId } from "@/types/domain";

type SetCoverColourResult = Awaited<
  ReturnType<UseBookCoverColour["setCoverColour"]>
>;

/**
 * #1046 item 4 (George Low, #1038): a second cover-colour write is silently
 * refused (`"busy"`) while a write is already in flight. The book menu's own
 * docblock (`o4-book-menu.tsx`, `O4CoverPick`) already documents that this is
 * deliberate FOR THE SAME BOOK — the swatches stay tappable, and the hook
 * refuses the conflicting second write rather than disabling anything. What
 * that design note does not cover, and what `tests/use-book-cover-colour
 * .test.ts` says needs a jsdom mount it does not provide (it exercises only
 * `performSetCoverColour`, minus the React guard), is that `BooksScreen`
 * mounts exactly ONE `useBookCoverColour()` instance for the whole shelf
 * (`books-screen.tsx:1254`) — so a write for one book and a write for a
 * DIFFERENT book can be in flight at the same time, and a hook-wide (rather
 * than per-book) guard would refuse the second one too, even though nothing
 * about it conflicts with the first.
 *
 * This file mounts the real hook (a `useLayoutEffect` probe, the pattern
 * `tests/use-books-cover-colour.test.ts` already uses) over the real store
 * (fake-indexeddb), with `setBookCoverColour` deferred so two calls can
 * genuinely overlap.
 */

const seams = vi.hoisted(() => ({
  hold: null as { promise: Promise<void>; release: () => void } | null,
}));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    setBookCoverColour: async (
      id: BookId,
      key: string | null,
      now?: number
    ) => {
      if (seams.hold) await seams.hold.promise;
      return actual.setBookCoverColour(id, key, now);
    },
  };
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useBookCoverColour> | null } = {
  current: null,
};
function Probe() {
  const result = useBookCoverColour();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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
  seams.hold = null;
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

it("refuses a second write for the SAME book while its first write is in flight", async () => {
  await mount();
  const bookA = await createBook("Mark");
  seams.hold = deferred();

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookA.id, "teal")
      .then((r) => (secondResult = r));
    seams.hold!.release();
    await Promise.all([first, second]);
  });

  expect(secondResult!).toBe("busy");
  expect(firstResult!).toMatchObject({ ok: true });
});

it("does NOT refuse a write for a DIFFERENT book while another book's write is in flight (#1046 item 4)", async () => {
  await mount();
  const bookA = await createBook("Mark");
  const bookB = await createBook("Ruth");
  seams.hold = deferred();

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookB.id, "teal")
      .then((r) => (secondResult = r));
    seams.hold!.release();
    await Promise.all([first, second]);
  });

  expect(secondResult!).toMatchObject({ ok: true });
  expect(firstResult!).toMatchObject({ ok: true });
});

it("allows a second write for the SAME book once the first has settled (not stuck busy)", async () => {
  await mount();
  const bookA = await createBook("Mark");

  const first = await act(async () =>
    hook().setCoverColour(bookA.id, "forest")
  );
  expect(first).toMatchObject({ ok: true });

  const second = await act(async () => hook().setCoverColour(bookA.id, "teal"));
  expect(second).toMatchObject({ ok: true });
});
