import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { nativeShare } from "@/hooks/share-target";
import { useBookShare } from "@/hooks/use-book-share";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { saveTake } from "@/lib/storage/takes";
import type { AudioCodec } from "@/types/audio";
import type { BookId } from "@/types/domain";
import { type FakeOpfs, fakeOpfs } from "./fake-opfs";
import { clearAllStores } from "./support";

/**
 * Share Book's spool through the real hook and the real share flow (#1003):
 * the zip is on the (fake) OPFS disk while the File is armed, and gone once
 * the File is done with — sent, dismissed, failed, staged natively, reset,
 * unmounted, cancelled mid-build — and kept across a web `retry`, which arms
 * the same File again.
 *
 * Mounted the way `use-chapter-share-carry.test.ts` mounts its hook: jsdom for
 * React only, fake-indexeddb, a codec the test controls, and `navigator`
 * stubbed with Web Share and a fake `storage.getDirectory`. Not covered: a
 * real OPFS, the real share sheet, the Capacitor plugin, and a phone.
 */

const native = vi.hoisted(() => ({ on: false }));

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/mp3-codec", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/mp3-codec")>();
  return { ...actual, withEncoder: vi.fn() };
});
vi.mock("@/hooks/share-target", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/share-target")>();
  return {
    ...actual,
    readShareEnvironment: () =>
      native.on
        ? { native: true, webShare: false, canShareFiles: null }
        : actual.readShareEnvironment(),
    readSharePlatform: () => (native.on ? "android" : "web"),
    nativeShare: { stage: vi.fn(), send: vi.fn(), discard: vi.fn() },
  };
});

let dom: JSDOM;
let root: Root;
let opfs: FakeOpfs;
let share: ReturnType<typeof vi.fn>;
/** Resolves the encode the export is waiting on, when `hold` is set. */
let hold = false;
let finishEncode: () => void = () => undefined;
/** Resolves when a held encode has started and `finishEncode` is set. */
let encodeStarted!: Promise<void>;
let markEncodeStarted: () => void = () => undefined;
let encodeError: Error | null = null;

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

/** Wait (bounded) until the fake disk holds exactly `n` spool files. */
async function filesBecome(n: number): Promise<void> {
  for (let i = 0; i < 100 && opfs.files().length !== n; i++) await settle(10);
  expect(opfs.files()).toHaveLength(n);
}

async function bookWith(chapters: number): Promise<BookId> {
  const book = await createBook("b");
  for (let i = 0; i < chapters; i++) {
    const chapter = await addChapter(book.id);
    const seg = await addSegment(chapter.id);
    await saveTake(
      seg.id,
      newClipId(),
      new Int16Array(100).fill(100 + i),
      CANONICAL_SAMPLE_RATE
    );
  }
  return book.id;
}

/** Tap 1, driven to its settle. */
async function prepare(bookId: BookId): Promise<unknown> {
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(bookId, "Book.zip", (n) => `Chapter ${n}.mp3`);
  });
  await settle();
  return act(async () => prepared);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await clearAllStores();
  native.on = false;
  hold = false;
  encodeError = null;
  encodeStarted = new Promise<void>((r) => {
    markEncodeStarted = r;
  });
  opfs = fakeOpfs();
  const codec: AudioCodec = {
    encodeMp3: () => {
      if (encodeError) return Promise.reject(encodeError);
      if (!hold) return Promise.resolve(new Uint8Array(4096).fill(7));
      return new Promise((resolve) => {
        finishEncode = () => resolve(new Uint8Array(4096).fill(7));
        markEncodeStarted();
      });
    },
    decodeMp3: () => Promise.reject(new Error("no MP3 clip expected")),
  };
  vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
    work(codec)
  );
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

/** Tap 2, letting the outcome flash go so `send()` returns. */
async function send(): Promise<unknown> {
  let sent!: Promise<unknown>;
  act(() => {
    sent = hook().send();
  });
  await settle();
  act(() => hook().dismissProgress());
  return act(async () => sent);
}

