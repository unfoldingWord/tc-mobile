import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { useChapterShare } from "@/hooks/use-chapter-share";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import * as clips from "@/lib/storage/clips";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { ChapterId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * The prepare's hollow snapshot reaches the SEND's busy state through the real
 * hook (#1023, the hand-off blocker): `useShareFlow` snapshots the prepare's
 * count before it settles to ready and dispatches it as a `carry` right after
 * the send's `begin`. Mounted the way `use-chapter-share-steps.test.ts` mounts
 * the same hook: fake-indexeddb, a codec the test finishes by hand, and Web
 * Share stubbed present so the flow takes the web route.
 *
 * Not covered: the real share sheet, the native route, and a phone.
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

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  const codec: AudioCodec = {
    encodeMp3: () =>
      new Promise((resolve) => {
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
  // A share that never resolves, so the send stays busy while it is read.
  vi.stubGlobal("navigator", {
    share: vi.fn(() => new Promise(() => {})),
    canShare: () => true,
  });
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

it("the send's busy state carries the prepare's hollow positions and item count", async () => {
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
  await act(async () => {
    finish();
    await prepared;
  });
  expect(hook().status).toBe("ready");
  act(() => {
    void hook().send();
  });
  const state = hook().progress;
  expect(state).toMatchObject({ phase: "busy", work: "send" });
  expect(state.phase === "busy" ? state.carried : undefined).toEqual({
    items: 3,
    hollow: [1],
  });
});
