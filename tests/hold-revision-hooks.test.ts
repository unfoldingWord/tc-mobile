import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withObservedRevision } from "@/hooks/observed-revision";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSaveTake } from "@/hooks/use-save-take";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
import { clearSegmentTake, saveTake } from "@/lib/storage/takes";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import type { SegmentId } from "@/types/domain";
import { clearAllStores } from "./support";

/**
 * Two hook-level pins from bench round 2 on #1618, run through the real hooks
 * over fake-indexeddb (the `use-books-reorder` harness):
 *
 *   - George's blocking finding on `takes.ts:305` was refuted by the live
 *     guard in `discardPendingTake`: while a save is in flight, a Discard
 *     does nothing. This pins that guard.
 *   - The revision a recording's base was read at is noted only by the load
 *     the recorder adopts, never by one it cancelled (George r2 on
 *     `observed-revision.ts`), and by `reload` after an in-sheet commit.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/takes")>();
  return { ...actual, saveTake: vi.fn(actual.saveTake) };
});
vi.mock("@/lib/storage/segment-audio", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/storage/segment-audio")>();
  return { ...actual, loadSegmentClip: vi.fn(actual.loadSegmentClip) };
});

const real = {
  saveTake: (
    await vi.importActual<typeof import("@/lib/storage/takes")>(
      "@/lib/storage/takes"
    )
  ).saveTake,
  loadSegmentClip: (
    await vi.importActual<typeof import("@/lib/storage/segment-audio")>(
      "@/lib/storage/segment-audio"
    )
  ).loadSegmentClip,
};

const samples = (n: number, value = 1000): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A segment carrying one PCM take: revision 1. */
const keptSegment = async (): Promise<SegmentId> => {
  const book = await createBook("b");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  await real.saveTake(
    segment.id,
    newClipId(),
    samples(20),
    CANONICAL_SAMPLE_RATE
  );
  return segment.id;
};

