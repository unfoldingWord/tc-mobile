/**
 * The one unsaved recording, as pure transitions over `PendingTake | null`.
 *
 * Everything here used to live inline in `useObsChapter`, where it could not be
 * tested: this project has no renderer (`vitest.config.ts` sets
 * `environment: "node"`, and there is no jsdom or testing-library in
 * `package.json`), so nothing can drive a React hook. That mattered more here
 * than anywhere else in the app, because each of these transitions is a way to
 * lose audio that a translator cannot record again — a `finally` on the failure
 * path, a retry that mints a second `clipId`, a discard that leaves the bytes
 * behind on a phone that has just run out of room.
 *
 * So the transitions were lifted out, by the same move already used for
 * `lib/audio/session.ts` and `hooks/save-failure.ts`: pure, DOM-free, React-
 * free, and covered in plain Node — see `tests/pending-take.test.ts`. The hook
 * keeps only the parts that are genuinely effects: the IndexedDB writes, the
 * `useState` slot, and the orphan delete.
 *
 * Two conventions run through the module:
 *
 *   - A refused transition returns the state it was given, by identity. Callers
 *     test `next !== current` rather than inspecting fields.
 *   - `fail` and `succeed` take the `clipId` of the attempt they belong to and
 *     do nothing unless it matches what is held, so a write that resolves after
 *     its take was discarded (or replaced) cannot resurrect or clobber the slot.
 */

import type { ClipId, SegmentId } from "@/types/domain";

/**
 * Why a save failed, in the one word the recovery screen needs.
 *
 * Defined here rather than in `hooks/save-failure.ts` because it is a field of
 * the state below, and `lib/` may not import from `hooks/`. The classifier that
 * produces it stays in `hooks/save-failure.ts` and re-exports this type, so
 * there is still only one definition.
 */
export type SaveFailureKind = "quota" | "unknown";

/**
 * A finished recording that is not on disk yet.
 *
 * The whole point of this shape is the `samples` field. Before it existed the
 * only reference to a take's PCM was a local in the function that was saving
 * it, so a rejected write unwound the stack and the recording was gone — no
 * message, and a section still showing "not recorded". Nothing else on the
 * device has that property: audio a translator captured in the field cannot be
 * recreated.
 */
export interface PendingTake {
  /** Captured when the recording stopped, never re-derived from what is on screen. */
  readonly segmentId: SegmentId;
  /** Minted once per recording, so a retry overwrites rather than duplicates. */
  readonly clipId: ClipId;
  readonly samples: Int16Array;
  readonly state: "saving" | "failed";
  readonly kind: SaveFailureKind | null;
  /** Failures so far. Zero means the first attempt is still in flight. */
  readonly attempts: number;
}

/** What a caller has to supply to open the slot: the audio and where it belongs. */
export interface NewTake {
  readonly segmentId: SegmentId;
  readonly clipId: ClipId;
  readonly samples: Int16Array;
}

/**
 * Take hold of a finished recording.
 *
 * Refused — the held take is returned unchanged — while anything is already in
 * the slot. One slot, not a queue: a second take would displace the first and
 * put the silent loss straight back, and the PCM is roughly 5.3 MB a minute on
 * a device that has just run out of room.
 */
export function startSave(
  current: PendingTake | null,
  take: NewTake
): PendingTake {
  if (current) return current;
  return {
    segmentId: take.segmentId,
    clipId: take.clipId,
    samples: take.samples,
    state: "saving",
    kind: null,
    attempts: 0,
  };
}

/**
 * Record that the attempt for `clipId` failed.
 *
 * The samples are carried through untouched. This is the transition a `finally`
 * would break: the failure path is the only path the held audio exists for.
 */
export function failSave(
  current: PendingTake | null,
  clipId: ClipId,
  kind: SaveFailureKind
): PendingTake | null {
  if (!current || current.clipId !== clipId) return current;
  return { ...current, state: "failed", kind, attempts: current.attempts + 1 };
}

/**
 * Arm another attempt at the held take.
 *
 * Refused while a save is already in flight, so a second tap on Retry cannot
 * start a second concurrent write against the same clip. The `clipId` is
 * reused: IndexedDB `put` is an upsert, so retrying with the same id overwrites
 * whatever a failed attempt already wrote instead of spending the space twice.
 */
export function retrySave(current: PendingTake | null): PendingTake | null {
  if (!current || current.state === "saving") return current;
  return { ...current, state: "saving", kind: null };
}

/** Empty the slot, but only for the attempt that actually succeeded. */
export function succeedSave(
  current: PendingTake | null,
  clipId: ClipId
): PendingTake | null {
  if (!current || current.clipId !== clipId) return current;
  return null;
}

/**
 * Deliberate, confirmed loss of the held recording.
 *
 * `orphan` is the clip the caller now has to delete: a failed attempt may have
 * written the samples before the take row failed, and nothing references them
 * once the slot is empty, so leaving them would hold exactly the space the save
 * just ran out of. It is `null` when there was nothing to discard, so a caller
 * cannot be told to delete a clip that is still in use.
 */
export function discardSave(current: PendingTake | null): {
  readonly next: null;
  readonly orphan: ClipId | null;
} {
  return { next: null, orphan: current?.clipId ?? null };
}
