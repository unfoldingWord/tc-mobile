import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useChapterSegments } from "@/hooks/use-chapter-segments";
import {
  addChapter,
  addSegment,
  createBook,
  getSegmentsOfChapter,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { ChapterId, Segment, SegmentId } from "@/types/domain";

/**
 * #676 item 4: a `reload()` whose OWN read of `getSegmentsOfChapter` began
 * before a `renameSegment` write landed, but whose continuation runs after
 * it, must not repaint the stale label it already captured over the landed
 * rename.
 *
 * This is a DEFENSIVE-INVARIANT test, not a reproduced production race: the
 * interleave is built by hand (`getSegmentsOfChapter` is mocked for exactly
 * one call, deferred until the test resolves it), because `renameSegment`
 * never itself calls `reload()` — nothing in this hook's own control flow
 * creates this overlap without a second, external `reload()` caller. Whether
 * a real path reaches it is traced in the PR body, not asserted here: the
 * one live candidate is `App.tsx`'s `useSaveTake({ onSaved })`, whose commit
 * can in principle land after the user has left the (no-longer-`inert`)
 * Segments screen and started a rename elsewhere, but that timing was not
 * reproduced end to end against a real recorder session.
 */

vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    getSegmentsOfChapter: vi.fn(actual.getSegmentsOfChapter),
  };
});

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

async function mountChapter(): Promise<{
  chapterId: ChapterId;
  segmentId: SegmentId;
}> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  return { chapterId: chapter.id, segmentId: segment.id };
}

it("keeps a landed rename's label when a reload's stale read settles after it", async () => {
  const { chapterId, segmentId } = await mountChapter();

  // The pre-rename snapshot a reload started BEFORE the write would read —
  // captured for real, over the same fake-indexeddb, not fabricated.
  const staleSnapshot: Segment[] = await getSegmentsOfChapter(chapterId);
  expect(staleSnapshot.find((s) => s.id === segmentId)?.label).toBeNull();

  let resolveStaleRead: ((segments: Segment[]) => void) | null = null;
  const staleRead = new Promise<Segment[]>((resolve) => {
    resolveStaleRead = resolve;
  });
  vi.mocked(getSegmentsOfChapter).mockImplementationOnce(() => staleRead);

  // Kick off the reload — its `getSegmentsOfChapter` call is the deferred
  // promise above, standing in for a read that began before the rename.
  act(() => {
    hook().reload();
  });
  await vi.waitFor(() => expect(hook().refreshing).toBe(true));

  // The rename lands while that read is still outstanding.
  let renamed: boolean | undefined;
  await act(async () => {
    renamed = await hook().renameSegment(segmentId, "verses 3–4");
  });
  expect(renamed).toBe(true);
  expect(hook().rows.find((r) => r.segmentId === segmentId)?.label).toBe(
    "verses 3–4"
  );

  // Now let the stale read settle, with the snapshot it actually captured.
  resolveStaleRead!(staleSnapshot);
  await vi.waitFor(() => expect(hook().refreshing).toBe(false));

  expect(hook().rows.find((r) => r.segmentId === segmentId)?.label).toBe(
    "verses 3–4"
  );
});
