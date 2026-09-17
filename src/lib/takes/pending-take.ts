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
 *
 * `downgrade` is the one that is NOT retryable: a newer copy of the app has
 * upgraded the database past this build, so `getDb()` fails the version check
 * before any transaction is reached and will do so on every attempt. The other
 * two are blips — a full phone, or anything else — where the next Retry can
 * genuinely land.
 */
export type SaveFailureKind = "quota" | "downgrade" | "unknown";

/**
 * A finished recording that is not on disk yet.
 *
 * The point of this shape is that it OWNS the audio before anything fallible
 * runs. Before it existed the only reference to a take's PCM was a local in the
 * function saving it, so a rejected write unwound the stack and the recording
 * was gone — no message, a segment still showing "not recorded". Nothing else
 * on the device has that property: field audio cannot be recreated.
 *
 * The audio is held as its MERGE RECIPE — the existing segment PCM, the newly
 * recorded PCM, and the splice offset — not a pre-merged buffer. The merge
 * itself allocates a buffer the size of both inputs and can throw on a
 * low-memory device, so it is deferred to the write attempt (`commit`): a merge
 * failure lands the take in the recovery screen for retry, exactly like a failed
 * write, instead of dropping it before the slot owns anything.
 */
export interface PendingTake {
  /** Captured when the recording stopped, never re-derived from what is on screen. */
  readonly segmentId: SegmentId;
  /** Minted once per recording, so a retry overwrites rather than duplicates. */
  readonly clipId: ClipId;
  /** Existing segment audio the recording splices into (empty on a first take). */
  readonly existing: Int16Array;
  /** The newly captured PCM. */
  readonly recorded: Int16Array;
  /** Sample offset under the centerline: mid-clip inserts, at/after end appends. */
  readonly offset: number;
  /**
   * The explicit Finished mark for this take. Carried through every transition
   * so the commit — first attempt or a retry — applies it atomically with the
   * take (`addTake`), rather than a separate write the recovery path never
   * reaches. False is the default a plain recording lands in.
   */
  readonly finished: boolean;
  /**
   * Whether this save came from an edit-only close (B5), where `recorded` is
   * empty and the whole flattened buffer is in `existing`, versus a fresh
   * recording. The recovery screen reads it to word itself honestly: discarding
   * a failed edit-save drops the edited buffer while the previously stored take
   * survives, so "delete this recording for good" is only true of a recording.
   */
  readonly editOnly: boolean;
  readonly state: "saving" | "failed";
  readonly kind: SaveFailureKind | null;
  /** Failures so far. Zero means the first attempt is still in flight. */
  readonly attempts: number;
}

/** What a caller has to supply to open the slot: the audio recipe and where it belongs. */
export interface NewTake {
  readonly segmentId: SegmentId;
  readonly clipId: ClipId;
  readonly existing: Int16Array;
  readonly recorded: Int16Array;
  readonly offset: number;
  /** Whether the translator marked this take Finished (see `PendingTake`). */
  readonly finished: boolean;
  /** Whether this is an edit-only save rather than a recording (see `PendingTake`). */
  readonly editOnly: boolean;
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
    existing: take.existing,
    recorded: take.recorded,
    offset: take.offset,
    finished: take.finished,
    editOnly: take.editOnly,
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
  // A `downgrade` cannot be retried — `getDb()` fails the version check before
  // any transaction, identically, every time. The recovery screen offers a
  // restart instead of Retry for this kind, so nothing should reach here; this
  // is defence in depth, and it refuses by returning the slot UNCHANGED, which
  // every caller already reads as "refused" (`retryPendingTake` compares
  // identity). Arming a save that cannot land would spin the screen through
  // "Saving" and back for as long as someone kept tapping (George R2 P2-1).
  if (current.kind === "downgrade") return current;
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

/**
 * Everything this copy of the app is holding that exists ONLY in memory, and
 * that closing the database connection would therefore destroy.
 *
 * This is the guard behind the multi-tab upgrade decision (#221): when another
 * copy wants to upgrade the database, this copy refuses to give up its
 * connection while any of these is true, and the other copy waits. The trade is
 * deliberate and one-directional — refusing costs a person time, yielding costs
 * a translator audio that cannot be recorded again.
 *
 * Here rather than inline in `App` because it is a rule about held audio, not
 * about rendering, and because this repo has no renderer: inline in a component
 * it could only ever be review surface, and the one arm that was missing
 * (the clipboard) is exactly the kind of omission a test catches.
 *
 * The three arms:
 *
 *   pendingTake    a finished recording whose save has not landed
 *   recorderOpen   the sheet where a take is recorded, edited and committed.
 *                  Coarse on purpose: an OPEN sheet counts, not a running
 *                  capture, because capture state is not visible from `App` and
 *                  the coarse answer is wrong only in the direction that costs
 *                  the other copy a wait
 *   clipboard      audio CUT from a segment and NOT YET PASTED. The hole is
 *                  already committed to disk, so until it lands somewhere these
 *                  samples are the only copy left of that phrase — the same
 *                  unrecoverable loss the close plan already treats it as.
 *                  `clipboardPasted` is what makes "not yet pasted" real: the
 *                  slot is deliberately not emptied on paste (G3 lets one cut
 *                  go into several segments), so a full clipboard says nothing
 *                  on its own about whether the phrase exists anywhere else,
 *                  and holding an upgrade on it would wait out the rest of the
 *                  chapter (George R3 P2-1)
 *
 * What is deliberately NOT held work: a name being typed, and an armed share.
 * Both are re-doable in seconds from what is still on disk, and holding another
 * copy's upgrade for work that costs a retype is the trade this rule exists to
 * refuse in the other direction.
 */
export function holdsUnsavedAudio(held: {
  readonly pendingTake: PendingTake | null;
  readonly recorderOpen: boolean;
  readonly clipboard: Int16Array | null;
  /** Whether the clip in that slot has since been pasted somewhere. */
  readonly clipboardPasted: boolean;
}): boolean {
  if (held.pendingTake !== null) return true;
  if (held.recorderOpen) return true;
  // Pasted: the phrase is in a segment's edit history now, so this slot is a
  // convenience for pasting it again, not the last copy of anything.
  if (held.clipboardPasted) return false;
  // An emptied clipboard is not held audio. `length === 0` is reachable — the
  // slot is set from a cut whose selection can be empty — and treating it as
  // held would block an upgrade over nothing.
  return (held.clipboard?.length ?? 0) > 0;
}
