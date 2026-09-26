// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BooksScreen } from "@/components/books-screen";
import { withEncoder } from "@/hooks/mp3-codec";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { Design } from "@/lib/design";
import type { Layer } from "@/lib/nav/layer-stack";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import type { StoragePressureMarker } from "@/lib/storage/pressure";
import { saveTake } from "@/lib/storage/takes";
import { strings } from "@/lib/strings";
import type { AudioCodec } from "@/types/audio";
import { clearAllStores, testCodec } from "./support";

/**
 * #1045: the O4 storage banner's "Share your work" drives the same
 * full-screen share overlay Share Book does, and the Books shelf is inert
 * while that timeline owns the screen (Frank's exit condition on #1038:
 * busy, dismissed, sent and partial, with cancel and dismiss connected).
 *
 * The real `BooksScreen` and the real `useLibraryShare` over
 * fake-indexeddb: the flow, the overlay and the shelf's `inert` are all
 * the production code. Only the seams Node cannot provide are injected —
 * the encoder lane (the Node codec, no Worker), the failure sink, the OS
 * share sheet (`navigator.share`, resolved or rejected per case) — plus the
 * data hooks the shelf itself reads, mocked the way
 * `tests/storage-banner-o4.test.ts` mocks them.
 *
 * What this does NOT cover: layout and the cascade (jsdom has neither), a
 * real share sheet, the native route, or focus under a real `inert`
 * implementation. Those are the on-device check.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return {
    ...actual,
    withEncoder: vi.fn(),
    encoderHealth: () => "ok",
    subscribeToEncoderHealth: () => () => {},
  };
});
const design = vi.hoisted(() => ({ current: "o4" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
const pressure = vi.hoisted(() => ({
  current: "critical" as StoragePressureMarker | null,
}));
vi.mock("@/hooks/use-storage-pressure", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-storage-pressure")>();
  return { ...actual, useStoragePressure: () => pressure.current };
});
// The shelf's own read: one card with a recording, which is what lets the
// pressure line (and so the banner) show at all (`storagePressureNotice`'s
// `hasReclaimableAudio` gate). The export reads IndexedDB itself.
const shelfBooks = vi.hoisted(() => [
  {
    bookId: "book-0000-4000-8000-000000000001",
    name: "Mark",
    chapters: [
      {
        chapterId: "chapter-1-4000-8000-000000000001",
        number: 1,
        name: null,
        finishedCount: 0,
        totalCount: 1,
        recordedCount: 1,
      },
    ],
  },
]);
vi.mock("@/hooks/use-books", () => ({
  useBooks: () => ({
    books: shelfBooks,
    newBookPlaceholder: "Book 001",
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
    prepare: vi.fn(),
    send: vi.fn(),
    ownsScreen: () => false,
    dismissProgress: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/hooks/failure-log", () => ({ useFailureCount: () => 0 }));

const MB = 1024 * 1024;
let root: Root | null = null;
let codec: ReturnType<typeof testCodec>;
let share: ReturnType<typeof vi.fn>;
let estimate: ReturnType<typeof vi.fn>;

async function bookWith(
  name: string,
  chapters: Array<Array<number | null>>
): Promise<void> {
  const book = await createBook(name);
  for (const specs of chapters) {
    const chapter = await addChapter(book.id);
    for (const frames of specs) {
      const seg = await addSegment(chapter.id);
      if (frames !== null)
        await saveTake(
          seg.id,
          newClipId(),
          new Int16Array(frames).fill(500),
          CANONICAL_SAMPLE_RATE
        );
    }
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  design.current = "o4";
  pressure.current = "critical";
  codec = testCodec();
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec as AudioCodec)
  );
  share = vi.fn(() => Promise.resolve());
  estimate = vi.fn(async () => ({ usage: 10 * MB, quota: 1000 * MB }));
  vi.stubGlobal("navigator", {
    userAgent: "",
    share,
    canShare: () => true,
    storage: { estimate },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = "<div id='root'></div>";
});
afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  vi.unstubAllGlobals();
});

async function mountBooks(): Promise<HTMLElement> {
  root = createRoot(document.getElementById("root")!);
  const r = root;
  const layers = new Map<string, Layer>();
  await act(async () =>
    r.render(
      createElement(BooksScreen, {
        onOpenChapter: vi.fn(),
        pushLayer: (layer: Layer) => layers.set(layer.id, layer),
        popLayer: (id: string) => {
          layers.delete(id);
        },
      })
    )
  );
  return document.getElementById("root")!;
}

/** The shelf's own root: the element `BooksScreen` sets `inert` on. */
const shelf = () => document.getElementById("root")!.firstElementChild!;
const scrim = () => document.body.querySelector<HTMLElement>(".share-scrim");
const overlayText = () =>
  scrim()?.querySelector(".share-progress-text")?.textContent ?? null;
const bannerButton = () =>
  document.querySelector<HTMLButtonElement>("button.o4-storage-share")!;

