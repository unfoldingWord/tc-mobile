import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useChapterSegments } from "@/hooks/use-chapter-segments";
import { reportFailure } from "@/hooks/report-failure";
import {
  addChapter,
  addSegment,
  createBook,
  renameSegment,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * A segment rename that fails for any reason but a vanished segment goes to
 * the failure funnel under `"segment-rename"` (#591), and NOT into the screen
 * Notice: that Notice would show the store's raw exception text (#172), and
 * the row's own `renameSegmentFailed` line is already the presentation.
 *
 * The hook runs for real over fake-indexeddb; only the store's rename is made
 * to throw, and the funnel is replaced so the call can be read back.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/books")>()),
  renameSegment: vi.fn(),
}));

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useChapterSegments> | null } = {
  current: null,
};

/** Hands the hook's latest return out after each commit (never during render). */
function Probe({ chapterId }: { chapterId: ChapterId }) {
  const result = useChapterSegments(chapterId);
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

beforeEach(async () => {
  vi.clearAllMocks();
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mountChapter(): Promise<SegmentId> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  return segment.id;
}

it("reports a failed rename to the funnel and keeps the screen Notice clear", async () => {
  const segmentId = await mountChapter();
  const cause = new Error("QuotaExceededError: the disk is full");
  vi.mocked(renameSegment).mockRejectedValueOnce(cause);

  let ok: boolean | undefined;
  await act(async () => {
    ok = await hook().renameSegment(segmentId, "verses 3–4");
  });

  expect(ok).toBe(false);
  expect(reportFailure).toHaveBeenCalledWith(cause, "segment-rename");
  expect(hook().error).toBeNull();
  expect(hook().staleTarget).toBe(false);
});

it("still treats a vanished segment as a stale target, not a failure to log", async () => {
  const segmentId = await mountChapter();
  vi.mocked(renameSegment).mockRejectedValueOnce(
    new Error(`No such segment: ${segmentId}`)
  );

  await act(async () => {
    await hook().renameSegment(segmentId, "verses 3–4");
  });

  expect(hook().staleTarget).toBe(true);
  expect(reportFailure).not.toHaveBeenCalled();
});
