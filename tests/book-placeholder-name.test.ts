// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/components/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * A book nobody has named shows a placeholder the SCREEN renders (#169).
 *
 * The store no longer holds the words: it keeps the slot, and the Books screen
 * turns it into "Book 003" — which is what lets a second UI language rename
 * every book already on a phone. Two things have to hold for that to be true in
 * practice rather than only in the schema, and neither is visible from
 * `tests/storage.test.ts`:
 *
 *   - the row, its aria labels and the rename field all resolve the SAME
 *     rendering, so nothing falls back to a blank where a name used to be; and
 *   - a Confirm on the untouched rename field does not write that rendering
 *     back onto the row as a real name. That is the regression this change
 *     could quietly introduce: the field is pre-filled with the placeholder, so
 *     passing it straight through would freeze this locale's English onto the
 *     book permanently — undoing the migration on the first Rename anyone opens
 *     and then cancels by tapping the check.
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT. A react-dom + `act()` mount in jsdom,
 * copying `tests/books-new-chapter.test.ts`'s shape (which copies
 * `tests/stale-target-wiring.test.ts`'s). The store is the mocked seam, so what
 * `renameBook` is CALLED with is the assertion here; what it then persists is
 * `tests/storage.test.ts`'s half. It says nothing about focus order, the
 * cascade, the soft keyboard, or how any of it reads on a phone.
 */

const unnamedId = "book-0000-4000-8000-000000000001" as BookId;
const namedId = "book-0000-4000-8000-000000000002" as BookId;
/** What the screen should render for the unnamed book's slot. */
const PLACEHOLDER = "Book 003";

const mocks = vi.hoisted(() => ({ renameBook: vi.fn() }));
const shelf = (): BookCard[] => [
  { bookId: unnamedId, name: null, number: 3, chapters: [] },
  { bookId: namedId, name: "Mark", number: 1, chapters: [] },
];
let books: BookCard[] = shelf();

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books,
    newBookNumber: 4,
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
  // jsdom implements no layout, so `scrollIntoView` does not exist and the
  // screen's pending-scroll effect calls it. Where a row lands on screen is
  // layout, which this harness does not have and does not claim.
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

/** The one button carrying `label` as its accessible name. */
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

/** Open a book's ≡ menu and reveal its rename field. */
async function openRename(heading: string) {
  await click(strings.bookMenuOpen(heading));
  await click(strings.renameBook);
  const input = field();
  expect(input, "the rename field should be open").not.toBeNull();
  return input!;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("renders the placeholder for an unnamed book, in the row and in its labels", async () => {
  await mount();

  // The visible title, and every accessible name derived from it: a blank here
  // is the failure this guards — the row would be an unlabelled control on a
  // screen built for people who may not read.
  expect(document.body.textContent).toContain(PLACEHOLDER);
  expect(() => button(strings.bookRow(PLACEHOLDER, 0, false))).not.toThrow();
  expect(() => button(strings.addChapter(PLACEHOLDER))).not.toThrow();
  expect(() => button(strings.bookMenuOpen(PLACEHOLDER))).not.toThrow();

  // A named book is unaffected: its own name, not a slot.
  expect(() => button(strings.bookMenuOpen("Mark"))).not.toThrow();
});

it("seeds the rename field with the placeholder an unnamed book shows", async () => {
  await mount();
  const input = await openRename(PLACEHOLDER);
  // A small fix is an edit, not a retype — the #264 property, which for an
  // unnamed book means starting from what the row actually reads.
  expect(input.value).toBe(PLACEHOLDER);
});

it("does not store the placeholder as a name when the field is untouched", async () => {
  await mount();
  await openRename(PLACEHOLDER);

  await click(strings.saveName);

  // "" means "leave the label alone": the store keeps the row unnamed, so the
  // placeholder goes on being rendered. Sending the words would name the book
  // "Book 003" in English for good.
  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(unnamedId, "");
  expect(mocks.renameBook).not.toHaveBeenCalledWith(unnamedId, PLACEHOLDER);
});

it("still reads a re-typed placeholder as untouched, trailing space and all", async () => {
  await mount();
  const input = await openRename(PLACEHOLDER);

  // The caret lands in the pre-filled text, so a stray space is the likeliest
  // way a translator "edits" without meaning to — trimmed to the same no-op
  // the untouched field is, exactly as the New Book path compares.
  await type(input, `${PLACEHOLDER} `);
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(unnamedId, "");
});

it("sends a genuinely typed name through as typed", async () => {
  await mount();
  const input = await openRename(PLACEHOLDER);

  await type(input, "Ruth");
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(unnamedId, "Ruth");
});

it("treats a named book's own untouched name the same way", async () => {
  await mount();
  await openRename("Mark");

  // Not new behaviour — renaming to the current name has always been a no-op
  // in the store — but it now travels as "" rather than as the name, so the
  // two seeds behave alike and neither depends on what the words are.
  await click(strings.saveName);

  expect(mocks.renameBook).toHaveBeenCalledExactlyOnceWith(namedId, "");
});
