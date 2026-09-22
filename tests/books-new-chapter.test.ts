// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookId, Chapter, ChapterId } from "@/types/domain";
import type { BookCard } from "@/types/view";

/**
 * Add Chapter prompts for a name before it writes anything (#609) — the chapter
 * parallel to New Book's own prompt (#314).
 *
 * WHAT THIS COVERS, AND WHAT IT DOES NOT. This is a react-dom + `act()` mount
 * in jsdom, the step up `tests/render.ts` names for assertions that need
 * effects and events; `tests/stale-target-wiring.test.ts` is the existing
 * example and this file copies its shape. It reaches four things the wiring can
 * get wrong and nothing else: the `+` no longer writes on its own, the field is
 * seeded with the ordinal the new chapter will get, Confirm forwards the right
 * string to the store, and the prompt is registered as a system-Back layer so
 * Back closes it rather than leaving the app (#374). It says nothing about
 * focus order, the cascade, the soft keyboard, or how any of it reads on a
 * phone; those are on-device surface, and unrun.
 *
 * The store is the mocked seam, so what `addChapter` is CALLED with is the
 * assertion here; what it then persists is `tests/storage.test.ts`'s half.
 */

const bookId = "book-0000-4000-8000-000000000001" as BookId;
const bookName = "Mark";
const made: Chapter = {
  id: "chapter-0000-4000-8000-000000000003" as ChapterId,
  bookId,
  number: 3,
  name: null,
  segmentIds: [],
};
const mocks = vi.hoisted(() => ({ addChapter: vi.fn() }));
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
      },
      {
        chapterId: "chapter-0000-4000-8000-000000000002" as ChapterId,
        number: 2,
        name: "Mark 6",
        finishedCount: 0,
        totalCount: 0,
      },
    ],
  },
];
// Reassigned, not mutated in place, and read through the mocked hook on every
// render — the stand-in for `patchNewChapter`'s optimistic insert, so a test
// can see the row a create lands and where focus goes on it.
let books: BookCard[] = shelf();
function landChapter() {
  const [book] = books;
  books = [
    {
      ...book!,
      chapters: [
        ...book!.chapters,
        {
          chapterId: made.id,
          number: made.number,
          name: made.name,
          finishedCount: 0,
          totalCount: 0,
        },
      ],
    },
  ];
}

vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books,
    newBookPlaceholder: "Book 001",
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: mocks.addChapter,
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
  // jsdom implements no layout, so `Element.prototype.scrollIntoView` does not
  // exist — and the screen's pending-scroll effect calls it on the row a
  // create lands. A no-op stub: where the row ends up on screen is layout,
  // which this harness does not have and does not claim.
  Element.prototype.scrollIntoView = () => {};
  books = shelf();
  mocks.addChapter.mockReset();
  mocks.addChapter.mockImplementation(async () => {
    landChapter();
    return made;
  });
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

/**
 * Open the prompt the way a translator does: focus the `+`, then activate it.
 * `HTMLElement.click()` alone does not move focus in jsdom, and where focus was
 * when the prompt opened is exactly what the return path is about.
 */
async function openPrompt() {
  const plus = button(strings.addChapter(bookName));
  await act(async () => {
    plus.focus();
    plus.click();
  });
  return plus;
}

