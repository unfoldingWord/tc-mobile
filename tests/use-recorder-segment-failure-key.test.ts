import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { reportFailure } from "@/hooks/report-failure";
import {
  addChapter,
  addSegment,
  createBook,
  getSegment,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { SegmentId } from "@/types/domain";

/**
 * #172 part 2: `useRecorderSegment`'s load effect and its `reload()` must
 * store a `strings`-mapped failure KEY, never the raw `cause.message`
 * `errorMessage()` used to hand the screen, and a quota rejection must map to
 * `"noRoom"` — the same contract part 1 gave `use-books.ts`,
 * `use-chapter-segments.ts` and `use-erase-segment.ts`. Mirrors
 * `use-books-failure-key.test.ts`'s harness: the real hook mounted over
 * fake-indexeddb, with `getSegment` made to reject.
 *
 * Written red-first against the tree before this PR, where both catch sites
 * called `setError(errorMessage(cause))`.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return { ...actual, getSegment: vi.fn(actual.getSegment) };
});

/** A distinctive browser/IndexedDB-shaped message — never a plain "boom". */
const BROWSER_MESSAGE = "UnknownError: Internal error opening backing store";
const quotaError = () =>
  Object.assign(new Error("the disk is full"), { name: "QuotaExceededError" });

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useRecorderSegment> | null } = {
  current: null,
};

function Probe({ segmentId }: { segmentId: SegmentId }) {
  const result = useRecorderSegment(segmentId);
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

async function freshSegment(): Promise<SegmentId> {
  const book = await createBook("Ruth");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  return segment.id;
}

async function mountOk(segmentId: SegmentId): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe, { segmentId }));
  });
  await vi.waitFor(() => expect(hook().view).not.toBeNull());
}

it('maps a segment-open failure to "loadFailed", not the raw store message, and reports the cause (#172)', async () => {
  const segmentId = await freshSegment();
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(getSegment).mockRejectedValueOnce(cause);

  await act(async () => {
    root.render(createElement(Probe, { segmentId }));
  });
  await vi.waitFor(() => expect(hook().error).not.toBeNull());

  expect(hook().error).toBe("loadFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-segment-load");
});

it('maps a quota-exceeded segment-open failure to "noRoom" (#172)', async () => {
  const segmentId = await freshSegment();
  vi.mocked(getSegment).mockRejectedValueOnce(quotaError());

  await act(async () => {
    root.render(createElement(Probe, { segmentId }));
  });
  await vi.waitFor(() => expect(hook().error).not.toBeNull());

  expect(hook().error).toBe("noRoom");
});

it('maps a reload() failure to "loadFailed" and reports the cause under its own context (#172)', async () => {
  const segmentId = await freshSegment();
  await mountOk(segmentId);
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(getSegment).mockRejectedValueOnce(cause);

  await act(async () => {
    await hook().reload();
  });

  expect(hook().error).toBe("loadFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "recorder-segment-reload");
});

it('maps a quota-exceeded reload() failure to "noRoom" (#172)', async () => {
  const segmentId = await freshSegment();
  await mountOk(segmentId);
  vi.mocked(getSegment).mockRejectedValueOnce(quotaError());

  await act(async () => {
    await hook().reload();
  });

  expect(hook().error).toBe("noRoom");
});
