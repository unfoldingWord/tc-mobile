// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SegmentsScreen } from "@/components/segments-screen";
import { strings } from "@/components/strings";
import type { FailureKey } from "@/hooks/save-failure";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId } from "@/types/domain";

/**
 * #395 items 1 and 3, the Segments (chapter rename) twins of
 * `tests/books-rename-busy-notice.test.ts`'s Books cases — item 2 (New Book's
 * own busy channel) does not apply here; the issue names New Book only.
 * Shape copied from `tests/stale-target-wiring.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  error: null as FailureKey | null,
  renameChapter: vi.fn(),
}));
vi.mock("@/hooks/use-chapter-segments", () => ({
  useChapterSegments: () => ({
    bookName: "Book",
    chapterNumber: 1,
    chapterName: null,
    rows: [],
    loading: false,
    loaded: true,
    refreshing: false,
    error: mocks.error,
    staleTarget: false,
    addSegment: vi.fn(),
    reload: vi.fn(),
    renameChapter: mocks.renameChapter,
  }),
}));
vi.mock("@/hooks/use-chapter-share", () => ({
  useChapterShare: () => ({
    status: "idle",
    progress: { phase: "hidden" },
    error: null,
    ownsScreen: () => false,
    reset: () => {},
  }),
}));
vi.mock("@/hooks/use-erase-segment", () => ({
  useEraseSegment: () => ({
    error: null,
    erasing: false,
    isErasing: () => false,
  }),
}));

let root: Root;
const layers = new Map<string, Layer>();
const pushLayer = (layer: Layer) => layers.set(layer.id, layer);
const popLayer = (id: string) => {
  layers.delete(id);
};
const audio = {
  error: null,
  playingId: null,
  playbackElapsedMs: 0,
} as UseAudioSession;

beforeEach(() => {
  mocks.error = null;
  mocks.renameChapter.mockReset();
  layers.clear();
  document.body.innerHTML = '<div id="root"></div>';
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () =>
    root.render(
      createElement(SegmentsScreen, {
        chapterId: "chapter" as ChapterId,
        audio,
        onBack: vi.fn(),
        onOpenRecorder: vi.fn(),
        pushLayer,
        popLayer,
      })
    )
  );
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

// Scoped to the open chapter-≡ dialog, mirroring `tests/books-rename-busy-
// notice.test.ts`'s `notice()`: the screen keeps its own separate Notice for
// `error` (line 843 area) visible — and `inert` — behind the scrim the whole
// time a panel is open, which is not the collision #395 item 1 names.
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
  "does not show a stale chapter-rename failure's Notice once a retry's " +
    "own busy Notice is up (#395 item 1)",
  async () => {
    // The hook exposes a `strings`-mapped KEY (#172), never the raw store
    // text, so the mock stands in with a real key and the assertions below
    // check for its MAPPED copy.
    mocks.error = "saveFailed";
    await mount();
    await click(strings.chapterMenuOpen);
    await click(strings.renameChapter);

    expect(notice(strings.saveFailed)).not.toBeNull();

    let resolveRename: ((ok: boolean) => void) | null = null;
    mocks.renameChapter.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRename = resolve;
      })
    );
    await click(strings.saveName);

    expect(notice(strings.savingName)).not.toBeNull();
    expect(notice(strings.saveFailed)).toBeNull();

    await act(async () => {
      resolveRename!(true);
    });
  }
);

it("refuses a second Save before the first chapter rename's commit has painted (#395 item 3)", async () => {
  await mount();
  await click(strings.chapterMenuOpen);
  await click(strings.renameChapter);

  let resolveRename: ((ok: boolean) => void) | null = null;
  mocks.renameChapter.mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolveRename = resolve;
    })
  );
  await act(async () => {
    const save = button(strings.saveName);
    save.click();
    save.click();
  });

  expect(mocks.renameChapter).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveRename!(true);
  });
});
