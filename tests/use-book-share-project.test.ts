import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportFailure } from "@/hooks/report-failure";
import { useBookShare } from "@/hooks/use-book-share";
import type { BookBundleParams } from "@/hooks/use-book-export";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { BookId } from "@/types/domain";
import { type FakeOpfs, fakeOpfs } from "./fake-opfs";
import { clearAllStores } from "./support";

/**
 * Export project through the real Share Book flow (#1457): the same hook, the
 * same two-gesture send, the same spool lifetime. Mounted like
 * `use-book-share-spool.test.ts`. Not covered: a real OPFS, the share sheet,
 * and another app opening the zip; those are device-only.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
// Share book's MP3 zip needs an encoder; a stub one, as the spool test uses.
vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return {
    ...actual,
    withEncoder: vi.fn(
      async (_signal: AbortSignal, work: (codec: AudioCodec) => unknown) =>
        work({
          encodeMp3: () => Promise.resolve(new Uint8Array(4096).fill(7)),
          decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
        })
    ),
  };
});

let dom: JSDOM;
let root: Root;
let opfs: FakeOpfs;
let share: ReturnType<typeof vi.fn>;

const probe: { current: ReturnType<typeof useBookShare> | null } = {
  current: null,
};
function Probe() {
  const result = useBookShare();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

const settle = (ms = 30) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

async function filesBecome(n: number): Promise<void> {
  for (let i = 0; i < 100 && opfs.files().length !== n; i++) await settle(10);
  expect(opfs.files()).toHaveLength(n);
}

/** One chapter: a recorded segment, plus `bare` segments nobody recorded. */
async function bookWith(recorded: number, bare = 0): Promise<BookId> {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  for (let i = 0; i < recorded; i++) {
    const seg = await addSegment(chapter.id);
    await saveTake(
      seg.id,
      newClipId(),
      new Int16Array(100).fill(100 + i),
      CANONICAL_SAMPLE_RATE
    );
  }
  for (let i = 0; i < bare; i++) await addSegment(chapter.id);
  return book.id;
}

const params: BookBundleParams = {
  filename: "Mark - project.zip",
  bookName: "Mark",
  appVersion: "1.1.0",
  defaultLocale: "en",
  exportedAt: Date.UTC(2026, 9, 22),
};

async function prepareProject(bookId: BookId): Promise<unknown> {
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepareProject(bookId, params);
  });
  await settle();
  return act(async () => prepared);
}

async function send(): Promise<unknown> {
  let sent!: Promise<unknown>;
  act(() => {
    sent = hook().send();
  });
  await settle();
  act(() => hook().dismissProgress());
  return act(async () => sent);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  opfs = fakeOpfs();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  share = vi.fn(() => Promise.resolve());
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    share,
    canShare: () => true,
    storage: { getDirectory: opfs.source },
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

describe("prepareProject", () => {
  it("arms the bundle for the same send gesture, and shares a zip under the export's name", async () => {
    expect(hook().kind).toBe("zip");
    await prepareProject(await bookWith(2));
    expect(hook().status).toBe("ready");
    expect(hook().kind).toBe("project");
    expect(hook().error).toBeNull();
    expect(opfs.files()).toHaveLength(1);

    await send();
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    const file = files[0]!;
    expect(file.name).toBe("Mark - project.zip");
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    await filesBecome(0);
  });

  it("carries the segments with no audio as the book's gap, so the same Notice says so", async () => {
    await prepareProject(await bookWith(1, 2));
    expect(hook().status).toBe("ready");
    expect(hook().partialSegments).toBe(2);
    expect(hook().missing).toBe(0);
  });

  it("says there is nothing to share for a book with no audio, as Share Book does, and keeps no spool", async () => {
    await prepareProject(await bookWith(0, 2));
    expect(hook().status).toBe("idle");
    expect(hook().error).toBe("nothing");
    await filesBecome(0);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("files the build's own row, then the flow's, and shows the failed state", async () => {
    // A book id with no rows reads as empty, so break the read instead.
    const bookId = await bookWith(1);
    const writer = await import("@/lib/export/bundle/write");
    const spy = vi
      .spyOn(writer, "writeBundleZip")
      .mockRejectedValueOnce(new Error("zip broke"));
    await prepareProject(bookId);
    spy.mockRestore();
    expect(hook().status).toBe("idle");
    expect(hook().error).toBe("failed");
    expect(vi.mocked(reportFailure)).toHaveBeenCalledWith(
      expect.objectContaining({ message: "zip broke" }),
      "book-export-bundle"
    );
    expect(vi.mocked(reportFailure).mock.calls.map((c) => c[1])).toEqual([
      "book-export-bundle",
      "share-prepare",
    ]);
    await filesBecome(0);
  });

  it("does nothing while Share book's zip is armed: Share now still sends that zip, named as such (#1624 Frank R1)", async () => {
    const bookId = await bookWith(1);
    let zipped!: Promise<unknown>;
    act(() => {
      zipped = hook().prepare(bookId, "Mark.zip", (n) => `Chapter ${n}.mp3`);
    });
    await settle();
    await act(async () => zipped);
    expect(hook().status).toBe("ready");

    expect(await prepareProject(bookId)).toBeNull();
    expect(hook().kind).toBe("zip");
    expect(hook().status).toBe("ready");
    expect(opfs.files()).toHaveLength(1);

    await send();
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files[0]!.name).toBe("Mark.zip");
    await filesBecome(0);
  });

  it("leaves the armed bundle alone when Share book is tapped (kind stays project)", async () => {
    const bookId = await bookWith(1);
    await prepareProject(bookId);
    let zipped!: Promise<unknown>;
    act(() => {
      zipped = hook().prepare(bookId, "Mark.zip", (n) => `Chapter ${n}.mp3`);
    });
    expect(await act(async () => zipped)).toBeNull();
    expect(hook().kind).toBe("project");
    await send();
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files[0]!.name).toBe("Mark - project.zip");
    await filesBecome(0);
  });

  it("removes the spool and returns kind to zip when the menu is reset", async () => {
    await prepareProject(await bookWith(1));
    expect(opfs.files()).toHaveLength(1);
    act(() => hook().reset());
    expect(hook().kind).toBe("zip");
    await filesBecome(0);
    expect(share).not.toHaveBeenCalled();
  });

  it("leaves no spool and no share when the menu is reset while the build runs", async () => {
    const bookId = await bookWith(2);
    let prepared!: Promise<unknown>;
    act(() => {
      prepared = hook().prepareProject(bookId, params);
    });
    act(() => hook().reset());
    await act(async () => prepared);
    await settle();
    expect(hook().status).toBe("idle");
    expect(hook().error).toBeNull();
    await filesBecome(0);
    expect(share).not.toHaveBeenCalled();
  });
});