describe("the web route", () => {
  it("keeps the spool while the File is armed, shares a zip read back from it, and removes it once the sheet resolves", async () => {
    const bookId = await bookWith(2);
    await prepare(bookId);
    expect(hook().status).toBe("ready");
    expect(opfs.files()).toHaveLength(1);

    await send();
    expect(share).toHaveBeenCalledTimes(1);
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    const file = files[0]!;
    expect(file.name).toBe("Book.zip");
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    // "PK\x03\x04": a zip's first local file header.
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    await filesBecome(0);
  });

  it("removes it when the sheet is dismissed", async () => {
    await prepare(await bookWith(1));
    share.mockImplementationOnce(() =>
      Promise.reject(new DOMException("closed", "AbortError"))
    );
    expect(await send()).toBe("dismissed");
    await filesBecome(0);
  });

  it("removes it when the share fails", async () => {
    await prepare(await bookWith(1));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    share.mockImplementationOnce(() => Promise.reject(new Error("broken")));
    expect(await send()).toBe("failed");
    await filesBecome(0);
    error.mockRestore();
  });

  it("KEEPS it across a retry, because the same File is armed again — then a reset removes it", async () => {
    await prepare(await bookWith(1));
    share.mockImplementationOnce(() =>
      Promise.reject(new DOMException("spent", "NotAllowedError"))
    );
    expect(await send()).toBe("retry");
    expect(hook().status).toBe("ready");
    await settle();
    expect(opfs.files()).toHaveLength(1);

    act(() => hook().reset());
    await filesBecome(0);
  });

  it("removes it when the menu is reset while the File is armed", async () => {
    await prepare(await bookWith(1));
    expect(opfs.files()).toHaveLength(1);
    act(() => hook().reset());
    await filesBecome(0);
  });

  it("removes it when the screen unmounts while the File is armed", async () => {
    await prepare(await bookWith(1));
    expect(opfs.files()).toHaveLength(1);
    await act(async () => root.unmount());
    await filesBecome(0);
    // afterEach unmounts again; give it a fresh root to unmount.
    root = createRoot(dom.window.document.getElementById("root")!);
  });

  it("removes it when the build is cancelled mid-encode", async () => {
    hold = true;
    const bookId = await bookWith(2);
    let prepared!: Promise<unknown>;
    act(() => {
      prepared = hook().prepare(bookId, "Book.zip", (n) => `Chapter ${n}.mp3`);
    });
    await act(async () => {
      await encodeStarted;
    });
    // The spool is open and the first chapter is encoding.
    expect(opfs.files()).toHaveLength(1);
    act(() => hook().reset());
    finishEncode();
    await act(async () => prepared);
    await filesBecome(0);
    expect(share).not.toHaveBeenCalled();
  });

  it("removes it when the build fails", async () => {
    encodeError = new Error("encoder broke");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await prepare(await bookWith(1));
    expect(hook().status).toBe("idle");
    expect(hook().error).not.toBeNull();
    await filesBecome(0);
    error.mockRestore();
  });

  it("builds from memory, with no file anywhere, where the browser has no OPFS", async () => {
    vi.stubGlobal("navigator", { share, canShare: () => true });
    await prepare(await bookWith(1));
    expect(hook().status).toBe("ready");
    expect(opfs.files()).toEqual([]);
    await send();
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files[0]!.size).toBeGreaterThan(4096);
  });
});

describe("the native route", () => {
  it("removes the spool as soon as the File is staged, before the chooser settles", async () => {
    native.on = true;
    let stagedBytes = 0;
    vi.mocked(nativeShare.stage).mockImplementation(async (file) => {
      // The stage reads the File, and the spool must still be there for it.
      expect(opfs.files()).toHaveLength(1);
      stagedBytes = (await file.arrayBuffer()).byteLength;
      return { uri: "file:///cache/x/Book.zip", dir: "x" };
    });
    // A chooser that stays up.
    vi.mocked(nativeShare.send).mockImplementation(() => new Promise(() => {}));
    const bookId = await bookWith(1);
    act(() => {
      void hook().prepare(bookId, "Book.zip", (n) => `Chapter ${n}.mp3`);
    });
    await settle();
    await filesBecome(0);
    expect(stagedBytes).toBeGreaterThan(4096);
    expect(nativeShare.send).toHaveBeenCalledTimes(1);
  });

  it("removes the spool when staging fails", async () => {
    native.on = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(nativeShare.stage).mockRejectedValue(new Error("cache full"));
    await prepare(await bookWith(1));
    expect(hook().status).toBe("idle");
    await filesBecome(0);
    error.mockRestore();
  });
});
