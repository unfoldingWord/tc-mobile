// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import type { Design } from "@/lib/design";
import {
  createBook,
  deleteBook,
  getBook,
  listBooks,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { Book, BookId } from "@/types/domain";

/**
 * #361 row 3, the component half: after a confirmed delete the deleted
 * book's row must leave the Books screen on the delete itself, not when the
 * reconciling shelf read lands (George R1 P2-1 on #344).
 *
 * #1106 pinned the hook half (`useBooks`'s `books` value drops the card) and
 * named the screen as not rendered. This file mounts the real `BooksScreen`
 * over the real `useBooks` and fake-indexeddb, taps through the real menu and
 * confirm in both looks, and holds every `listBooks` after the first load
 * open forever, so no later read can repair a shelf the delete left stale.
 * What is asserted is the DOM: no row, no ⋮ opener for the deleted book.
 *
 * Only the data hooks this screen needs a browser for are mocked, the way
 * `tests/books-delete-in-sheet-o4.test.ts` mocks them; `useBooks` is not.
 *
 * What this cannot show: layout, the cascade, or real `inert` hit-testing,
 * none of which jsdom does. It drives React through `act`, not a real frame.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: vi.fn(actual.listBooks),
    deleteBook: vi.fn(actual.deleteBook),
  };
});
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: "idle",
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    progress: { phase: "hidden" },
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({
  useFailureCount: () => 0,
  useMarkedFailureCount: () => 0,
}));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

let root: Root;
const layers = new Map<string, Layer>();

beforeEach(async () => {
  vi.clearAllMocks();
  layers.clear();
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  // Back to the real store functions, so a one-shot left queued by a failed
  // case cannot answer the next case's mount.
  vi.mocked(listBooks).mockReset();
  vi.mocked(deleteBook).mockReset();
  try {
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
    design.current = "o4";
  }
});

/** Every later `listBooks` stays pending, so only the delete can move the shelf. */
function holdEveryLaterRead(): void {
  vi.mocked(listBooks).mockImplementation(() => new Promise<Book[]>(() => {}));
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
}
async function click(label: string) {
  const found = buttons(label);
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  await act(async () => found[0]!.click());
}
/** The row and the ⋮ opener: the two tap targets a book has on the shelf. */
function tapTargets(name: string): HTMLButtonElement[] {
  return [
    ...buttons(strings.bookRow(name, 0, false)),
    ...buttons(strings.bookMenuOpen(name)),
  ];
}

/** Two stored books, the screen mounted over them in `look`, first load landed. */
async function mountShelf(look: Design): Promise<BookId> {
  const mark = await createBook("Mark");
  await createBook("Ruth");
  design.current = look;
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    );
  });
  await vi.waitFor(() => expect(tapTargets("Mark")).toHaveLength(2));
  expect(tapTargets("Ruth")).toHaveLength(2);
  return mark.id;
}

/** The ⋮, Delete, then the look's own confirm control. */
async function deleteThroughMenu(look: Design, name: string) {
  await click(strings.bookMenuOpen(name));
  await click(strings.deleteBook);
  await click(
    look === "o4" ? strings.deleteBookYes : strings.deleteBookConfirm
  );
  // The confirm's handler awaits the store write; let it run to its end.
  await act(async () => {
    await vi.waitFor(() =>
      expect(layers.has("books:delete-confirm")).toBe(false)
    );
  });
}

describe.each<Design>(["o4", "current"])(
  "the shelf after a delete, %s look (#361 row 3)",
  (look) => {
    it("a deleted book's row and ⋮ are gone on the delete, with every later shelf read held", async () => {
      const mark = await mountShelf(look);
      holdEveryLaterRead();

      await deleteThroughMenu(look, "Mark");

      // The write landed, and the read that would reconcile the shelf was
      // asked for but never answered — so the screen moved on the delete.
      expect(await getBook(mark)).toBeUndefined();
      expect(vi.mocked(listBooks).mock.calls.length).toBeGreaterThan(1);
      expect(tapTargets("Mark")).toEqual([]);
      // The other book is untouched, so this is not an emptied shelf.
      expect(tapTargets("Ruth")).toHaveLength(2);
    });

    it("control: a delete the store refuses leaves the book tappable", async () => {
      const mark = await mountShelf(look);
      holdEveryLaterRead();
      vi.mocked(deleteBook).mockRejectedValueOnce(new Error("quota"));

      await deleteThroughMenu(look, "Mark");

      expect(await getBook(mark)).toBeDefined();
      expect(tapTargets("Mark")).toHaveLength(2);
      expect(tapTargets("Ruth")).toHaveLength(2);
    });
  }
);
