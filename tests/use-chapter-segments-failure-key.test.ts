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
  getSegmentsOfChapter,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { ChapterId } from "@/types/domain";

/**
 * #172 part 1: `useChapterSegments` must store a `strings`-mapped failure
 * KEY, never a raw `cause.message`, and a quota rejection must map to
 * `"noRoom"`. Same harness as `segment-rename-failure.test.ts` (the hook
 * mounted for real over fake-indexeddb, one store function made to reject).
 *
 * RED FIRST: run against the tree before this PR (`setError(errorMessage(
 * cause))`), these assertions failed with, e.g.:
 *
 *   expected 'UnknownError: Internal error opening backing store' to be 'saveFailed'
 *
 * — the raw browser string the Segments Notice used to speak verbatim.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    getSegmentsOfChapter: vi.fn(actual.getSegmentsOfChapter),
    addSegment: vi.fn(actual.addSegment),
  };
});

const BROWSER_MESSAGE = "UnknownError: Internal error opening backing store";
const quotaError = () =>
  Object.assign(new Error("the disk is full"), { name: "QuotaExceededError" });

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useChapterSegments> | null } = {
  current: null,
};

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

async function mountChapter(): Promise<ChapterId> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  return chapter.id;
}

it('maps a chapter-load failure to "loadFailed", not the raw store message, and reports the cause (#172)', async () => {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(getSegmentsOfChapter).mockRejectedValueOnce(cause);

  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loading).toBe(false));

  expect(hook().error).toBe("loadFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "chapter-load");
});

it('maps a quota-exceeded chapter-load failure to "noRoom" (#172)', async () => {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  vi.mocked(getSegmentsOfChapter).mockRejectedValueOnce(quotaError());

  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loading).toBe(false));

  expect(hook().error).toBe("noRoom");
});

it('maps a failed addSegment write to "saveFailed", not the raw message, and reports the cause (#172)', async () => {
  await mountChapter();
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(addSegment).mockRejectedValueOnce(cause);

  await act(async () => {
    await hook().addSegment();
  });

  expect(hook().error).toBe("saveFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "chapter-add-segment");
});

it('maps a quota-exceeded addSegment failure to "noRoom" (#172)', async () => {
  await mountChapter();
  vi.mocked(addSegment).mockRejectedValueOnce(quotaError());

  await act(async () => {
    await hook().addSegment();
  });

  expect(hook().error).toBe("noRoom");
});
