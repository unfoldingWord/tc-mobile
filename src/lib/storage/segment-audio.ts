/**
 * The segment -> active take -> clip walk, answered in one place.
 *
 * Three call sites used to walk it independently and had drifted to three
 * different answers for a broken pointer: the export path pushed
 * `take.clipId` onward without checking the clip existed, the chapter loader
 * rendered the segment as never recorded, and playback released the audio
 * floor without a word. A segment that claims a recording the database cannot
 * produce is not the same thing as a segment nobody has recorded yet, and
 * every caller has to be able to tell them apart.
 *
 * So the outcome is a tagged union rather than `Clip | undefined`. A caller
 * that wants to collapse the broken cases into "nothing to play" still can —
 * but it has to do so in its own code, where the choice is visible.
 *
 * This is a read path. It repairs nothing and writes nothing: what to do
 * about a dangling take is a product question that has not been answered yet.
 */

import { clipDataExists, getClip, getClipMeta } from "./clips";
import { getDb } from "./db";
import type { Clip, ClipMeta } from "@/types/audio";
import type { Segment, SegmentId, Take, TakeId } from "@/types/domain";

/**
 * What the walk found.
 *
 * `C` is how much of the clip the caller asked for — `ClipMeta` for a
 * duration or an id, `Clip` for the samples. Loading PCM to answer "does this
 * chapter export completely" would pull megabytes off disk to check that a
 * key exists.
 */
export type SegmentAudio<C> =
  /** The segment has an active take and that take's audio is present. */
  | {
      readonly kind: "resolved";
      readonly segment: Segment;
      readonly take: Take;
      readonly clip: C;
    }
  /** No such segment row. The id came from a stale or partial write. */
  | { readonly kind: "no-segment"; readonly segmentId: SegmentId }
  /** Nobody has recorded this segment yet. The ordinary empty case. */
  | { readonly kind: "no-active-take"; readonly segment: Segment }
  /** The segment names an active take whose row is gone. */
  | {
      readonly kind: "take-missing";
      readonly segment: Segment;
      readonly takeId: TakeId;
    }
  /** The take is there; the audio it names is not. */
  | {
      readonly kind: "clip-missing";
      readonly segment: Segment;
      readonly take: Take;
    };

/**
 * The walk up to the take, with no audio read.
 *
 * Private because a caller stopping here is a caller that has not checked
 * whether the audio exists, which is the bug this module was written for.
 */
type TakeWalk =
  | {
      readonly kind: "resolved";
      readonly segment: Segment;
      readonly take: Take;
    }
  | { readonly kind: "no-segment"; readonly segmentId: SegmentId }
  | { readonly kind: "no-active-take"; readonly segment: Segment }
  | {
      readonly kind: "take-missing";
      readonly segment: Segment;
      readonly takeId: TakeId;
    };

async function walkToTake(segmentId: SegmentId): Promise<TakeWalk> {
  const db = await getDb();
  const segment = await db.get("segments", segmentId);
  if (!segment) return { kind: "no-segment", segmentId };
  const takeId = segment.activeTakeId;
  if (!takeId) return { kind: "no-active-take", segment };
  const take = await db.get("takes", takeId);
  if (!take) return { kind: "take-missing", segment, takeId };
  return { kind: "resolved", segment, take };
}

/**
 * Resolve a segment to its active take's clip metadata.
 *
 * For callers that need the clip's id or duration but not its samples.
 */
export async function resolveSegmentAudio(
  segmentId: SegmentId
): Promise<SegmentAudio<ClipMeta>> {
  const walk = await walkToTake(segmentId);
  if (walk.kind !== "resolved") return walk;
  const clip = await getClipMeta(walk.take.clipId);
  // Both halves, not just the metadata. `putClip` and `deleteClip` each span
  // the two stores in one transaction, so a clip with metadata and no samples
  // is not reachable through this repository — but `resolved` is the word the
  // export path trusts, and a guarantee that rests on an argument rather than
  // a check is the kind this module was written to stop. The probe is a key
  // lookup, not a read.
  if (!clip || !(await clipDataExists(walk.take.clipId))) {
    return { kind: "clip-missing", segment: walk.segment, take: walk.take };
  }
  return { kind: "resolved", segment: walk.segment, take: walk.take, clip };
}

/**
 * Resolve a segment to its active take's audio, samples included.
 *
 * `getClip` requires both the metadata and the sample rows, so a clip whose
 * two halves have come apart reports `clip-missing` here rather than
 * resolving to a clip with no audio in it.
 */
export async function loadSegmentClip(
  segmentId: SegmentId
): Promise<SegmentAudio<Clip>> {
  const walk = await walkToTake(segmentId);
  if (walk.kind !== "resolved") return walk;
  const clip = await getClip(walk.take.clipId);
  if (!clip) {
    return { kind: "clip-missing", segment: walk.segment, take: walk.take };
  }
  return { kind: "resolved", segment: walk.segment, take: walk.take, clip };
}

/**
 * A description of the broken pointer, or `null` if nothing is broken.
 *
 * `no-active-take` is not a fault and does not produce one: an unrecorded
 * segment is the state every segment starts in.
 */
export function danglingReason(audio: SegmentAudio<unknown>): string | null {
  switch (audio.kind) {
    case "no-segment":
      return `segment ${audio.segmentId} is not in the database`;
    case "take-missing":
      return `segment ${audio.segment.id} names active take ${audio.takeId}, which is not in the database`;
    case "clip-missing":
      return `take ${audio.take.id} names clip ${audio.take.clipId}, whose audio is not in the database`;
    // Enumerated rather than defaulted: a sixth variant added later must fail
    // to typecheck here instead of silently reporting "no fault", which is the
    // collapse this union exists to prevent.
    case "resolved":
    case "no-active-take":
      return null;
  }
}
