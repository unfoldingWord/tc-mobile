// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * #1218 at the Books screen: Share Book hands `exportBookZip` a namer that
 * passes the chapter's own name through to `strings.shareFilename`, so the
 * MP3s in the zip carry the names the translator gave the chapters. The
 * export's own half (the name reaching the entry) is
 * `tests/chapter-name-export.test.ts`; this pins the screen's wiring, which a
 * namer that dropped the name argument would break with every export test
 * still green.
 *
 * Shape copied from `tests/books-share-overlay-delete-guard.test.ts`.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const shelf = (): BookCard[] => [
  {
    bookId,
    name: "Mark",
    number: 1,
    chapters: [
      {
        chapterId: "chapter-0000-4000-8000-000000000001" as ChapterId,
        number: 1,
        name: "The sower",
        finishedCount: 0,
        totalCount: 1,
        recordedCount: 1,
      },
    ],
  },
];

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelf(),
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
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
    prepare: mocks.prepare,
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

beforeEach(() => {
  mocks.prepare.mockReset();
  mocks.prepare.mockResolvedValue(null);
  layers.clear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
  expect(found, `expected exactly one button labelled "${label}"`).toHaveLength(
    1
  );
  return found[0]!;
}

it("names each MP3 in the book's zip from the chapter's own name", async () => {
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
  await act(async () => button(strings.bookMenuOpen("Mark")).click());
  await act(async () => button(strings.shareBook).click());

  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  const [id, zip, nameChapter] = mocks.prepare.mock.calls[0]!;
  expect(id).toBe(bookId);
  expect(zip).toBe(strings.shareBookFilename("Mark"));
  expect(nameChapter(1, "The sower")).toBe("Mark - The sower.mp3");
  expect(nameChapter(2, null)).toBe(`Mark - ${strings.chapterName(2)}.mp3`);
});
