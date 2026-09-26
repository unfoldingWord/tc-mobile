// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * Deleting a book asks in place, inside the book menu sheet (#980, G6; #949
 * D16 → B). With the O4 switch on, Delete swaps the sheet's contents for Keep
 * and Delete under the book's small cover and name; the floating
 * `EraseConfirm` card no longer opens for this flow. With the switch off the
 * current confirm is unchanged — the last describe block pins that half.
 *
 * The whole screen is mounted with react-dom + `act()` in jsdom — the step up
 * `tests/render.ts` names for effects, focus and events — and the data hooks
 * are mocked the way `tests/books-o4.test.ts` mocks them. The layer stack is a
 * Map standing in for `useNavStack`, and a system Back is simulated the way
 * the adapter runs one (`use-nav-stack.ts`): refuse when the top layer is
 * busy, otherwise `dismiss()` and then pop that layer.
 *
 * What this cannot show: the cascade, layout, or real `inert` hit-testing.
 * jsdom does none of them. Nothing here was run on a phone.
 */

const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const state = vi.hoisted(() => ({
  books: [] as BookCard[],
  deleting: false,
  // Replaced per test in `beforeEach`; the default is never called.
  deleteBook: null as unknown as (
    id: BookId
  ) => Promise<"ok" | "failed" | "busy">,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: state.books,
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: (id: BookId) => state.deleteBook(id),
    deleting: false,
    isDeleting: () => state.deleting,
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

const mark = "book-0000-4000-8000-000000000001" as BookId;
const ruth = "book-0000-4000-8000-000000000002" as BookId;
const shelf = (): BookCard[] => [
  { bookId: mark, name: "Mark", coverColourKey: "teal", chapters: [] },
  { bookId: ruth, name: "Ruth", coverColourKey: null, chapters: [] },
];

let root: Root;
/** Insertion-ordered, so the last key is the top of the stack. */
const layers = new Map<string, Layer>();

beforeEach(() => {
  layers.clear();
  state.books = shelf();
  state.deleting = false;
  state.deleteBook = (id) => {
    state.books = state.books.filter((b) => b.bookId !== id);
    return Promise.resolve("ok");
  };
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  design.current = "o4";
});

async function mount(look: Design = "o4") {
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
}

function buttons(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter(
    (el) => el.getAttribute("aria-label") === label
  );
}
function button(label: string): HTMLButtonElement {
  const found = buttons(label);
  expect(found, `exactly one button labelled "${label}"`).toHaveLength(1);
  return found[0]!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
/** The book ≡ panel, found by its dialog name. */
function bookSheet(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="dialog"][aria-label="${strings.bookMenuTitle}"]`
  );
}
async function key(k: string, shiftKey = false) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })
    );
  });
}
/** A system Back, run the way `use-nav-stack.ts`'s adapter runs one. */
async function systemBack() {
  const id = [...layers.keys()].at(-1);
  expect(id, "a layer to go back from").toBeDefined();
  const top = layers.get(id!)!;
  if (top.busy()) return "refused";
  await act(async () => {
    top.dismiss();
    layers.delete(id!);
  });
  return id;
}
async function arm() {
  await mount();
  await click(strings.bookMenuOpen("Mark"));
  await click(strings.deleteBook);
}

describe("O4: Delete asks inside the book sheet (#980, D16)", () => {
  it("keeps the same sheet open and swaps its actions for Keep and Delete", async () => {
    await arm();
    const sheet = bookSheet();
    expect(sheet, "the book sheet is still open").not.toBeNull();
    // The floating card does not open for this flow.
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(document.querySelector(".confirm-scrim")).toBeNull();
    // The resting actions are gone; Keep and Delete are in the sheet.
    expect(buttons(strings.renameBook)).toHaveLength(0);
    expect(buttons(strings.shareBook)).toHaveLength(0);
    expect(buttons(strings.deleteBook)).toHaveLength(0);
    expect(sheet!.contains(button(strings.keepBook))).toBe(true);
    expect(sheet!.contains(button(strings.deleteBookYes))).toBe(true);
    // The question is the group's name, so a screen reader hears which book.
    const ask = sheet!.querySelector(
      `[role="group"][aria-label="${strings.deleteBookConfirmTitle("Mark")}"]`
    );
    expect(ask).not.toBeNull();
    // The header: the book's small cover, in its own colour, and its name.
    const cover = ask!.querySelector<HTMLElement>(".books-cover.is-sm");
    expect(cover).not.toBeNull();
    expect(cover!.getAttribute("aria-hidden")).toBe("true");
    expect(cover!.style.getPropertyValue("--book-cover")).not.toBe("");
    expect(ask!.querySelector(".books-sheet-name")?.textContent).toBe("Mark");
    // Both layers stand: the sheet, and the ask over it.
    expect([...layers.keys()]).toEqual([
      "books:book-menu",
      "books:delete-confirm",
    ]);
  });

  it("lands focus on Keep, the safe action", async () => {
    await arm();
    expect(document.activeElement).toBe(button(strings.keepBook));
  });

  it("Keep un-arms: the sheet stays open, its actions return, focus goes back to Delete", async () => {
    await arm();
    await click(strings.keepBook);
    expect(bookSheet()).not.toBeNull();
    expect(buttons(strings.keepBook)).toHaveLength(0);
    expect(button(strings.renameBook)).toBeTruthy();
    expect(document.activeElement).toBe(button(strings.deleteBook));
    expect([...layers.keys()]).toEqual(["books:book-menu"]);
  });

  it("Escape while armed acts as Keep; Escape at rest closes the sheet as before", async () => {
    await arm();
    await key("Escape");
    expect(bookSheet()).not.toBeNull();
    expect(buttons(strings.keepBook)).toHaveLength(0);
    expect(document.activeElement).toBe(button(strings.deleteBook));
    expect([...layers.keys()]).toEqual(["books:book-menu"]);

    await key("Escape");
    expect(bookSheet()).toBeNull();
    expect(layers.size).toBe(0);
  });

  it("a scrim tap while armed acts as Keep", async () => {
    await arm();
    const scrim = document.querySelector<HTMLElement>(".menu-scrim");
    expect(scrim).not.toBeNull();
    await act(async () => scrim!.click());
    expect(bookSheet()).not.toBeNull();
    expect(buttons(strings.keepBook)).toHaveLength(0);
    expect([...layers.keys()]).toEqual(["books:book-menu"]);
  });

  it("a system Back while armed acts as Keep; the next Back closes the sheet", async () => {
    await arm();
    expect(await systemBack()).toBe("books:delete-confirm");
    expect(bookSheet()).not.toBeNull();
    expect(buttons(strings.keepBook)).toHaveLength(0);
    expect(document.activeElement).toBe(button(strings.deleteBook));

    expect(await systemBack()).toBe("books:book-menu");
    expect(bookSheet()).toBeNull();
  });

  it("keeps Tab inside the sheet while armed", async () => {
    await arm();
    const yes = button(strings.deleteBookYes);
    yes.focus();
    await key("Tab");
    // Wrapped to the panel's first focusable (its header control), not out
    // to the shelf behind the scrim.
    expect(bookSheet()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(yes);
  });

  it("Delete, on success, closes the whole sheet and hands focus to the next book", async () => {
    await arm();
    await click(strings.deleteBookYes);
    expect(bookSheet()).toBeNull();
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(layers.size).toBe(0);
    expect(buttons(strings.bookRow("Mark", 0, false))).toHaveLength(0);
    expect(document.activeElement).toBe(
      button(strings.bookRow("Ruth", 0, false))
    );
  });

  it("Delete, on failure, closes the whole sheet and returns focus to the book's own row", async () => {
    state.deleteBook = () => Promise.resolve("failed");
    await arm();
    await click(strings.deleteBookYes);
    expect(bookSheet()).toBeNull();
    expect(layers.size).toBe(0);
    expect(document.activeElement).toBe(
      button(strings.bookRow("Mark", 0, false))
    );
  });

  it("refuses Keep, Escape and Back while the delete is in flight", async () => {
    let settle: (r: "ok") => void = () => {};
    state.deleteBook = () => {
      state.deleting = true;
      return new Promise((resolve) => {
        settle = resolve;
      });
    };
    await arm();
    await click(strings.deleteBookYes);

    await click(strings.keepBook);
    expect(button(strings.keepBook)).toBeTruthy();
    await key("Escape");
    expect(button(strings.keepBook)).toBeTruthy();
    expect(await systemBack()).toBe("refused");
    expect([...layers.keys()]).toEqual([
      "books:book-menu",
      "books:delete-confirm",
    ]);

    await act(async () => {
      state.deleting = false;
      state.books = state.books.filter((b) => b.bookId !== mark);
      settle("ok");
    });
    expect(bookSheet()).toBeNull();
    expect(layers.size).toBe(0);
  });
});

describe("switch off: the current delete confirm is unchanged (#980)", () => {
  it("closes the book menu and opens the floating EraseConfirm, focus on Cancel", async () => {
    await mount("current");
    await click(strings.bookMenuOpen("Mark"));
    await click(strings.deleteBook);
    expect(bookSheet()).toBeNull();
    const panel = document.querySelector<HTMLElement>(".confirm-panel");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-label")).toBe(
      strings.deleteBookConfirmTitle("Mark")
    );
    expect(document.querySelector(".books-delete-ask")).toBeNull();
    expect(buttons(strings.keepBook)).toHaveLength(0);
    expect(document.activeElement).toBe(button(strings.eraseCancel));
    expect([...layers.keys()]).toEqual(["books:delete-confirm"]);
  });

  it("Cancel returns to the shelf, focus on the book's row, as before", async () => {
    await mount("current");
    await click(strings.bookMenuOpen("Mark"));
    await click(strings.deleteBook);
    await click(strings.eraseCancel);
    expect(document.querySelector(".confirm-panel")).toBeNull();
    expect(bookSheet()).toBeNull();
    expect(layers.size).toBe(0);
    expect(document.activeElement).toBe(
      button(strings.bookRow("Mark", 0, false))
    );
  });
});
