import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { computePeaks } from "@/lib/audio/peaks";
import { useChapterSegments } from "@/hooks/use-chapter-segments";
import {
  addChapter,
  addSegment,
  createBook,
  getSegmentsOfChapter,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { closeDb, getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import { ROW_PEAK_BUCKETS } from "@/lib/view/segment-rows";
import type { ChapterId, Segment, SegmentId } from "@/types/domain";
import { ramp } from "./support";

/**
 * #824: a `reload()` whose OWN read of `getSegmentsOfChapter` began before a
 * local patch landed, but whose continuation resolves after it, must not
 * repaint that row's NON-label fields — `hasClip`, `peaks` — with the stale
 * data it already captured. PR #809 fixed this for `renameSegment`'s label
 * only; this is the same race for `eraseRow`, which patches `hasClip`,
 * `peaks`, `clipId` and `durationMs` in place rather than `reload()`ing.
 *
 * Same DEFENSIVE-INVARIANT shape as #809's `segment-rename-reload-race.test.ts`:
 * the interleave is built by hand (`getSegmentsOfChapter` deferred for one
 * call), because `eraseRow` never itself calls `reload()` — nothing in this
 * hook's own control flow creates this overlap without a second, external
 * `reload()` caller. Whether a real path reaches it is traced in the PR body,
 * not asserted here.
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

async function mountRecordedChapter(): Promise<{
  chapterId: ChapterId;
  segmentId: SegmentId;
}> {
  const book = await createBook("Mark");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  // A real clip in the store, NOT erased there — `eraseRow` below only patches
  // this hook's own `rows` state; the store's clip is untouched, exactly like
  // the real UI's window between `erase.erase()` landing and `eraseRow`
  // patching the row (`segments-screen.tsx`'s `onConfirmErase`).
  const pcm = ramp(3000);
  await saveTake(segment.id, newClipId(), pcm, CANONICAL_SAMPLE_RATE);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  expect(hook().rows.find((r) => r.segmentId === segment.id)?.hasClip).toBe(
    true
  );
  return { chapterId: chapter.id, segmentId: segment.id };
}

it("keeps an erased row's hasClip/peaks when a reload's stale read settles after it", async () => {
  const { chapterId, segmentId } = await mountRecordedChapter();

  // The pre-erase snapshot a reload started BEFORE the erase would read —
  // captured for real, over the same fake-indexeddb, not fabricated. The
  // clip is still in the store, so this snapshot's read of the segment list
  // is identical to what a reload starting right now would also read; the
  // clip's own audio (read separately, not through this mock) is what still
  // resolves as present until the store write a real `erase.erase()` performs
  // — which this test never calls, matching `eraseRow`'s own contract that it
  // does no store write itself.
  const staleSnapshot: Segment[] = await getSegmentsOfChapter(chapterId);

  let resolveStaleRead: ((segments: Segment[]) => void) | null = null;
  const staleRead = new Promise<Segment[]>((resolve) => {
    resolveStaleRead = resolve;
  });
  vi.mocked(getSegmentsOfChapter).mockImplementationOnce(() => staleRead);

  // Kick off the reload — its `getSegmentsOfChapter` call is the deferred
  // promise above, standing in for a read that began before the erase.
  act(() => {
    hook().reload();
  });
  await vi.waitFor(() => expect(hook().refreshing).toBe(true));

  // The erase patch lands while that read is still outstanding. `eraseRow`
  // does no store write itself (the real erase already happened, or in this
  // test simply never touches the clip) — it is the local patch this hook
  // makes once the caller's own erase settles.
  act(() => {
    hook().eraseRow(segmentId);
  });
  expect(hook().rows.find((r) => r.segmentId === segmentId)?.hasClip).toBe(
    false
  );

  // Now let the stale read settle. Its own segment list is unchanged, so
  // `loadChapterView` walks the same segment and (because the store's clip
  // was never actually cleared here) resolves `hasClip: true` with real
  // peaks — the exact stale repaint #824 describes.
  resolveStaleRead!(staleSnapshot);
  await vi.waitFor(() => expect(hook().refreshing).toBe(false));

  const row = hook().rows.find((r) => r.segmentId === segmentId);
  expect(row?.hasClip).toBe(false);
  expect(row?.peaks).toBeNull();
  expect(row?.durationMs).toBeNull();
  expect(row?.clipId).toBeNull();
});

it("does not let an erase override outlive a later, non-racing reload", async () => {
  const { chapterId, segmentId } = await mountRecordedChapter();

  act(() => {
    hook().eraseRow(segmentId);
  });
  expect(hook().rows.find((r) => r.segmentId === segmentId)?.hasClip).toBe(
    false
  );

  // A plain reload, with nothing racing it: the store's clip was never
  // actually cleared in this test, so a fresh read now legitimately shows the
  // clip is still there. The override this hook recorded for its own erase
  // patch has served its purpose (it protected against a read that started
  // BEFORE the patch) and must not block a load that started AFTER it from
  // reporting what the store actually holds — the same "another writer's
  // later change must win" guarantee #809 established for the label.
  act(() => {
    hook().reload();
  });
  await vi.waitFor(() => expect(hook().refreshing).toBe(false));

  const row = hook().rows.find((r) => r.segmentId === segmentId);
  expect(row?.hasClip).toBe(true);
  expect(row?.peaks).toEqual(computePeaks(ramp(3000), ROW_PEAK_BUCKETS));
  void chapterId;
});

it("a rename during an in-flight post-save reload keeps the label AND installs the new clip", async () => {
  const chapter = await addChapter((await createBook("Mark")).id);
  const segment = await addSegment(chapter.id);
  await act(async () => {
    root.render(createElement(Probe, { chapterId: chapter.id }));
  });
  await vi.waitFor(() => expect(hook().rows[0]?.hasClip).toBe(false));
  // A take lands; the reload that observes it holds its read open (post-save).
  await saveTake(segment.id, newClipId(), ramp(3000), CANONICAL_SAMPLE_RATE);
  const snapshot = await getSegmentsOfChapter(chapter.id);
  let resolveRead: ((segments: Segment[]) => void) | null = null;
  vi.mocked(getSegmentsOfChapter).mockImplementationOnce(
    () => new Promise<Segment[]>((resolve) => (resolveRead = resolve))
  );
  act(() => hook().reload());
  await vi.waitFor(() => expect(resolveRead).not.toBeNull());
  expect(await hook().renameSegment(segment.id, "verses 1–2")).toBe(true);
  resolveRead!(snapshot);
  await vi.waitFor(() => expect(hook().refreshing).toBe(false));
  const row = hook().rows[0];
  expect(row?.label).toBe("verses 1–2");
  expect(row?.hasClip).toBe(true);
  expect(row?.peaks).toEqual(computePeaks(ramp(3000), ROW_PEAK_BUCKETS));
});
