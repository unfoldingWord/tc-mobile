// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/i18n/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * Confirming Rename without typing must not write the placeholder back onto an
 * unnamed book (#169, QA P2 on PR #701).
 *
 * The seam this closes is the one the storage half cannot see. `createBook`
 * stores `name: null` and the shelf renders "Book 001" from the number, so the
 * row is not frozen in English — but the Rename field is SEEDED with that
 * rendered default, so that a small fix is an edit rather than a retype. Press
 * the check without touching it and the screen forwards "Book 001" as a typed
 * name, and the book is frozen in English after all, through the UI, on the
 * first Rename anybody opens.
 *
 * Same harness as `tests/books-new-chapter.test.ts` — a react-dom + `act()`
 * mount in jsdom — and the same limit: the store is the mocked seam, so what
 * `renameBook` is CALLED with is the assertion. What it then persists is
 * `tests/storage.test.ts`'s half.
 */

const unnamedId = "book-0000-4000-8000-000000000001" as BookId;
const namedId = "book-0000-4000-8000-000000000002" as BookId;

const mocks = vi.hoisted(() => ({ renameBook: vi.fn() }));

/** An unnamed book showing slot 1, and a book the facilitator named "Mark". */
const shelf = (): BookCard[] => [
  { bookId: unnamedId, number: 1, name: null, chapters: [] },
  { bookId: namedId, number: 2, name: "Mark", chapters: [] },
];
let books: BookCard[] = shelf();

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books,
    newBookPlaceholder: "Book 003",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: mocks.renameBook,
    deleteBook: vi.fn(),
    deleting: false,
    isDeleting: () => false,
  }),
}));
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
vi.mock("@/hooks/failure-log", () => ({ useFailureCount: () => 0 }));
vi.mock("@/hooks/mp3-codec", () => ({
  encoderHealth: () => "ok",
  subscribeToEncoderHealth: () => () => {},
}));

let root: Root;
const layers = new Map<string, Layer>();
const pushLayer = (layer: Layer) => layers.set(layer.id, layer);
const popLayer = (id: string) => {
  layers.delete(id);
};

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  books = shelf();
  mocks.renameBook.mockReset();
  mocks.renameBook.mockResolvedValue(undefined);
  layers.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer,
        popLayer,
      })
    );
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `expected exactly one button labelled "${label}"`).toHaveLength(
    1
  );
  return found[0]!;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

function field(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="${strings.bookNameField}"]`
  );
}

async function type(value: string) {
  const input = field();
  expect(input, "the book name field is not on screen").not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input!, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Open a book's ≡ menu and step into its Rename field. */
async function openRename(heading: string) {
  await click(strings.bookMenuOpen(heading));
  await click(strings.renameBook);
}

it("seeds the field with the rendered default so a small fix is an edit", async () => {
  await mount();
  await openRename("Book 001");

  expect(field()?.value).toBe("Book 001");
});

it("sends blank, not the placeholder, when an unnamed book's Rename is confirmed untouched", async () => {
  await mount();
  await openRename("Book 001");
  await click(strings.saveName);

  // The whole point: the store must not receive "Book 001" as a typed name.
  // `""` is what `renameBook` reads as "no name", the same value the New Book
  // dialog sends for an untouched field.
  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(unnamedId, "");
});

it("still sends a real edit of an unnamed book verbatim", async () => {
  await mount();
  await openRename("Book 001");
  await type("Mark");
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(unnamedId, "Mark");
});

it("sends a NAMED book's untouched confirm verbatim — its name is its own, not a default", async () => {
  // The normalisation is keyed on the book being unnamed. A facilitator who
  // called a book "Mark" and reopens Rename without typing must not have that
  // name cleared out from under them.
  await mount();
  await openRename("Mark");
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(namedId, "Mark");
});

it("sends a named book's deliberate blank through, so it can be cleared", async () => {
  await mount();
  await openRename("Mark");
  await type("   ");
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(namedId, "   ");
});

it("sends a typed placeholder look-alike on a NAMED book verbatim", async () => {
  // Typing this locale's placeholder by hand onto a named book is a deliberate
  // act and is stored as a name — the same rule `createBook` follows for a
  // supplied name, and what keeps the normalisation from guessing.
  await mount();
  await openRename("Mark");
  await type("Book 002");
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(namedId, "Book 002");
});
