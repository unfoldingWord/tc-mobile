// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { ShareProgress } from "@/hooks/share-progress";
import type { Layer } from "@/lib/nav/layer-stack";
import type { Book, BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * #395 items 1, 2 and 3 — the busy/Notice wiring #384 added, and the three
 * gaps George's deep-tree round on #384 found in it. Shape copied from
 * `tests/books-share-overlay-delete-guard.test.ts`: a react-dom + `act()`
 * mount in jsdom, with `use-books`/`use-book-share` mocked, is the step up
 * `tests/render.ts` names for assertions that need effects and events — here,
 * a deferred rename/create promise standing in for the in-flight window
 * between Confirm and the write settling.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const bookName = "Mark";
const shelf = (): BookCard[] => [{ bookId, name: bookName, chapters: [] }];

const fakeBook = (): Book => ({
  id: bookId,
  name: bookName,
  languageCode: null,
  chapterIds: [],
  createdAt: 0,
  updatedAt: 0,
});

// What `useBooks().createBook` actually resolves to (`use-books.ts`'s
// unexported `CreateBookOutcome`) — a discriminated outcome, not a bare
// `Book`, so `onConfirmNewBook` knows a failure's reason.
type CreateBookOutcome =
  | { readonly ok: true; readonly book: Book }
  | { readonly ok: false; readonly message: string };

const HIDDEN: ShareProgress = { phase: "hidden" };

const mocks = vi.hoisted(() => ({
  error: null as string | null,
  renameBook: vi.fn(),
  createBook: vi.fn(),
}));

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf(),
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: mocks.error,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: mocks.createBook,
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
    progress: HIDDEN,
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
  mocks.error = null;
  mocks.renameBook.mockReset();
  mocks.createBook.mockReset();
  layers.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // A successful New Book create scrolls the fresh row into view
  // (`pendingScroll`) — not implemented in jsdom.
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

// Scoped to the open book-≡ dialog, not the whole document: the shelf keeps
// its OWN, unrelated Notice for `error` (`noticeText`, just above the list)
// visible behind the scrim the whole time a panel is open — by design, and
// `inert` while the dialog is up, so AT never reaches it either. The bug
// #395 item 1 names, and the fix here, are both about the PANEL's own copy
// of the failure, scoped to the rename UI itself.
function notice(text: string): Element | null {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return null;
  return (
    [...dialog.querySelectorAll('[role="alert"], [role="status"]')].find(
      (el) => el.textContent === text
    ) ?? null
  );
}

async function click(label: string) {
  await act(async () => button(label).click());
}

it(
  "does not show a stale rename failure's Notice once a retry's own busy " +
    "Notice is up (#395 item 1)",
  async () => {
    // A previous rename attempt already failed — the Notice this leaves up.
    mocks.error = "Could not rename the book.";
    await mount();
    await click(strings.bookMenuOpen(bookName));
    await click(strings.renameBook);

    // Idle: the stale failure is the only thing showing.
    expect(notice(mocks.error)).not.toBeNull();

    // Retry: Save starts a new attempt, which never resolves in this test —
    // the in-flight window the busy Notice below is standing in for.
    let resolveRename: ((book: Book | null) => void) | null = null;
    mocks.renameBook.mockReturnValue(
      new Promise<Book | null>((resolve) => {
        resolveRename = resolve;
      })
    );
    await click(strings.saveName);

    // The wait and the (stale) failure must not share the panel at once —
    // the #112 collision `control-affordance.ts` names.
    expect(notice(strings.savingName)).not.toBeNull();
    expect(notice("Could not rename the book.")).toBeNull();

    // Quiet the dangling promise so the suite does not warn on teardown.
    await act(async () => {
      resolveRename!(fakeBook());
    });
  }
);

it("gives New Book its own busy Notice and its own busy label, not `savingName` (#395 item 2)", async () => {
  await mount();
  await click(strings.newBook);

  let resolveCreate: ((outcome: CreateBookOutcome) => void) | null = null;
  mocks.createBook.mockReturnValue(
    new Promise<CreateBookOutcome>((resolve) => {
      resolveCreate = resolve;
    })
  );
  await click(strings.createBook);

  // The create-specific busy string, not the generic rename relabel — for
  // BOTH the dialog's own Notice and Confirm's own label.
  expect(notice(strings.creatingBook)).not.toBeNull();
  expect(notice(strings.savingName)).toBeNull();
  expect(button(strings.creatingBook)).not.toBeNull();

  await act(async () => {
    resolveCreate!({ ok: true, book: fakeBook() });
  });
});

it("refuses a second Save before the first rename's commit has painted (#395 item 3)", async () => {
  await mount();
  await click(strings.bookMenuOpen(bookName));
  await click(strings.renameBook);

  let resolveRename: ((book: Book | null) => void) | null = null;
  mocks.renameBook.mockReturnValue(
    new Promise<Book | null>((resolve) => {
      resolveRename = resolve;
    })
  );
  // A held Enter / key-repeat: two activations of the same still-idle-looking
  // control in the SAME synchronous batch, before the busy re-render paints.
  await act(async () => {
    const save = button(strings.saveName);
    save.click();
    save.click();
  });

  expect(mocks.renameBook).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveRename!(fakeBook());
  });
});
