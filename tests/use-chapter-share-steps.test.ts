import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { useChapterShare } from "@/hooks/use-chapter-share";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { ENCODE_STEPS } from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  getChapter,
  moveChapter,
} from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { ChapterId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * #996: `useChapterShare` mounted for real over fake-indexeddb, the way
 * `use-library-share.test.ts` mounts `useLibraryShare`. The encoder lane is
 * replaced by a codec the TEST drives (there is no Worker in Node), so a case
 * can read the hook's own `progress` while the encode is still running. Web
 * Share is stubbed present so the flow takes the web route.
 *
 * What this does NOT cover: the real worker and its heartbeat cadence, the OS
 * share sheet, and the native staging write. Those are the on-device check,
 * recorded on #974.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return { ...actual, withEncoder: vi.fn() };
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useChapterShare> | null } = {
  current: null,
};

function Probe() {
  const result = useChapterShare();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

/** An encode the test finishes by hand, reporting whatever progress it is told. */
let progress: (fraction: number) => void;
let finish: () => void;
let encodeStarted: Promise<void>;

async function chapterWith(segments: number): Promise<ChapterId> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  for (let i = 0; i < segments; i++) {
    const seg = await addSegment(chapter.id);
    await saveTake(
      seg.id,
      newClipId(),
      new Int16Array(100).fill(500 + i),
      CANONICAL_SAMPLE_RATE
    );
  }
  return chapter.id;
}

const steps = () => {
  const state = hook().progress;
  return state.phase === "busy" ? state.steps : undefined;
};

/** Wait until the gather is done and the codec holds its handles. */
const settle = () =>
  act(async () => {
    await encodeStarted;
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  let markEncodeStarted!: () => void;
  encodeStarted = new Promise<void>((r) => {
    markEncodeStarted = r;
  });
  const codec: AudioCodec = {
    encodeMp3: (_samples, onProgress) =>
      new Promise((resolve) => {
        progress = (fraction) => onProgress?.(fraction);
        finish = () => resolve(new Uint8Array([0xff]));
        markEncodeStarted();
      }),
    decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
  };
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec)
  );
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(createElement(Probe));
  });
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } finally {
    dom.window.close();
    vi.unstubAllGlobals();
  }
});

it("the mounted hook's count moves through the encode and names its items", async () => {
  const chapterId = await chapterWith(3);
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(chapterId, () => "c.mp3");
  });
  await settle();
  const total = 3 + ENCODE_STEPS;
  // Gathered, encode started: the segments are done, the total is not.
  expect(steps()).toMatchObject({ done: 3, total, items: 3, skipped: 0 });
  await act(async () => progress(0.5));
  expect(steps()).toMatchObject({ done: 3 + ENCODE_STEPS / 2, total });
  await act(async () => progress(1));
  expect(steps()?.done).toBe(total - 1);
  await act(async () => {
    finish();
    await prepared;
  });
  expect(hook().status).toBe("ready");
});

it("the mounted hook places a vanished segment's hollow dot where it is", async () => {
  const chapterId = await chapterWith(3);
  const real = clips.getClip.bind(clips);
  let call = 0;
  const spy = vi
    .spyOn(clips, "getClip")
    .mockImplementation((id) =>
      ++call === 2 ? Promise.resolve(undefined) : real(id)
    );
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(chapterId, () => "c.mp3");
  });
  await settle();
  spy.mockRestore();
  expect(steps()).toMatchObject({ done: 3, items: 3, skipped: 1, hollow: [1] });
  await act(async () => {
    finish();
    await prepared;
  });
});

/** Prepare a share of `chapterId` with `nameFile`, and let it finish. */
async function shareWith(
  chapterId: ChapterId,
  nameFile: (slot: number, chapterCount: number) => string
): Promise<void> {
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(chapterId, nameFile);
  });
  await settle();
  await act(async () => {
    finish();
    await prepared;
  });
}

it("names the file with the chapter's slot, not its stored number (#1272)", async () => {
  // The scope's `[1, 4, 2, 3]` case: the fourth chapter moved to second place
  // still stores 4, and its file is named for slot 2 of 4 (the DRI on #1272,
  // Q2 (a): "shared MP3 file names and the track tag use the slot").
  const first = await chapterWith(0);
  const { bookId } = (await getChapter(first))!;
  await addChapter(bookId);
  await addChapter(bookId);
  const fourth = await addChapter(bookId);
  const seg = await addSegment(fourth.id);
  await saveTake(
    seg.id,
    newClipId(),
    new Int16Array(100).fill(500),
    CANONICAL_SAMPLE_RATE
  );
  await moveChapter(fourth.id, 1);
  expect((await getChapter(fourth.id))!.number).toBe(4);
  const nameFile = vi.fn((slot: number, count: number) => `${slot}-${count}`);
  await shareWith(fourth.id, nameFile);
  expect(nameFile).toHaveBeenCalledWith(2, 4);
});

it("pads the file to the book's chapter count, not its highest stored number (#1233, #1272)", async () => {
  // A book of a chapter 1 and a chapter 150 has two slots: chapter 1's file
  // takes the width Share Book gives it, whatever else is being shared.
  const chapterId = await chapterWith(1);
  const chapter = await getChapter(chapterId);
  await addChapter(chapter!.bookId, 150);
  const nameFile = vi.fn((slot: number, count: number) => `${slot}-${count}`);
  await shareWith(chapterId, nameFile);
  expect(nameFile).toHaveBeenCalledWith(1, 2);
});