/** A promise and the call that settles it. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

let dom: JSDOM;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(saveTake).mockImplementation(real.saveTake);
  vi.mocked(loadSegmentClip).mockImplementation(real.loadSegmentClip);
  await clearAllStores();
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

describe("a Discard while a save is in flight (refutation of George r2 on takes.ts:305)", () => {
  const probe: { current: ReturnType<typeof useSaveTake> | null } = {
    current: null,
  };
  function Probe() {
    const result = useSaveTake();
    useLayoutEffect(() => {
      probe.current = result;
    });
    return null;
  }

  it("does nothing: the save lands and the take is not discarded", async () => {
    const segmentId = await keptSegment();
    const held = gate();
    const reached = gate();
    vi.mocked(saveTake).mockImplementation(async (...args) => {
      reached.open();
      await held.wait;
      return real.saveTake(...args);
    });
    await act(async () => {
      root.render(createElement(Probe));
    });

    let saved: Promise<boolean> | undefined;
    await act(async () => {
      saved = probe.current!.saveRecording(
        segmentId,
        1,
        samples(20),
        samples(10, 7),
        20,
        false
      );
    });
    await reached.wait;
    const take = probe.current!.pendingTake;
    expect(take?.state).toBe("saving");

    // The Delete tap, in the window George named: after the save's flag read
    // has been passed and before its writes land.
    await act(async () => {
      probe.current!.discardPendingTake();
    });
    expect(probe.current!.pendingTake).toBe(take);

    held.open();
    await act(async () => {
      expect(await saved).toBe(true);
    });
    const db = await getDb();
    const segment = await db.get("segments", segmentId);
    const active = await db.get("takes", segment!.activeTakeId!);
    expect(active?.clipId).toBe(take!.clipId);
    expect((await db.get("takeDispositions", take!.clipId))?.kind).toBe(
      "saved"
    );
    expect(probe.current!.pendingTake).toBeNull();
  });
});

describe("the noted revision follows the adopted view (George r2 on observed-revision.ts)", () => {
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

  const baseRevisionOf = (segmentId: SegmentId) =>
    withObservedRevision({
      segmentId,
      ordinal: 1,
      clipId: newClipId(),
      existing: samples(0),
      recorded: samples(10, 7),
      offset: 0,
      finished: false,
      editOnly: false,
    }).baseRevision;

  it("a load the recorder cancelled notes nothing, even when it read a newer revision", async () => {
    const segmentId = await keptSegment();
    // The mount's load waits; the retry's load reads at once.
    const first = gate();
    vi.mocked(loadSegmentClip).mockImplementationOnce(async (...args) => {
      await first.wait;
      return real.loadSegmentClip(...args);
    });
    await act(async () => {
      root.render(createElement(Probe, { segmentId }));
    });
    await act(async () => {
      probe.current!.retry();
    });
    await vi.waitFor(() => expect(probe.current!.view?.hasClip).toBe(true));
    expect(baseRevisionOf(segmentId)).toBe(1);

    // Another copy erases; then the cancelled load reads revision 2.
    await clearSegmentTake(segmentId);
    await act(async () => {
      first.open();
    });
    await vi.waitFor(() =>
      expect(vi.mocked(loadSegmentClip).mock.results[0]?.value).toBeDefined()
    );
    await act(async () => {
      await vi.mocked(loadSegmentClip).mock.results[0]!.value;
    });

    // The editor still holds the adopted view's samples, read at 1.
    expect(probe.current!.view?.hasClip).toBe(true);
    expect(baseRevisionOf(segmentId)).toBe(1);
  });

  // #163 A-14: the generation is noted with the revision, from the same view.
  const baseGenerationOf = (segmentId: SegmentId) =>
    withObservedRevision({
      segmentId,
      ordinal: 1,
      clipId: newClipId(),
      existing: samples(0),
      recorded: samples(10, 7),
      offset: 0,
      finished: false,
      editOnly: false,
    }).baseGeneration;

  it("a load the recorder cancelled notes no generation; reload notes its view's", async () => {
    const segmentId = await keptSegment();
    const first = gate();
    vi.mocked(loadSegmentClip).mockImplementationOnce(async (...args) => {
      await first.wait;
      return real.loadSegmentClip(...args);
    });
    await act(async () => {
      root.render(createElement(Probe, { segmentId }));
    });
    await act(async () => {
      probe.current!.retry();
    });
    await vi.waitFor(() => expect(probe.current!.view?.hasClip).toBe(true));
    expect(baseGenerationOf(segmentId)).toBe(0);

    // Another copy saves a fix of an MP3 (generation 2); then the cancelled
    // load reads it.
    await real.saveTake(
      segmentId,
      newClipId(),
      samples(20),
      CANONICAL_SAMPLE_RATE,
      {
        baseGeneration: 2,
      }
    );
    await act(async () => {
      first.open();
    });
    await vi.waitFor(() =>
      expect(vi.mocked(loadSegmentClip).mock.results[0]?.value).toBeDefined()
    );
    await act(async () => {
      await vi.mocked(loadSegmentClip).mock.results[0]!.value;
    });
    expect(baseGenerationOf(segmentId)).toBe(0);

    await act(async () => {
      await probe.current!.reload();
    });
    expect(baseGenerationOf(segmentId)).toBe(2);
  });

  it("reload notes the revision of the view it returns", async () => {
    const segmentId = await keptSegment();
    await act(async () => {
      root.render(createElement(Probe, { segmentId }));
    });
    await vi.waitFor(() => expect(probe.current!.view).not.toBeNull());
    expect(baseRevisionOf(segmentId)).toBe(1);

    await clearSegmentTake(segmentId);
    await act(async () => {
      await probe.current!.reload();
    });
    expect(probe.current!.view?.hasClip).toBe(false);
    expect(baseRevisionOf(segmentId)).toBe(2);
  });
});
