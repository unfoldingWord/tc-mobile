import { useCallback, useEffect, useRef, useState } from "react";

import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { clearSegmentTake, saveTake } from "@/lib/storage/takes";
import { deleteClip, newClipId } from "@/lib/storage/clips";
import {
  discardSave,
  failSave,
  retrySave,
  startSave,
  succeedSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import { requestTranscodeSweep } from "./finish-transcode";
import { reportFailure } from "./report-failure";
import { saveFailureKind } from "./save-failure";
import type { SegmentId } from "@/types/domain";

/** Shared empty base — an edit-only save carries no newly recorded PCM. */
const NO_SAMPLES = new Int16Array(0);

/**
 * How the save orchestration below reaches back out.
 *
 * Three effects, so the orchestration itself is a plain async function that runs
 * in Node against `fake-indexeddb` — the same split `performErase` uses in
 * `use-erase-segment.ts`. `update` is React state, and the sweep starts a Web
 * Worker that does not exist outside a browser; the store write is real on both
 * sides, which is the point.
 */
interface SaveEffects {
  /**
   * Apply a transition to the held slot — the hook's `setPending`. An updater,
   * not a value, because two attempts can be in flight against one slot and
   * every transition in `lib/takes/pending-take.ts` decides from what is held.
   */
  readonly update: (
    transition: (held: PendingTake | null) => PendingTake | null
  ) => void;
  /** Fired after a commit lands, so the screen behind can reload. */
  readonly onSaved?: () => void;
  /**
   * Ask for the transcode sweep a Finished commit owes (D3). Injected rather
   * than called directly because the sweep runs the MP3 encoder in a Web
   * Worker: it is the one part of this path a Node test cannot execute, and
   * whether it is asked for at all is a decision worth covering.
   */
  readonly requestSweep: () => void;
}

/**
 * Write one attempt at a held take, and map its outcome onto the slot.
 *
 * The whole of a save attempt minus React — extracted so it is exercised in
 * Node (`tests/use-save-take.test.ts`) rather than being the untested wiring
 * between transitions that are themselves well covered. The transitions decide
 * (`lib/takes/pending-take.ts`); this decides nothing, it only sequences the
 * merge, the write, and the transition each outcome gets. Never rejects: a
 * failure becomes the held `failed` state the recovery screen renders, because
 * the caller is a tap handler where a rejection is an unhandled promise that
 * renders nothing.
 *
 * The in-flight guard stays in the hook: it is a `useRef`, and it has to be set
 * before this function is even called.
 */
export async function performSaveTake(
  take: PendingTake,
  effects: SaveEffects
): Promise<boolean> {
  try {
    // Merge HERE, inside the guarded attempt. `mergeTake` allocates a buffer
    // the size of both inputs and can throw on a low-memory device; the inputs
    // are already owned in the slot, so a merge failure becomes the recovery
    // screen (retry re-runs this) rather than a dropped take. On the B5
    // edit-only path `recorded` is empty and `mergeTake` returns `existing` (the
    // whole flattened buffer) without a copy.
    const merged = mergeTake(take.existing, take.recorded, take.offset);
    // Clip and take in ONE transaction (`saveTake`): a failure on either rolls
    // back both, so a quota-failed save leaves no orphaned clip consuming the
    // space the phone has just run out of (#38). The
    // Finished mark rides the take, applied atomically here — so a retry
    // re-applies it, and it can never be clobbered by the same write's
    // demote-to-draft the way a separate write after it would be.
    await saveTake(take.segmentId, take.clipId, merged, CANONICAL_SAMPLE_RATE, {
      finished: take.finished,
    });
  } catch (cause) {
    // The failure that produces the `SaveFailed` recovery screen — one row
    // per real failure (#456), console.error kept beside it, as
    // report-failure.ts's own contract asks. That includes a Retry that
    // fails again: each attempt is a real failure by this policy, so
    // repeated taps each write their own row rather than coalescing
    // (George R1 P3-4 — accepted as a trade, not a gap).
    console.error("Saving a take failed", cause);
    reportFailure(cause, "save-take");
    effects.update((held) =>
      failSave(held, take.clipId, saveFailureKind(cause))
    );
    return false;
  }
  // The write has committed: only `mergeTake`/`saveTake` above are the save
  // itself. Everything below is post-commit notification, so it is guarded
  // separately and always returns success — a throwing `update`, `onSaved`
  // or `requestSweep` must not be folded back into a false "save-take"
  // failure report, nor re-arm the recovery screen over a take that is
  // already durably on disk (Frank P2, PR #509 round 2 — the mirror of
  // `performErase`'s `onErased` guard).
  //
  // Each effect gets its OWN try, not one shared try around all three
  // (Frank round 2 on the same finding): a shared try means one throwing
  // effect skips every effect after it, and `onSaved` throwing must not
  // suppress `requestSweep` — a Finished take is owed a transcode request
  // (D3) whether or not the reload notification that follows succeeds.
  //
  // Cleared only here, and only for this attempt. A `finally` would drop
  // the samples on the failure path, which is the one path they exist for.
  try {
    effects.update((held) => succeedSave(held, take.clipId));
  } catch (cause) {
    console.error("Post-save notification failed", cause);
  }
  // In the same tick as clearing the slot, so there is no frame where the
  // slot is empty and the reload has not been asked for — the reload is
  // how the just-recorded row stops reading as never-recorded.
  try {
    effects.onSaved?.();
  } catch (cause) {
    console.error("Post-save notification failed", cause);
  }
  // A take saved with the Finished mark is finished PCM (D3): owed an MP3.
  // Asked for AFTER the commit and the reload, never on the failure path —
  // the sweep only ever reads what is durably on disk.
  try {
    if (take.finished) effects.requestSweep();
  } catch (cause) {
    console.error("Post-save notification failed", cause);
  }
  return true;
}

/**
 * Give up the held recording, and delete what a failed attempt left behind.
 *
 * The other half of the orchestration, extracted for the same reason:
 * `discardSave` reports which clip is orphaned but cannot delete it, and
 * nothing covered that the caller actually does. Never rejects — a discard the
 * translator confirmed must not become an unhandled promise, and the slot is
 * already empty either way.
 */
export async function performDiscardTake(
  held: PendingTake | null,
  update: SaveEffects["update"]
): Promise<void> {
  const { next, orphan } = discardSave(held);
  update(() => next);
  // Nothing references the bytes a failed attempt may already have written, so
  // leaving them would hold exactly the space the save ran out of.
  if (!orphan) return;
  try {
    await deleteClip(orphan);
  } catch (cause) {
    console.error("An unsaved clip could not be removed", cause);
  }
}

/**
 * Persist a segment cut down to silence — the store half of
 * `saveEditedSegment`'s empty-buffer branch, extracted for the same reason
 * `performSaveTake` and `performDiscardTake` are: plain-Node testability
 * against `fake-indexeddb`, rather than the hook's `useCallback` closure.
 *
 * A clear failure leaves the original take in place (no loss); it is
 * reported under `"erase-segment"`, the same context `performErase` uses for
 * the sibling erase path (#456) — a cut-to-empty close IS an erase, just
 * reached from the edit sheet rather than the overflow menu (George R1 P3-3).
 * Never rejects: the caller is a tap handler where a rejection is an
 * unhandled promise that leaves the sheet stuck.
 */
export async function performClearEditedSegment(
  segmentId: SegmentId,
  onCleared?: () => void
): Promise<boolean> {
  // Only the STORE op is fallible-and-reportable, same split as
  // `performErase`: once `clearSegmentTake` commits, the audio is
  // irreversibly gone, so the result is success no matter what the
  // notification does afterward — a throwing `onCleared` must NOT report
  // "could not clear" and invite a retry against a segment that is already
  // cleared (Frank P2, PR #509 round 2, the mirror of Frank R-B6).
  try {
    await clearSegmentTake(segmentId);
  } catch (cause) {
    // One row per real failure (#456); console.error kept beside it, as
    // report-failure.ts's own contract asks — matching `performErase`.
    console.error("Clearing an edited-to-empty segment failed", cause);
    reportFailure(cause, "erase-segment");
    return false;
  }
  // The clear has committed. A notification failure is logged, never folded
  // back into the clear result.
  try {
    onCleared?.();
  } catch (cause) {
    console.error("Post-clear notification failed", cause);
  }
  return true;
}

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
  // depend on a callback identity the caller re-creates each render. Kept
  // current in an effect, not written during render (`react-hooks/refs`) — the
  // same latest-ref shape `recorderStateRef` uses in `use-audio-session.ts`. The
  // `useRef` initialiser already holds the first render's callback, and effects
  // flush before the next tap, so no commit can read a stale one.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const commit = useCallback(async (take: PendingTake): Promise<boolean> => {
    // Synchronous, before the first await: this is what a second tap in the
    // same frame reads. `performSaveTake` runs synchronously up to its own first
    // await too, so the slot transitions keep their ordering.
    savingRef.current = true;
    try {
      return await performSaveTake(take, {
        update: setPending,
        onSaved: () => onSavedRef.current?.(),
        requestSweep: () => void requestTranscodeSweep(),
      });
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
        return performClearEditedSegment(segmentId, () =>
          onSavedRef.current?.()
        );
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
    void performDiscardTake(pending, setPending);
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
