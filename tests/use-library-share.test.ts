import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { reportFailure } from "@/hooks/report-failure";
import { useLibraryShare } from "@/hooks/use-library-share";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { InsufficientStorageError } from "@/lib/export/book";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import { clearAllStores, testCodec } from "./support";

/**
 * #987: `useLibraryShare` mounted for real over fake-indexeddb, the way
 * `use-books-failure-key.test.ts` mounts `useBooks`. The encoder lane is
 * replaced by the Node codec (there is no Worker in Node) and the failure
 * sink by a spy, so the tests read what reached the funnel. Web Share is
 * stubbed present so the flow takes the web route and stops at `ready`.
 *
 * What this does NOT cover: the real worker, the OS share sheet, the native
 * staging write, and what a real phone's `estimate()` reports. Those are the
 * on-device check, recorded on #974.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return { ...actual, withEncoder: vi.fn() };
});

const MB = 1024 * 1024;

let dom: JSDOM;
let root: Root;
let codec: ReturnType<typeof testCodec>;
let estimate: ReturnType<typeof vi.fn> | undefined;
const probe: { current: ReturnType<typeof useLibraryShare> | null } = {
  current: null,
};

function Probe() {
  const result = useLibraryShare();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

async function bookWith(
  name: string,
  chapters: Array<Array<number | null>>
): Promise<void> {
  const book = await createBook(name);
  for (const specs of chapters) {
    const chapter = await addChapter(book.id);
    for (const frames of specs) {
      const seg = await addSegment(chapter.id);
      if (frames !== null) {
        await saveTake(
          seg.id,
          newClipId(),
          new Int16Array(frames).fill(500),
          CANONICAL_SAMPLE_RATE
        );
      }
    }
  }
}

function stubNavigator(storage: object | undefined): void {
  vi.stubGlobal("navigator", {
    share: vi.fn(),
    canShare: () => true,
    storage,
  });
}

async function prepare(): Promise<void> {
  await act(async () => {
    await hook().prepare(
      "Everything.zip",
      (name) => name,
      (name, n) => `${name} - Chapter ${n}.mp3`
    );
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  codec = testCodec();
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec as AudioCodec)
  );
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Plenty of room unless a test says otherwise.
  estimate = vi.fn(async () => ({ usage: 10 * MB, quota: 1000 * MB }));
  stubNavigator({ estimate });
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

it("builds one zip of two books and arms it", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
  await bookWith("Luke", [[CANONICAL_SAMPLE_RATE], [CANONICAL_SAMPLE_RATE]]);

  await prepare();

  expect(hook().error).toBeNull();
  expect(hook().status).toBe("ready");
  expect(hook().missing).toBe(0);
  expect(codec.encodeMp3).toHaveBeenCalledTimes(3);
  expect(estimate).toHaveBeenCalledTimes(1);
  expect(reportFailure).not.toHaveBeenCalled();
});

it("carries the gap counts: a book left out, and the incomplete chapters of the rest", async () => {
  await bookWith("Empty", [[null]]);
  await bookWith("Gappy", [[CANONICAL_SAMPLE_RATE, null], [null]]);

  await prepare();

  expect(hook().status).toBe("ready");
  expect(hook().missing).toBe(1);
  expect(hook().incompleteChapters).toBe(2);
  expect(hook().incompleteBooks).toBe(1);
});

it("treats an empty library as a clean no-op: 'nothing', no encoder, no funnel entry", async () => {
  await prepare();

  expect(hook().error).toBe("nothing");
  expect(hook().status).toBe("idle");
  expect(withEncoder).not.toHaveBeenCalled();
  expect(reportFailure).not.toHaveBeenCalled();
});

it("refuses before any encode when the phone reports too little room, into the funnel as 'storage'", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE * 10]]);
  // 1 KB free: far under twice a ten-second chapter's MP3.
  estimate!.mockResolvedValue({ usage: 100 * MB - 1024, quota: 100 * MB });

  await prepare();

  expect(hook().error).toBe("storage");
  expect(hook().status).toBe("idle");
  expect(withEncoder).not.toHaveBeenCalled();
  expect(codec.encodeMp3).not.toHaveBeenCalled();
  expect(reportFailure).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reportFailure).mock.calls[0]![0]).toBeInstanceOf(
    InsufficientStorageError
  );
  expect(vi.mocked(reportFailure).mock.calls[0]![1]).toBe("share-prepare");
});

it("clears 'storage' once a later attempt has room", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
  estimate!.mockResolvedValueOnce({ usage: 100 * MB, quota: 100 * MB });
  await prepare();
  expect(hook().error).toBe("storage");

  await prepare();
  expect(hook().error).toBeNull();
  expect(hook().status).toBe("ready");
});

it("does not carry 'storage' onto a later attempt that fails for another reason", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
  estimate!.mockResolvedValueOnce({ usage: 100 * MB, quota: 100 * MB });
  await prepare();
  expect(hook().error).toBe("storage");

  codec.encodeMp3.mockImplementationOnce(() =>
    Promise.reject(new Error("encoder died"))
  );
  await prepare();
  expect(hook().error).toBe("failed");
});

it("goes ahead when the browser cannot report storage at all", async () => {
  stubNavigator(undefined);
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);

  await prepare();

  expect(hook().error).toBeNull();
  expect(hook().status).toBe("ready");
});

it("fails a mid-way encode as 'failed' with one funnel entry, and arms nothing", async () => {
  await bookWith("A", [[CANONICAL_SAMPLE_RATE]]);
  await bookWith("B", [[CANONICAL_SAMPLE_RATE]]);
  const real = codec.encodeMp3.getMockImplementation()!;
  codec.encodeMp3
    .mockImplementationOnce(real)
    .mockImplementationOnce(() => Promise.reject(new Error("encoder died")));

  await prepare();

  expect(hook().error).toBe("failed");
  expect(hook().status).toBe("idle");
  expect(reportFailure).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reportFailure).mock.calls[0]![1]).toBe("share-prepare");
});
