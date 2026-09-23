/**
 * The one unsaved recording, as pure transitions over `PendingTake | null`.
 *
 * Each transition protects audio that a translator cannot record again: a
 * failure must retain the samples, a retry must reuse the `clipId`, and a
 * discard must report the orphan clip for deletion.
 *
 * The transitions are pure, DOM-free and React-free; see
 * `tests/pending-take.test.ts`. The hook owns the IndexedDB writes, the
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
 * `downgrade` and `stale` are the ones that are NOT retryable: a newer copy of
 * the app has upgraded the database past this build, or another live copy has
 * deleted the chapter/segment the held audio was supposed to save into. The
 * other two are blips — a full phone, or anything else — where the next Retry
 * can genuinely land.
 */
export type SaveFailureKind = "quota" | "downgrade" | "stale" | "unknown";

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
  /**
   * The segment's display number, for the recovery screen to name this take
   * by (#710). Captured in the same call as `segmentId` and carried with it, so
   * the number and the audio cannot come apart: the screen used to read an
   * App-level slot written on every recorder OPEN, and a second segment opened
   * while this take's first attempt was still in flight relabelled it. `null`
   * when the caller could not name the segment; the screen then says "your
   * recording" with no number rather than a wrong one.
   */
  readonly ordinal: number | null;
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
  /** The segment's display number, or `null` (see `PendingTake`). */
  readonly ordinal: number | null;
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
    ordinal: take.ordinal,
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
 * The display number a take saved from the recorder sheet is labelled with.
 *
 * The sheet's ordinal, but only when the take is for the segment the sheet is
 * open on (#710). The recorder is keyed on its segment and always saves its
 * own, so the two agree on every path that exists today; the check is what
 * makes a disagreement come out as no number instead of another segment's.
 */
export function ordinalForTake(
  sheet: {
    readonly segmentId: SegmentId | null;
    readonly ordinal: number | null;
  },
  segmentId: SegmentId
): number | null {
  return sheet.segmentId === segmentId ? sheet.ordinal : null;
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
  // `downgrade`/`stale` cannot be retried. For `downgrade`, `getDb()` fails the
  // version check before any transaction, identically, every time. For `stale`,
  // the segment/chapter id the take belongs to is gone, and Retry has no valid
  // row to write. The recovery screen offers no Retry for these kinds, so
  // nothing should reach here; this is defence in depth, and it refuses by
  // returning the slot UNCHANGED, which every caller already reads as "refused"
  // (`retryPendingTake` compares identity). Arming a save that cannot land would
  // spin the screen through "Saving" and back for as long as someone kept
  // tapping (George R2 P2-1, #378).
  if (current.kind === "downgrade" || current.kind === "stale") return current;
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
 * Here rather than inline in `App` because it is a rule about held audio,
 * not about rendering.
 *
 * The three arms:
 *
 *   pendingTake    a finished recording whose save has not landed
 *   recorderOpen   the sheet where a take is recorded, edited and committed.
 *                  Coarse on purpose: an OPEN sheet counts, not a running
 *                  capture, because capture state is not visible from `App` and
 *                  the coarse answer is wrong only in the direction that costs
 *                  the other copy a wait
 *   clipboard      audio CUT from a segment. The hole is already committed to
 *                  disk, so until the phrase lands somewhere else these samples
 *                  may be the only copy of it — the same unrecoverable loss the
 *                  close plan already treats it as. Held while the slot is
 *                  non-empty, which the chapter change that clears the slot
 *                  already bounds
 *
 * **A full slot is held work, full stop — there is deliberately no "but it has
 * been pasted" arm.** One existed for two rounds and cost two more findings, and
 * this is the reasoning that removed it. "Pasted" cannot be observed; it can
 * only be tracked, because `paste()` does not empty the slot (G3 lets one cut go
 * into several segments). Tracking it meant a flag, and the flag was wrong in
 * the losing direction every time the unchanged tree moved underneath it: set at
 * the paste, it survived an undo that wrote nothing (Frank R5 P1); set at the
 * write, it survived an erase of the segment written to (George R4 P2). Both
 * ended the same way — the guard says the phrase is safe, the connection is
 * yielded, and a restart takes the only copy. Nothing derived can be right here,
 * because what it is derived from is what keeps changing; what the slot holds
 * cannot go stale. The price is that another copy's upgrade may wait out the
 * rest of a chapter after a cut, which costs a person time — the side of this
 * trade the whole rule exists to take.
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
}): boolean {
  if (held.pendingTake !== null) return true;
  if (held.recorderOpen) return true;
  // An emptied clipboard is not held audio. `length === 0` is reachable — the
  // slot is set from a cut whose selection can be empty — and treating it as
  // held would block an upgrade over nothing.
  return (held.clipboard?.length ?? 0) > 0;
}

/**
 * Whether taking the screen with `DatabasePanel` would DESTROY held audio — a
 * different question from `holdsUnsavedAudio` above, with a different answer.
 *
 * One predicate used to answer both, and the clipboard is the arm where the two
 * answers differ (George R4 P1). Yielding the connection is what loses a cut
 * phrase, so the clipboard belongs in the yield decision. The panel does not
 * lose it — the slot is `App` state and outlives the screen — so it does not
 * belong here, and putting it here is what caused the loss:
 *
 *   1. the panel is withheld while the slot is full;
 *   2. so `popAction` returns no `trap-database-panel` (it traps only when the
 *      panel is actually up), and a Back is an ordinary `to-books`;
 *   3. the app is `blocked` or `reloadNeeded`, so a chapter load fails and
 *      `SegmentsScreen` offers its documented recovery — back out and re-enter;
 *   4. `backToBooks` runs `setClipboard(null)`, chapter-scoped by design (G3);
 *   5. and the panel that would have said "close the other copy" appears only
 *      after the slot it was protecting has been emptied.
 *
 * So the panel now shows, the Back is trapped, and the slot survives. The two
 * arms left are the ones the panel really does destroy: the recorder sheet,
 * which the panel unmounts and `leave()` cancels the capture of, and a pending
 * take — which never reaches this question anyway, because `SaveFailed` outranks
 * the panel and returns first. It is listed rather than relied upon, so that the
 * ordering in `App` is a second line of defence and not the only one.
 *
 * NOT a re-derivation of the above with one arm dropped: these are two rules
 * that happen to share arms, and a future arm belongs to whichever of them is
 * true of it.
 */
export function panelWouldLoseAudio(held: {
  readonly pendingTake: PendingTake | null;
  readonly recorderOpen: boolean;
}): boolean {
  return held.pendingTake !== null || held.recorderOpen;
}
