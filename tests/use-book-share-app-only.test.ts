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
import { clearAllStores } from "./support";

/**
 * Share Book in a browser on Android that refuses the zip (#272): the DRI
 * accepted Share Book as app-only there (2026-10-06), so tap 1 reports
 * `appOnly` — before any encode — instead of building the zip and failing.
 * Every other platform keeps its own outcome: the native shell, a browser
 * off Android, and an Android browser that takes the file.
 *
 * Mounted the way `use-book-share-spool.test.ts` mounts the hook: jsdom for
 * React only, fake-indexeddb, a codec the test controls, and `navigator`
 * stubbed with Web Share, `canShare` and a user-agent. Not covered: a real
 * browser's `canShare`, the share sheet, the Capacitor plugin, and a phone.
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
    // Inside the shell the WebView's Web Share is still there and still
    // refuses the zip: the native route must not consult it.
    readShareEnvironment: () =>
      native.on
        ? { native: true, webShare: true, canShareFiles: () => false }
        : actual.readShareEnvironment(),
    readSharePlatform: () => (native.on ? "android" : "web"),
    nativeShare: { stage: vi.fn(), send: vi.fn(), discard: vi.fn() },
  };
});

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

let dom: JSDOM;
let root: Root;
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

/** A browser on `userAgent` whose `canShare` answers `accepts` for a zip. */
function browser(userAgent: string, acceptsZip: boolean): void {
  vi.stubGlobal("navigator", {
    userAgent,
    share,
    canShare: ({ files }: { files: File[] }) =>
      acceptsZip || files.every((f) => f.type !== "application/zip"),
  });
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
  const codec: AudioCodec = {
    encodeMp3: () => Promise.resolve(new Uint8Array(4096).fill(7)),
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

describe("a browser on Android that refuses the zip", () => {
  it("reports appOnly at tap 1, without building the zip or opening the modal", async () => {
    browser(ANDROID_CHROME, false);
    expect(await prepare(await bookWith(2))).toBeNull();
    expect(hook().error).toBe("appOnly");
    expect(hook().status).toBe("idle");
    expect(hook().progress.phase).toBe("hidden");
    expect(withEncoder).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it("clears appOnly on reset, so another book's menu opens without it", async () => {
    browser(ANDROID_CHROME, false);
    await prepare(await bookWith(1));
    expect(hook().error).toBe("appOnly");
    act(() => hook().reset());
    expect(hook().error).toBeNull();
  });

  it("clears appOnly on the next prepare the browser accepts", async () => {
    browser(ANDROID_CHROME, false);
    const bookId = await bookWith(1);
    await prepare(bookId);
    expect(hook().error).toBe("appOnly");
    browser(ANDROID_CHROME, true);
    await prepare(bookId);
    expect(hook().error).toBeNull();
    expect(hook().status).toBe("ready");
  });
});

describe("every other platform keeps its own outcome", () => {
  it("an Android browser that accepts the zip builds and arms it", async () => {
    browser(ANDROID_CHROME, true);
    await prepare(await bookWith(1));
    expect(hook().error).toBeNull();
    expect(hook().status).toBe("ready");
    expect(withEncoder).toHaveBeenCalledTimes(1);
  });

  it("iOS Safari builds and arms the zip", async () => {
    browser(IOS_SAFARI, true);
    await prepare(await bookWith(1));
    expect(hook().error).toBeNull();
    expect(hook().status).toBe("ready");
  });

  it("a desktop browser that refuses the zip still builds it and reports failed", async () => {
    browser(DESKTOP_CHROME, false);
    await prepare(await bookWith(1));
    expect(withEncoder).toHaveBeenCalledTimes(1);
    expect(hook().error).toBe("failed");
    expect(share).not.toHaveBeenCalled();
  });

  it("the native shell on Android stages the zip through the plugin, whatever the WebView's canShare says (#347)", async () => {
    native.on = true;
    browser(ANDROID_CHROME, false);
    vi.mocked(nativeShare.stage).mockResolvedValue({
      uri: "file:///cache/x/Book.zip",
      dir: "x",
    });
    // A chooser that stays up.
    vi.mocked(nativeShare.send).mockImplementation(() => new Promise(() => {}));
    const bookId = await bookWith(1);
    act(() => {
      void hook().prepare(bookId, "Book.zip", (n) => `Chapter ${n}.mp3`);
    });
    await settle();
    expect(hook().error).toBeNull();
    expect(nativeShare.stage).toHaveBeenCalledTimes(1);
  });
});
