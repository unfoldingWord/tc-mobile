// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { COVER_COLOUR_KEYS } from "@/lib/cover-colour";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * The New Book sheet offers the cover colour (#1190). A react-dom + `act()`
 * mount in jsdom, in the shape of `tests/book-placeholder-name.test.ts`, with
 * the hook mocked: what `createBook` is CALLED with is the assertion here, and
 * the row it then writes is `tests/create-book-cover-colour.test.ts`'s half.
 * Says nothing about layout, the soft keyboard, or the sheet docking on a phone.
 */

const unnamedId = "book-0000-4000-8000-000000000001" as BookId;
const namedId = "book-0000-4000-8000-000000000002" as BookId;

const mocks = vi.hoisted(() => ({ createBook: vi.fn() }));
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
    createBook: mocks.createBook,
    addChapter: vi.fn(),
    renameBook: vi.fn(),
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
  mocks.createBook.mockReset();
  mocks.createBook.mockResolvedValue({ ok: false, key: "saveFailed" });
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

const swatchGroup = () =>
  document.querySelector<HTMLElement>(
    `[role="group"][aria-label="${strings.coverColourLabel}"]`
  );
const swatches = () => [
  ...(swatchGroup()?.querySelectorAll<HTMLButtonElement>("button") ?? []),
];
const pressed = () =>
  swatches().filter((b) => b.getAttribute("aria-pressed") === "true");

it("offers every palette colour in the sheet, none marked, inside the form", async () => {
  await mount();
  await click(strings.newBook);
  expect(swatches()).toHaveLength(COVER_COLOUR_KEYS.length);
  expect(pressed()).toHaveLength(0);
  // Inside the name form, so a press keeps focus in the field (#1099).
  expect(swatchGroup()?.closest("form.name-edit")).not.toBeNull();
});

it("creates with the default when no colour is picked", async () => {
  await mount();
  await click(strings.newBook);
  await click(strings.createBook);
  expect(mocks.createBook).toHaveBeenCalledExactlyOnceWith("", null);
});

it("hands the picked colour to createBook, with the typed name", async () => {
  await mount();
  await click(strings.newBook);
  await type(field()!, "Ruth");
  await act(async () => swatches()[2]!.click());
  expect(pressed()).toEqual([swatches()[2]]);
  await click(strings.createBook);
  expect(mocks.createBook).toHaveBeenCalledExactlyOnceWith(
    "Ruth",
    COVER_COLOUR_KEYS[2]
  );
});

it("tapping the marked colour again returns to the default", async () => {
  await mount();
  await click(strings.newBook);
  await act(async () => swatches()[1]!.click());
  await act(async () => swatches()[1]!.click());
  expect(pressed()).toHaveLength(0);
  await click(strings.createBook);
  expect(mocks.createBook).toHaveBeenCalledExactlyOnceWith("", null);
});

it("keeps the pick and shows the failure when the create fails", async () => {
  await mount();
  await click(strings.newBook);
  await act(async () => swatches()[3]!.click());
  await click(strings.createBook);
  expect(document.body.textContent).toContain(strings.saveFailed);
  expect(field()).not.toBeNull();
  expect(pressed()).toEqual([swatches()[3]]);
});

it("does not carry a pick over to the next sheet", async () => {
  await mount();
  await click(strings.newBook);
  await act(async () => swatches()[4]!.click());
  await click(strings.newBookClose);
  await click(strings.newBook);
  expect(pressed()).toHaveLength(0);
  await click(strings.createBook);
  expect(mocks.createBook).toHaveBeenCalledExactlyOnceWith("", null);
});
