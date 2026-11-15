// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import type { ShareProgress } from "@/hooks/share-progress";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";

/**
 * #246: a book made from the Template Library is revealed on the shelf the way
 * New Book's is: scrolled into view and focused (the row's toggle button),
 * once the reloaded shelf holds it. The picker is stubbed to a button that
 * reports a create with the new book's id; `useBooks` is stateful so `reload`
 * lands the new card AFTER the callback, as the real async re-read does.
 */

const oldId = "book-0000-4000-8000-000000000001" as BookId;
const newId = "book-0000-4000-8000-000000000002" as BookId;
const HIDDEN: ShareProgress = { phase: "hidden" };
/** Re-sets `books` to a fresh array, so the reveal effect runs again. */
const shelf = vi.hoisted(() => ({ refresh: () => {} }));

vi.mock("@/hooks/use-books", async () => {
  const { useState: useS, useCallback: useCb } = await import("react");
  return {
    useBooks: () => {
      const [books, setBooks] = useS<
        Array<{ bookId: BookId; name: string; number: number; chapters: [] }>
      >([{ bookId: oldId, name: "Mark", number: 1, chapters: [] }]);
      shelf.refresh = () => setBooks((prev) => [...prev]);
      const reload = useCb(() => {
        void Promise.resolve().then(() =>
          setBooks((prev) =>
            prev.some((b) => b.bookId === newId)
              ? prev
              : [
                  ...prev,
                  { bookId: newId, name: "Titus", number: 2, chapters: [] },
                ]
          )
        );
      }, []);
      return {
        books,
        newBookNumber: 3,
        loading: false,
        loaded: true,
        error: null,
        deleteFailed: false,
        reload,
        createBook: vi.fn(),
        addChapter: vi.fn(),
        renameBook: vi.fn(),
        deleteBook: vi.fn(),
        deleting: false,
        isDeleting: () => false,
      };
    },
  };
});
vi.mock("@/components/template-picker", () => ({
  TemplatePicker: ({ onCreated }: { onCreated: (bookId: BookId) => void }) =>
    createElement(
      "button",
      { "data-testid": "fake-create", onClick: () => onCreated(newId) },
      "create"
    ),
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
const scrolled: Element[] = [];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  layers.clear();
  scrolled.length = 0;
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

it("scrolls to and focuses the new template book once the shelf holds it", async () => {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => layers.delete(id),
      })
    );
  });
  expect(document.querySelectorAll("[data-testid=fake-create]")).toHaveLength(
    1
  );
  await act(async () => {
    (
      document.querySelector("[data-testid=fake-create]") as HTMLButtonElement
    ).click();
  });
  // Let the stubbed reload land.
  await act(async () => {
    await Promise.resolve();
  });

  const row =
    [...document.querySelectorAll("li.books-card")].find((li) =>
      li.textContent?.includes("Titus")
    ) ?? null;
  expect(row, "the new book's row is on the shelf").not.toBeNull();
  expect(scrolled.some((el) => row!.contains(el) || el === row)).toBe(true);
  expect(row!.contains(document.activeElement)).toBe(true);
});

it("reveals the new book once: a later render does not scroll again", async () => {
  await act(async () => {
    root.render(
      createElement(BooksScreen, {
        audio: idleChapterAudio(),
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => layers.delete(id),
      })
    );
  });
  await act(async () => {
    (
      document.querySelector("[data-testid=fake-create]") as HTMLButtonElement
    ).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
  const afterReveal = scrolled.length;
  expect(afterReveal, "the reveal scrolled").toBeGreaterThan(0);
  // A second commit of the shelf re-runs the reveal effect; nothing is armed.
  await act(async () => shelf.refresh());
  expect(scrolled).toHaveLength(afterReveal);
});
