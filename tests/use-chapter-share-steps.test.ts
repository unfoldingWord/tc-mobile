import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { useChapterShare } from "@/hooks/use-chapter-share";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { ENCODE_STEPS } from "@/lib/export/chapter";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
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

/** Let the gather's IndexedDB reads and the encode's start settle. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  const codec: AudioCodec = {
    encodeMp3: (_samples, onProgress) =>
      new Promise((resolve) => {
        progress = (fraction) => onProgress?.(fraction);
        finish = () => resolve(new Uint8Array([0xff]));
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
    prepared = hook().prepare(chapterId, "c.mp3");
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
    prepared = hook().prepare(chapterId, "c.mp3");
  });
  await settle();
  spy.mockRestore();
  expect(steps()).toMatchObject({ done: 3, items: 3, skipped: 1, hollow: [1] });
  await act(async () => {
    finish();
    await prepared;
  });
});