function field(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="${strings.chapterNameField}"]`
  );
}

async function type(value: string) {
  const input = field();
  expect(input, "the chapter name field is not on screen").not.toBeNull();
  // React tracks the last value it set on the node, so assigning `.value`
  // directly is swallowed as "no change"; going through the prototype setter
  // is the standard way to make a controlled input see a typed value.
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input!, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens the prompt instead of writing, seeded with the ordinal the chapter will get", async () => {
  await mount();
  await click(strings.addChapter(bookName));
  // The whole of #609: the `+` is a prompt now, not a write.
  expect(mocks.addChapter).not.toHaveBeenCalled();
  // Two chapters exist, so the next is 3 — the same ordinal `addChapter`'s own
  // transaction derives through `nextChapterNumber` (tests/storage.test.ts).
  expect(field()?.value).toBe(strings.chapterName(3));
});

it("registers the prompt as a Back layer, and a Back closes it", async () => {
  await mount();
  await click(strings.addChapter(bookName));
  const layer = layers.get("books:new-chapter");
  expect(layer, "the prompt registered no Back layer").toBeDefined();
  // Nothing is in flight, so Back must be allowed through rather than refused.
  expect(layer!.busy()).toBe(false);
  await act(async () => layer!.dismiss());
  expect(field()).toBeNull();
  expect(mocks.addChapter).not.toHaveBeenCalled();
});

it("sends an empty name when the default is accepted untouched", async () => {
  await mount();
  await click(strings.addChapter(bookName));
  await click(strings.createChapter);
  // "" — never the rendered "Chapter 3" — so nothing is stored as a label and
  // the row goes on showing the ordinal the write itself derived.
  expect(mocks.addChapter).toHaveBeenCalledWith(bookId, "");
  expect(layers.has("books:new-chapter")).toBe(false);
});

it("sends a typed name, and reads a re-typed default as untouched", async () => {
  await mount();
  await click(strings.addChapter(bookName));
  await type("Mark 7");
  await click(strings.createChapter);
  expect(mocks.addChapter).toHaveBeenCalledWith(bookId, "Mark 7");

  await click(strings.addChapter(bookName));
  // Reopening re-seeds, twice over: `Menu` unmounts its children when closed so
  // the typed name above cannot survive, and the seed is recomputed from the
  // shelf, which the create just grew — so it offers 4, not 3 again.
  expect(field()?.value).toBe(strings.chapterName(4));
  // A stray trailing space on the pre-filled text must not slip the default
  // down the named path — the trimmed comparison the New Book dialog makes.
  await type(`${strings.chapterName(4)} `);
  await click(strings.createChapter);
  expect(mocks.addChapter).toHaveBeenLastCalledWith(bookId, "");
});

it("creates nothing when the prompt is dismissed", async () => {
  await mount();
  await click(strings.addChapter(bookName));
  await type("Mark 7");
  await click(strings.newChapterClose);
  expect(mocks.addChapter).not.toHaveBeenCalled();
  expect(field()).toBeNull();
  expect(layers.has("books:new-chapter")).toBe(false);
});

/**
 * Where focus lands when the prompt closes, which is the half that decides
 * whether a held Enter can loop (#609 review, A2).
 *
 * On CANCEL it goes back to the `+`, the control a retry starts from. On a
 * successful CREATE it must not: the `+` reopens this prompt, `NameEdit`
 * autofocuses, and the next key-repeat submits — the pre-#609 loop with one
 * extra keystroke per turn. It goes to the new chapter row instead, whose only
 * button navigates and writes nothing.
 *
 * jsdom has no layout, so this pins WHICH element holds focus and nothing about
 * what is visible; the scroll that accompanies it is untested here and unrun on
 * a device.
 */
it("returns focus to the + when the prompt is dismissed", async () => {
  await mount();
  const plus = await openPrompt();
  await click(strings.newChapterClose);
  expect(document.activeElement).toBe(plus);
});

it("hands focus to the new chapter row after a create, never back to the +", async () => {
  await mount();
  const plus = await openPrompt();
  await click(strings.createChapter);
  const opened = button(strings.openChapter(strings.chapterName(made.number)));
  expect(document.activeElement).toBe(opened);
  expect(document.activeElement).not.toBe(plus);
});

it("hands failed-create focus to the book toggle, so held Enter cannot create", async () => {
  mocks.addChapter.mockResolvedValue(null);
  await mount();
  const plus = await openPrompt();
  await click(strings.createChapter);
  expect(field()).toBeNull();
  expect(document.activeElement).not.toBe(plus);
  expect(document.activeElement?.getAttribute("aria-expanded")).not.toBeNull();
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(field()).toBeNull();
  expect(mocks.addChapter).toHaveBeenCalledTimes(1);
});

it("selects the offered chapter name on opening so typing can replace it", async () => {
  await mount();
  await openPrompt();
  const input = field()!;
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
  input.setSelectionRange(2, 2);
  await act(async () => {
    input.blur();
    input.focus();
  });
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(2);
});

it("lands on a non-activating empty shelf target when the book disappears during create", async () => {
  mocks.addChapter.mockImplementation(async () => {
    books = [];
    return null;
  });
  await mount();
  await openPrompt();
  await click(strings.createChapter);
  expect(field()).toBeNull();
  expect(document.activeElement?.getAttribute("role")).toBe("group");
  expect(document.activeElement?.getAttribute("aria-label")).toBe(
    strings.booksEmpty
  );
  expect(document.activeElement?.tagName).toBe("DIV");
});

/**
 * The in-flight half of the gate (AGENTS.md: "a gate is tested in both
 * states"). The other cases pin `busy() === false`; this one holds the write
 * open and pins that every exit is refused while it is.
 *
 * A chapter cannot be deleted on this tree, so a dismissal that let the panel
 * go while the `put` was still running would leave the create's continuation
 * expanding and scrolling to a chapter the closing gesture disowned — and a
 * second Confirm would write one nothing can remove.
 */
it("refuses Back, Escape and a second Confirm while the write is in flight", async () => {
  let settle: ((chapter: Chapter) => void) | undefined;
  mocks.addChapter.mockImplementation(
    () =>
      new Promise<Chapter>((resolve) => {
        settle = resolve;
      })
  );
  await mount();
  await openPrompt();
  await click(strings.createChapter);

  const layer = layers.get("books:new-chapter");
  expect(layer, "the prompt registered no Back layer").toBeDefined();
  // Back is refused at the layer, before `dismiss()` is ever reached.
  expect(layer!.busy()).toBe(true);
  // And refused again inside the state half, which is the belt for a caller
  // that reaches it another way.
  await act(async () => layer!.dismiss());
  expect(field()).not.toBeNull();

  // Escape, through the field's own handler.
  await act(async () => {
    field()!.dispatchEvent(
      new globalThis.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  expect(field()).not.toBeNull();

  // The commit control has relabelled, so a second activation cannot even find
  // the same name — and the one it did find writes nothing.
  expect(button(strings.savingName)).toBeDefined();
  await click(strings.savingName);
  expect(mocks.addChapter).toHaveBeenCalledTimes(1);

  // Settling releases it: the prompt comes down and its layer with it.
  await act(async () => {
    settle!(made);
    landChapter();
  });
  expect(field()).toBeNull();
  expect(layers.has("books:new-chapter")).toBe(false);
});
