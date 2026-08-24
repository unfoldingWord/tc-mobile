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

import { getDb } from "./db";
import type { Clip, ClipMeta } from "@/types/audio";
import type { Segment, SegmentId, Take, TakeId } from "@/types/domain";

/**
 * Every store the walk touches, read in one transaction.
 *
 * Reading them one at a time was four separate snapshots: a take could be
 * switched, or a clip written or deleted, between the segment read and the
 * clip read — and the result would describe a database state that never
 * existed. A function whose whole purpose is to give one authoritative answer
 * cannot be assembled from four unsynchronised reads.
 */
const WALK_STORES = ["segments", "takes", "clipMeta", "clipData"] as const;

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
 * The whole walk, inside one readonly transaction.
 *
 * `withSamples` decides how much of the clip is read: a caller asking whether
 * a chapter exports completely wants a key probe, not megabytes of PCM.
 *
 * The `await`s here are sequential because the walk is: the take id comes out
 * of the segment row. That is safe and is idb's own documented pattern — an
 * IDB transaction stays alive across awaits on IDB requests and closes only
 * when a turn passes with nothing queued, which is why awaiting a *non*-IDB
 * promise (a fetch, a timer) inside a transaction is the thing that breaks it.
 * Do not "fix" this into `Promise.all`: the reads are dependent, and the
 * sibling reads in `clips.ts` are parallel because they are independent, not
 * because sequential is forbidden.
 */
async function walk<C>(
  segmentId: SegmentId,
  withSamples: boolean
): Promise<SegmentAudio<C>> {
  const db = await getDb();
  const tx = db.transaction(WALK_STORES, "readonly");

  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) {
    await tx.done;
    return { kind: "no-segment", segmentId };
  }
  const takeId = segment.activeTakeId;
  if (!takeId) {
    await tx.done;
    return { kind: "no-active-take", segment };
  }
  const take = await tx.objectStore("takes").get(takeId);
  if (!take) {
    await tx.done;
    return { kind: "take-missing", segment, takeId };
  }

  const meta = await tx.objectStore("clipMeta").get(take.clipId);
  const data = withSamples
    ? await tx.objectStore("clipData").get(take.clipId)
    : await tx.objectStore("clipData").getKey(take.clipId);
  await tx.done;

  // Both halves, always. `putClip` and `deleteClip` each span the two stores
  // in one transaction, so metadata standing without samples is not reachable
  // through this repository — but `resolved` is the word the export path
  // trusts, and a guarantee resting on an argument rather than a check is the
  // kind this module exists to stop.
  if (!meta || data === undefined) {
    return { kind: "clip-missing", segment, take };
  }
  const clip = (
    withSamples ? { meta, samples: new Int16Array(data as ArrayBuffer) } : meta
  ) as C;
  return { kind: "resolved", segment, take, clip };
}

/**
 * Resolve a segment to its active take's clip metadata.
 *
 * For callers that need the clip's id or duration but not its samples.
 */
export async function resolveSegmentAudio(
  segmentId: SegmentId
): Promise<SegmentAudio<ClipMeta>> {
  return walk<ClipMeta>(segmentId, false);
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
  return walk<Clip>(segmentId, true);
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
