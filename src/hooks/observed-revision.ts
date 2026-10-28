import type { NewTake } from "@/lib/takes/pending-take";
import type { SegmentId } from "@/types/domain";

/**
 * The segment's `audioRevision` and the clip's `generation` read with the
 * audio the recorder opened on, per segment, so a save can say which revision
 * its base belongs to (George r1 on #1618, docs/design/pending-take-lifecycle.md
 * cell HM) and how many lossy passes that audio has had (#163 A-14).
 *
 * Written by {@link noteObservedRevision} when `useRecorderSegment` adopts a
 * view (its `audioRevision` and `generation`, both read in the same
 * transaction as the samples), and never by a load it cancelled (George r2 on
 * #1618). The two are noted together from one view, so they cannot describe
 * different loads. Read by {@link withObservedRevision} when `saveRecording`
 * builds the take.
 *
 * The values and the editor's buffer are kept together by the recorder, not by
 * this module: the note is made where the view is set, and the recorder's
 * editor re-bases on that view's `samples` (`useSegmentEditor`). The note's
 * placement is tested (`tests/hold-revision-hooks.test.ts`); the editor's
 * re-base is read from the code. A revision older than the buffer makes a
 * replay judge the row `moved` and keep it unsaved, the fail-safe direction; a
 * newer one is the direction this exists to prevent.
 */
const observed = new Map<
  SegmentId,
  { readonly revision: number; readonly generation: number }
>();

export function noteObservedRevision(
  segmentId: SegmentId,
  view: { readonly audioRevision: number; readonly generation: number }
): void {
  observed.set(segmentId, {
    revision: view.audioRevision,
    generation: view.generation,
  });
}

/**
 * The take, carrying the revision and generation last noted for its segment
 * as `baseRevision` and `baseGeneration`, or `null` for both when none was.
 * The hold stamps those values on the pending row, never ones it reads itself,
 * and the commit stamps the generation on the saved clip.
 */
export function withObservedRevision(
  take: Omit<NewTake, "baseRevision" | "baseGeneration">
): NewTake {
  const noted = observed.get(take.segmentId);
  return {
    ...take,
    baseRevision: noted?.revision ?? null,
    baseGeneration: noted?.generation ?? null,
  };
}
