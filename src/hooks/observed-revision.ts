import type { NewTake } from "@/lib/takes/pending-take";
import type { SegmentId } from "@/types/domain";

/**
 * The segment's `audioRevision` read with the audio the recorder opened on,
 * per segment, so a save can say which revision its base belongs to (George
 * r1 on #1618, docs/design/pending-take-lifecycle.md cell HM).
 *
 * Written by {@link noteObservedRevision} when `useRecorderSegment` adopts a
 * view (its `audioRevision`, read in the same transaction as the samples), and
 * never by a load it cancelled (George r2 on #1618). Read by
 * {@link withObservedRevision} when `saveRecording` builds the take.
 *
 * The value and the editor's buffer are kept together by the recorder, not by
 * this module: the note is made where the view is set, and the recorder's
 * editor re-bases on that view's `samples` (`useSegmentEditor`). The note's
 * placement is tested (`tests/hold-revision-hooks.test.ts`); the editor's
 * re-base is read from the code. A value older than the buffer makes a replay
 * judge the row `moved` and keep it unsaved, the fail-safe direction; a newer
 * one is the direction this exists to prevent.
 */
const observed = new Map<SegmentId, number>();

export function noteObservedRevision(
  segmentId: SegmentId,
  revision: number
): void {
  observed.set(segmentId, revision);
}

/**
 * The take, carrying the revision last noted for its segment as
 * `baseRevision`, or `null` when none was. The hold stamps that value on the
 * pending row, never the revision it reads itself.
 */
export function withObservedRevision(
  take: Omit<NewTake, "baseRevision">
): NewTake {
  return { ...take, baseRevision: observed.get(take.segmentId) ?? null };
}
