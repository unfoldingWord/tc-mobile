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

/**
 * Wait, in real time, for the modal timeline to reach a phase. The flow holds
 * its busy phase for MIN_BUSY_MS before an outcome shows, so a send's outcome
 * is not visible on the same tick the sheet resolves.
 */
async function untilPhase(phase: "outcome" | "hidden"): Promise<void> {
  for (let i = 0; i < 100 && hook().progress.phase !== phase; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  expect(hook().progress.phase).toBe(phase);
}

it("names the partial outcome's gap in library units, never in Share Book's chapter/segment fields", async () => {
  await bookWith("Empty", [[null]]);
  await bookWith("Gappy", [[CANONICAL_SAMPLE_RATE, null], [null]]);
  await prepare();
  expect(hook().status).toBe("ready");

  let sent: Promise<unknown> = Promise.resolve();
  await act(async () => {
    sent = hook().send();
  });
  const libraryGap = {
    missingBooks: 1,
    incompleteChapters: 2,
    incompleteBooks: 1,
  };
  // The sheet resolved inside the busy hold, so the settle is still HELD as
  // `pending` — and a caller reading it there gets the same library units.
  const held = hook().progress;
  if (held.phase !== "busy") throw new Error("expected the busy hold");
  expect(held.pending?.settled).toBe("partial");
  expect(held.pending?.gap).toEqual(libraryGap);

  await untilPhase("outcome");

  const progress = hook().progress;
  if (progress.phase !== "outcome") throw new Error("expected an outcome");
  expect(progress.settled).toBe("partial");
  // The library's own units, under the hook's own names — and no `missing`/
  // `partial`/`partialChapters`, which a ShareGap reader words as the
  // chapters and segments of ONE book.
  expect(progress.gap).toEqual(libraryGap);
  await act(async () => {
    hook().dismissProgress();
    await sent;
  });
});

it("does not let a superseded run's space refusal mark a newer run's failure as 'storage'", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
  let answerA: (value: { usage: number; quota: number }) => void = () => {};
  estimate!.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answerA = resolve;
      })
  );

  // Run A stops inside its storage read.
  let runA: Promise<unknown> = Promise.resolve();
  await act(async () => {
    runA = hook().prepare(
      "A.zip",
      (name) => name,
      (name, n) => `${name} - Chapter ${n}.mp3`
    );
  });
  for (let i = 0; i < 100 && estimate!.mock.calls.length === 0; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(estimate).toHaveBeenCalledTimes(1);
  // The menu closes (which supersedes A), then run B fails for a reason that
  // is not space.
  await act(async () => {
    hook().reset();
  });
  codec.encodeMp3.mockImplementationOnce(() =>
    Promise.reject(new Error("encoder died"))
  );
  await prepare();
  expect(hook().error).toBe("failed");

  // A's reading finally answers "no room", for a run nobody is waiting on.
  await act(async () => {
    answerA({ usage: 100 * MB, quota: 100 * MB });
    await runA;
  });
  expect(hook().error).toBe("failed");
});

it("settles 'nothing', not a silent idle, when the audio is gone by the time the build runs", async () => {
  await bookWith("Mark", [[CANONICAL_SAMPLE_RATE]]);
  // The estimate saw a recording; everything is erased before the build.
  vi.mocked(withEncoder).mockImplementationOnce(async (_signal, work) => {
    await clearAllStores();
    return work(codec as AudioCodec);
  });

  await prepare();

  expect(hook().error).toBe("nothing");
  expect(hook().status).toBe("idle");
  expect(reportFailure).not.toHaveBeenCalled();
});
