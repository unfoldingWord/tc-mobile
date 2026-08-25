import { useCallback, useRef, useState } from "react";

import { insertAt } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addTake } from "@/lib/storage/books";
import { deleteClip, newClipId, putClip } from "@/lib/storage/clips";
import { loadSegmentClip } from "@/lib/storage/segment-audio";
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
      const meta = await putClip(
        take.clipId,
        take.samples,
        CANONICAL_SAMPLE_RATE
      );
      await addTake(take.segmentId, take.clipId, meta.durationMs);
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
   * Persist finished PCM against a segment. Never rejects — a failure becomes
   * visible state — because the caller is a tap handler, where a rejection is
   * an unhandled promise that renders nothing.
   *
   * `addTake` REPLACES the segment's take (1:1), so `samples` must be the whole
   * segment's audio, not a fragment. `saveRecording` below is what produces
   * that whole buffer from an insert/append; a caller that already holds the
   * complete buffer can use this directly.
   */
  const saveTake = useCallback(
    async (segmentId: SegmentId, samples: Int16Array): Promise<boolean> => {
      const take = startSave(pending, {
        segmentId,
        // Minted here, not per attempt: IndexedDB `put` is an upsert, so a
        // retry with the same id overwrites the bytes a failed attempt may
        // already have written instead of spending the space twice.
        clipId: newClipId(),
        samples,
      });
      // Identity means refused: a recording is already held, and displacing it
      // is the silent loss all of this exists to prevent. The screens disable
      // recording while a take is held, so reaching this is an invariant break
      // — logged rather than passed over quietly.
      if (take === pending) {
        console.error(
          "A finished take was refused: one is already held",
          pending.clipId
        );
        return false;
      }
      // Before the first await, so there is never a moment when the only
      // reference to a finished take is a local inside a function that can
      // throw.
      setPending(take);
      return commit(take);
    },
    [commit, pending]
  );

  /**
   * Commit a recording as an insert/append into the segment's existing audio.
   *
   * This is the record-at-centerline path (B4). The sample math is one pure
   * call — `insertAt(existing, recorded, offset)` from `lib/audio/edit.ts`,
   * where `offset` is the sample under the centerline: mid-clip inserts,
   * at/after the end appends, and an empty segment splices into an empty
   * buffer. The offset is clamped inside `insertAt`, so an out-of-range pan is
   * an append rather than a throw.
   *
   * The whole merged buffer becomes the segment's one take (1:1) — reading the
   * existing samples here rather than in a component keeps the splice, and the
   * PCM it touches, out of the DOM layer entirely.
   */
  const saveRecording = useCallback(
    async (
      segmentId: SegmentId,
      recorded: Int16Array,
      insertionOffset: number
    ): Promise<boolean> => {
      const existing = await loadSegmentClip(segmentId);
      const base =
        existing.kind === "resolved"
          ? existing.clip.samples
          : new Int16Array(0);
      const merged = insertAt(base, recorded, insertionOffset);
      return saveTake(segmentId, merged);
    },
    [saveTake]
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
    saveTake,
    saveRecording,
    retryPendingTake,
    discardPendingTake,
  };
}

export type { PendingTake };