/** Real timers: the flow's busy and outcome holds are the production ones. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 160 && !check(); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  expect(check(), `timed out waiting for ${what}`).toBe(true);
}

/** Tap 1, then wait for the prepare's busy hold to clear and the archive to arm. */
async function armArchive(): Promise<void> {
  await act(async () => bannerButton().click());
  await until(
    () =>
      scrim() === null &&
      bannerButton().getAttribute("aria-label") === strings.shareSend,
    "the armed archive"
  );
}

describe("O4: the library share owns the screen through its timeline", () => {
  it("busy: the overlay goes up with the library's own line, the shelf goes inert, and a scrim tap cancels", async () => {
    await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
    // Hold the build open until the flow aborts it, so the busy phase stays.
    vi.mocked(withEncoder).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        })
    );
    await mountBooks();
    expect(shelf().hasAttribute("inert")).toBe(false);

    await act(async () => bannerButton().click());
    await until(
      () => vi.mocked(withEncoder).mock.calls.length > 0,
      "the build"
    );

    expect(scrim()?.getAttribute("data-outcome")).toBe("busy");
    expect(overlayText()).toBe(strings.shareAllPreparing);
    expect(shelf().hasAttribute("inert")).toBe(true);

    await act(async () => scrim()!.click());

    expect(scrim()).toBeNull();
    expect(shelf().hasAttribute("inert")).toBe(false);
    expect(bannerButton().getAttribute("aria-label")).toBe(strings.shareAll);
  });

  it("dismissed: a closed sheet shows its own outcome, and a tap ends it and frees the shelf", async () => {
    await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
    share.mockImplementation(() =>
      Promise.reject(new DOMException("closed", "AbortError"))
    );
    await mountBooks();
    await armArchive();

    // A keyboard user: the control has focus when it is activated.
    await act(async () => {
      bannerButton().focus();
      bannerButton().click();
    });
    await until(
      () => scrim()?.getAttribute("data-outcome") === "dismissed",
      "the dismissed outcome"
    );
    expect(overlayText()).toBe(strings.shareDismissed);
    expect(shelf().hasAttribute("inert")).toBe(true);

    await act(async () => scrim()!.click());

    expect(scrim()).toBeNull();
    expect(shelf().hasAttribute("inert")).toBe(false);
    // Focus comes back to the banner's own control, not the document.
    expect(document.activeElement).toBe(bannerButton());
  });

  it("sent: a proven hand-off shows the sent outcome, distinct from dismissed", async () => {
    await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
    await mountBooks();
    await armArchive();

    await act(async () => bannerButton().click());
    await until(
      () => scrim()?.getAttribute("data-outcome") === "sent",
      "the sent outcome"
    );
    expect(share).toHaveBeenCalledTimes(1);
    expect(overlayText()).toBe(strings.shareSent);
    expect(shelf().hasAttribute("inert")).toBe(true);

    // The outcome clears on its own hold too, and the shelf comes back.
    await until(() => scrim() === null, "the outcome hold to end");
    expect(shelf().hasAttribute("inert")).toBe(false);
  });

  it("partial: the outcome names what was left out in books and chapters, never Share Book's words", async () => {
    await bookWith("Empty", [[null]]);
    await bookWith("Gappy", [[CANONICAL_SAMPLE_RATE, null], [null]]);
    await mountBooks();
    await armArchive();

    await act(async () => bannerButton().click());
    await until(
      () => scrim()?.getAttribute("data-outcome") === "partial",
      "the partial outcome"
    );
    expect(overlayText()).toBe(
      `${strings.shareSent} ${strings.shareAllMissing(1)} ${strings.shareAllIncomplete(2)}`
    );
    expect(overlayText()).not.toContain(strings.shareBookMissing(1));
    expect(shelf().hasAttribute("inert")).toBe(true);

    await act(async () => scrim()!.click());
    expect(scrim()).toBeNull();
    expect(shelf().hasAttribute("inert")).toBe(false);
  });

  it("a space refusal says so under the glyph, in the same words as the banner", async () => {
    await bookWith("Mark", [[CANONICAL_SAMPLE_RATE * 10]]);
    estimate.mockResolvedValue({ usage: 100 * MB - 1024, quota: 100 * MB });
    await mountBooks();

    await act(async () => bannerButton().click());
    await until(
      () => scrim()?.getAttribute("data-outcome") === "failed",
      "the failed outcome"
    );
    expect(overlayText()).toBe(strings.shareAllStorage);
  });
});

describe("the current look: no library share, no overlay, no inert", () => {
  it("draws no share button and never makes the shelf inert", async () => {
    design.current = "current";
    await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
    await mountBooks();

    expect(document.querySelector("button.o4-storage-share")).toBeNull();
    expect(
      document.querySelector(`button[aria-label="${strings.shareAll}"]`)
    ).toBeNull();
    expect(scrim()).toBeNull();
    expect(shelf().hasAttribute("inert")).toBe(false);
    expect(withEncoder).not.toHaveBeenCalled();
  });
});
