// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { idleChapterAudio } from "./chapter-audio";
import { strings } from "@/lib/strings";
import type { Layer } from "@/lib/nav/layer-stack";
import type { BookCard } from "@/types/view";

/**
 * The book menu's Export project tile against the Share book flow's state
 * (#1747, the #1624 residual). Both prepares run through one `useBookShare`
 * flow, and a prepare while it is busy returns before doing anything. So
 * while EITHER kind is preparing, the Export tile must not look live and do
 * nothing: it goes busy, as the Share tile does, and a tap on it does no
 * tap-1 work at all — no export, no chapter stop, no focus capture. Once a
 * file is armed (`ready`) the tile is not drawn, because Share now sends the
 * file already prepared.
 *
 * The whole screen is mounted with react-dom + `act()` in jsdom, with the
 * data hooks mocked the way `tests/books-menus-tiles-o4.test.ts` mocks them.
 * What this cannot show: the cascade, layout, or a real tap on a phone.
 */

type Status = "idle" | "preparing" | "ready";
const share = vi.hoisted(() => ({
  status: "idle" as Status,
  kind: "zip" as "zip" | "project",
  prepareProject: null as unknown as ReturnType<typeof vi.fn>,
  prepare: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: [
      {
        bookId: "book-0000-4000-8000-000000000001",
        name: "Mark",
        number: 1,
        coverColourKey: null,
        languageCode: "en",
        chapters: [],
      },
    ] as unknown as BookCard[],
    newBookNumber: 1,
    loading: false,
    loaded: true,
    error: null,
    deleteFailed: false,
    reload: vi.fn(),
    createBook: vi.fn(),
    addChapter: vi.fn(),
    renameBook: vi.fn(),
    deleteBook: () => Promise.resolve("ok"),
    deleting: false,
    isDeleting: () => false,
  }),
}));
vi.mock("@/hooks/use-book-share", () => ({
  useBookShare: () => ({
    status: share.status,
    kind: share.kind,
    error: null,
    sendUnconfirmed: false,
    missing: 0,
    partialSegments: 0,
    progress: { phase: "hidden" },
    prepare: share.prepare,
    prepareProject: share.prepareProject,
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
let stopChapter: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  share.status = "idle";
  share.kind = "zip";
  share.prepareProject = vi.fn(() => Promise.resolve(null));
  share.prepare = vi.fn(() => Promise.resolve(null));
  stopChapter = vi.fn<() => void>();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__APP_VERSION__", "0.0.0");
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function render() {
  root.render(
    createElement(BooksScreen, {
      audio: idleChapterAudio({ stopChapter }),
      onOpenChapter: vi.fn(),
      pushLayer: vi.fn<(layer: Layer) => void>(),
      popLayer: vi.fn<(id: string) => void>(),
    })
  );
}
/** Mount idle, open Mark's book menu, then move the flow to `status`. */
async function openSheetAt(status: Status, kind: "zip" | "project") {
  await act(async () => render());
  const opener = button(strings.bookMenuOpen("Mark"));
  opener.focus();
  await act(async () => opener.click());
  share.status = status;
  share.kind = kind;
  await act(async () => render());
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

describe("the Export project tile while Share book prepares (#1747)", () => {
  it("is live and does its tap-1 work while the flow is idle", async () => {
    await openSheetAt("idle", "zip");
    const tile = button(strings.exportProject);
    expect(tile.getAttribute("aria-busy")).toBeNull();
    await act(async () => tile.click());
    expect(share.prepareProject).toHaveBeenCalledTimes(1);
    expect(stopChapter).toHaveBeenCalled();
  });

  it.each(["zip", "project"] as const)(
    "is busy while a %s prepare is in flight, and a tap does nothing at all",
    async (kind) => {
      await openSheetAt("preparing", kind);
      const tile = button(strings.exportProject);
      expect(tile.getAttribute("aria-busy")).toBe("true");
      // Focused, as a tap or a switch user would leave it: busy keeps focus.
      tile.focus();
      expect(document.activeElement).toBe(tile);
      stopChapter.mockClear();
      await act(async () => tile.click());
      expect(share.prepareProject).not.toHaveBeenCalled();
      expect(stopChapter).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(tile);
    }
  );

  it("is not drawn once a file is ready, so it cannot sit beside Share now", async () => {
    await openSheetAt("ready", "zip");
    expect(buttons(strings.exportProject)).toHaveLength(0);
    // The sheet is still open and holds the armed Share.
    expect(buttons(strings.shareSend)).toHaveLength(1);
  });
});
