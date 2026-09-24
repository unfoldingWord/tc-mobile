// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { ShareProgress } from "@/hooks/share-progress";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * #517 item 1 (George r3 P3 on #508): before #517, `onArmDelete` carried no
 * `shareOverlayOwnsScreen` guard of its own. #491 had removed it in favour of
 * `<Menu inert={shareOverlayOwnsScreen(bookShare.progress)}>`, which makes
 * Delete unreachable by click, keyboard or AT activation as long as `inert`
 * actually does its job. #517 restores the guard as defense in depth for the
 * case it does not: none of this has been observed on a device, and no
 * user-visible bug is claimed.
 *
 * jsdom does not enforce `inert`'s hit-testing/event-blocking behaviour — it
 * only reflects the attribute — so a plain `.click()` on the Delete control
 * reaches `onArmDelete` here exactly as it would in a real WebView whose
 * `inert` implementation was bypassed or absent. That is the scenario this
 * file stands in for: it does not assert anything about jsdom's own `inert`
 * handling (there is none to assert), only about what `onArmDelete` does once
 * reached.
 *
 * Shape copied from `tests/books-new-chapter.test.ts`: a react-dom + `act()`
 * mount in jsdom is the step up `tests/render.ts` names for assertions that
 * need effects and events.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const bookName = "Mark";
const shelf = (): BookCard[] => [
  {
    bookId,
    name: bookName,
    chapters: [
      {
        chapterId: "chapter-0000-4000-8000-000000000001" as ChapterId,
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 0,
        recordedCount: 0,
      },
    ],
  },
];

// `progress.phase !== "hidden"` is the whole of `shareOverlayOwnsScreen` — a
// live "busy" phase is the long case (a book zip mid-encode) the issue names.
// Mutable, not reassigned per-render by any component under test, so a test
// can flip it before `mount()` and the render right after reads the new value
// (mirrors `use-books.ts`'s `books` reassignment in `books-new-chapter.test.ts`).
const HIDDEN: ShareProgress = { phase: "hidden" };
const BUSY: ShareProgress = {
  phase: "busy",
  work: "prepare",
  since: 0,
  pending: null,
};
const mocks = vi.hoisted(() => ({
  deleteBook: vi.fn(),
  progress: { phase: "hidden" as const } as ShareProgress,
  ownsScreen: (): boolean => false,
}));

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf(),
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: mocks.deleteBook,
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
    progress: mocks.progress,
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: mocks.ownsScreen,
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
  mocks.deleteBook.mockReset();
  mocks.progress = HIDDEN;
  mocks.ownsScreen = () => false;
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

it(
  "onArmDelete does not arm the delete confirm while the share overlay " +
    "owns the screen, even when it is reached directly (#517 item 1)",
  async () => {
    mocks.progress = BUSY;
    mocks.ownsScreen = () => true;
    await mount();
    await click(strings.bookMenuOpen(bookName));
    expect(layers.has("books:book-menu")).toBe(true);

    // Reached directly, bypassing whatever would normally keep a pointer or
    // keyboard activation from getting here (`inert`, which jsdom does not
    // enforce) — the exact "if inert is bypassed" premise #517 names.
    await click(strings.deleteBook);

    // The confirm never appears: no delete-confirm layer, no confirm dialog,
    // and the store is never asked to delete anything.
    expect(layers.has("books:delete-confirm")).toBe(false);
    expect(
      document.querySelector<HTMLElement>(
        `[aria-label="${strings.deleteBookConfirmTitle(bookName)}"]`
      )
    ).toBeNull();
    expect(mocks.deleteBook).not.toHaveBeenCalled();
  }
);

it("arms the delete confirm normally once the share overlay is hidden (both states, AGENTS.md)", async () => {
  await mount();
  await click(strings.bookMenuOpen(bookName));
  await click(strings.deleteBook);

  expect(layers.has("books:delete-confirm")).toBe(true);
  expect(
    document.querySelector<HTMLElement>(
      `[aria-label="${strings.deleteBookConfirmTitle(bookName)}"]`
    )
  ).not.toBeNull();
});
