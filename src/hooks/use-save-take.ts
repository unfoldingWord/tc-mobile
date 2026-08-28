import { useCallback, useRef, useState } from "react";

import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { clearSegmentTake, saveTake } from "@/lib/storage/books";
import { deleteClip, newClipId } from "@/lib/storage/clips";
import {
  discardSave,
  failSave,
  retrySave,
  startSave,
  succeedSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import { saveFailureKind } from "./save-failure";
import type { SegmentId } from "@/types/domain";

/** Shared empty base — an edit-only save carries no newly recorded PCM. */
const NO_SAMPLES = new Int16Array(0);

/**
 * The one unsaved recording the app is holding, and its save/retry/discard.
 *
 * Lifted verbatim out of the deleted `useObsChapter`: the machinery never
 * depended on the OBS model — it keys on `SegmentId` and holds raw PCM — so the
 * pivot re-homes it unchanged rather than rewriting it. The property it exists
 * to protect is unchanged too: a finished recording that fails to save survives
 * as visible state (the `save-failed` recovery screen), never as a rejected
 * promise that drops the only copy of audio a translator cannot record again.
 *
 * Mount it once, high enough that it outlives opening and closing the recorder
 * — the same place `App` mounted `useObsChapter`. The slot has to survive the
 * sheet that produced the take being torn down, or the recovery screen has
 * nothing to render.
 *
 * `onSaved` fires after a successful commit (first attempt or a retry) so the
 * screen showing the segment can reload — the row still reads as unrecorded
 * until it does, which is the window a second take would be lost in.
 */
export function useSaveTake(options: { onSaved?: () => void } = {}) {
  const { onSaved } = options;
  const [pending, setPending] = useState<PendingTake | null>(null);
  /**
   * Whether a write is in flight, readable synchronously.
   *
   * `retrySave` refuses a second concurrent attempt, but it can only judge the
   * slot it is handed, and the hook reads that from the render closure. Two
   * taps on Retry in one frame both saw `failed`, both produced a fresh
   * `saving`, and both committed. A ref answers for the current moment rather
   * than the last render.
   */
  const savingRef = useRef(false);
  // The latest `onSaved`, read from the commit closure without making `commit`
  // depend on a callback identity the caller re-creates each render.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const commit = useCallback(async (take: PendingTake): Promise<boolean> => {
    // Synchronous, before the first await: this is what a second tap in the
    // same frame reads.
    savingRef.current = true;
    try {
      // Merge HERE, inside the guarded attempt. `mergeTake` allocates a buffer
      // the size of both inputs and can throw on a low-memory device; the inputs
      // are already owned in the slot, so a merge failure becomes the recovery
      // screen (retry re-runs this) rather than a dropped take. On the B5
      // edit-only path `recorded` is empty and `mergeTake` returns `existing` (the
      // whole flattened buffer) without a copy.
      const merged = mergeTake(take.existing, take.recorded, take.offset);
      // Clip and take in ONE transaction (`saveTake`): a failure on either rolls
      // back both, so a quota-failed save leaves no orphaned clip eating the
      // space the recovery screen tells the translator to free (#38). The
      // Finished mark rides the take, applied atomically here — so a retry
      // re-applies it, and it can never be clobbered by the same write's
      // demote-to-draft the way a separate write after it would be.
      await saveTake(
        take.segmentId,
        take.clipId,
        merged,
        CANONICAL_SAMPLE_RATE,
        {
          finished: take.finished,
        }
      );
      // Cleared only here, and only for this attempt. A `finally` would drop
      // the samples on the failure path, which is the one path they exist for.
      setPending((held) => succeedSave(held, take.clipId));
      // In the same tick as clearing the slot, so there is no frame where the
      // slot is empty and the reload has not been asked for — the reload is
      // how the just-recorded row stops reading as never-recorded.
      onSavedRef.current?.();
      return true;
    } catch (cause) {
      console.error("Saving a take failed", cause);
      setPending((held) => failSave(held, take.clipId, saveFailureKind(cause)));
      return false;
    } finally {
      // Safe in a `finally` where `setPending(null)` is not: this releases a
      // guard rather than dropping the samples, and a guard left set would lock
      // out the retry the failure path exists to offer.
      savingRef.current = false;
    }
  }, []);

  /**
   * Persist a recording as an insert/append into the segment's existing audio.
   *
   * The record-at-centerline path (B4). Never rejects — a failure becomes the
   * recovery screen — because the caller is a tap handler where a rejection is
   * an unhandled promise that renders nothing.
   *
   * The recipe is owned in the slot BEFORE anything fallible: `existing` (the
   * segment's current audio, read by the recorder at mount — never read here,
   * where a rejected read after the recording exists would drop it), `recorded`,
   * and the splice `offset`. `commit` does the merge and the write; `saveTake`
   * REPLACES the segment's take (1:1) in one transaction, so the merged buffer is
   * the whole segment's audio. A merge or write failure lands in the recovery
   * screen, and retry re-runs `commit` — never a save of the raw fragment, which
   * under 1:1 would delete the original clip.
   */
  const saveRecording = useCallback(
    (
      segmentId: SegmentId,
      existing: Int16Array,
      recorded: Int16Array,
      insertionOffset: number,
      finished: boolean,
      // Set by the edit-only path below; a fresh recording leaves it false. Only
      // the recovery screen's wording depends on it — the save itself is identical.
      editOnly = false
    ): Promise<boolean> => {
      const take = startSave(pending, {
        segmentId,
        // Minted here, not per attempt: IndexedDB `put` is an upsert, so a
        // retry with the same id overwrites the bytes a failed attempt may
        // already have written instead of spending the space twice.
        clipId: newClipId(),
        existing,
        recorded,
        offset: insertionOffset,
        finished,
        editOnly,
      });
      // Identity means refused: a recording is already held, and displacing it
      // is the silent loss all of this exists to prevent. The screens disable
      // recording while a take is held, so reaching this is an invariant break.
      if (take === pending) {
        console.error(
          "A finished take was refused: one is already held",
          pending.clipId
        );
        return Promise.resolve(false);
      }
      // Before any await AND before the fallible merge, so the only reference to
      // the recording is never a local in a function that can throw.
      setPending(take);
      return commit(take);
    },
    [commit, pending]
  );

  /**
   * Persist an already-flattened, edited segment buffer (B5).
   *
   * A cut/paste session produces the whole new segment audio in memory; there is
   * no fresh recording to splice. So this reuses the exact record path with an
   * empty `recorded` and offset 0 — `commit` skips the merge and `saveTake`s the
   * buffer as-is — which means the never-lose recovery machinery (the owned slot,
   * the retry, the recovery screen on a failed write) is shared verbatim rather
   * than reimplemented. `saveTake`'s 1:1 replace makes this buffer the segment's
   * audio, and its single transaction keeps the prior clip intact until the new
   * one is written — and rolls the new clip back on a failed write — so a failed
   * edit-save leaves the original recoverable.
   *
   * An EMPTY buffer is a cut down to nothing, not a recording: persisting a
   * 0-frame take would fabricate a recorded state (a resolved clip that plays
   * silence and can be counted finished). It routes to `clearSegmentTake`
   * instead, returning the segment to never-recorded — the removed audio is in
   * the clipboard, so this is a deliberate erase, not the silent loss the slot
   * exists to prevent, and it does not need the slot. A clear failure leaves the
   * original take in place (no loss); it is reported, not sent to the recovery
   * screen, whose copy and retry are about a recording that could not be saved.
   */
  const saveEditedSegment = useCallback(
    (
      segmentId: SegmentId,
      buffer: Int16Array,
      finished: boolean
    ): Promise<boolean> => {
      if (buffer.length === 0) {
        return clearSegmentTake(segmentId)
          .then(() => {
            onSavedRef.current?.();
            return true;
          })
          .catch((cause: unknown) => {
            console.error("Clearing an edited-to-empty segment failed", cause);
            return false;
          });
      }
      return saveRecording(segmentId, buffer, NO_SAMPLES, 0, finished, true);
    },
    [saveRecording]
  );

  const retryPendingTake = useCallback(() => {
    // The live guard, ahead of the pure one: `pending` here is last render's
    // slot, and `SaveFailed` only hides Retry once the saving re-render lands.
    if (savingRef.current) return;
    const next = retrySave(pending);
    // Identity means refused: nothing held, or a save already in flight.
    if (!next || next === pending) return;
    setPending(next);
    void commit(next);
  }, [commit, pending]);

  /** Deliberate, confirmed loss of the held recording. */
  const discardPendingTake = useCallback(() => {
    // The same live guard Retry takes, and for the same window: between a Retry
    // tap and its re-render the armed Delete is still on screen and still live.
    // Discarding there races the write Retry just started — the clip deleted
    // out from under a take `addTake` has already made active, or the write
    // landing after the discard so a recording the translator confirmed
    // deleting comes back. Both are the silent loss this slot exists to prevent.
    if (savingRef.current) return;
    const { next, orphan } = discardSave(pending);
    setPending(next);
    // Nothing references the bytes a failed attempt may already have written,
    // so leaving them would hold exactly the space the save ran out of.
    if (orphan) {
      void deleteClip(orphan).catch((cause: unknown) => {
        console.error("An unsaved clip could not be removed", cause);
      });
    }
  }, [pending]);

  return {
    pendingTake: pending,
    saveRecording,
    saveEditedSegment,
    retryPendingTake,
    discardPendingTake,
  };
}

export type { PendingTake };
