import { useCallback, useEffect, useRef, useState } from "react";

import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  clearSegmentTake,
  saveReplayedTake,
  saveTake,
  settlePendingTake,
  type ReplayResult,
} from "@/lib/storage/takes";
import { isMissingSegmentFailure } from "@/lib/storage/stale-target";
import { newClipId } from "@/lib/storage/clips";
import { writePendingTake } from "@/lib/storage/pending-takes";
import {
  discardSave,
  failSave,
  retrySave,
  startSave,
  succeedSave,
  type NewTake,
  type PendingTake,
} from "@/lib/takes/pending-take";
import { requestTranscodeSweep } from "./finish-transcode";
import { withObservedRevision } from "./observed-revision";
import {
  notSaved,
  replayPendingTakes,
  type ReplayTake,
} from "./replay-pending-takes";
import { reportFailure } from "./report-failure";
import { saveFailureKind } from "./save-failure";
import type { ClipId, SegmentId } from "@/types/domain";

/** Shared empty base — an edit-only save carries no newly recorded PCM. */
const NO_SAMPLES = new Int16Array(0);

/**
 * Takes this copy has been asked to discard, by `clipId`, set in the same turn
 * as the confirmed tap (v13, #38). The hold and the commit read it inside
 * their own transactions, so a write already queued when the tap lands still
 * writes nothing for the take (docs/design/pending-take-lifecycle.md, §3). An
 * entry goes once the Discard's settle has committed its `discarded` record,
 * which then speaks for every copy.
 */
const discardRequested = new Set<ClipId>();
const isDiscardRequested = (clipId: ClipId): boolean =>
  discardRequested.has(clipId);

/**
 * Takes the launch replay installed in the slot, by `clipId` (#38 rebuild PR
 * 3). Every attempt at one, its Retries included, is the conditional commit
 * (`saveReplayedTake`), never the ordinary `saveTake`, and none of them
 * holds: its row is already on disk, or was ended on purpose, and a hold
 * could put back a row another copy removed, which the verdict would then
 * read as this take's own and save. An entry goes when the slot lets go of
 * the take.
 */
const replayed = new Set<ClipId>();

/**
 * Report a pending-take store result that came back as a failure (#38).
 *
 * The store never rejects; it hands a failure back as a value, because
 * `lib/` cannot reach the failure log. Losing this row costs only the
 * kill-and-relaunch safety net, never the save, so it is reported and nothing
 * else changes.
 */
function reportPendingResult(
  context: "pending-take-write" | "pending-take-delete"
): (result: { readonly ok: boolean; readonly cause?: unknown }) => void {
  return (result) => {
    if (result.ok) return;
    console.error(`Pending take store failed (${context})`, result.cause);
    reportFailure(result.cause, context);
  };
}

/**
 * Hold the take on disk so a kill before its save lands does not lose it
 * (#38). Started, never awaited by this hook. That is not the same as the
 * save never waiting: the hold's transaction and the commit's share stores
 * (`segments`, `takes`, `clipMeta`, `clipData`, `pendingTakes`,
 * `takeDispositions`), and the hold's is opened first, so IndexedDB queues
 * the commit behind it, the hold's `clipData` read and row put included
 * (docs/design/pending-take-lifecycle.md, §3 "Ordering against the clip
 * write"). What the hook guarantees is only that a hold which fails, or whose
 * promise never settles, does not fail or hold the save itself.
 * The hold writes nothing for a take that is saved, given up for quota,
 * discarded, or being discarded in this copy, so a Retry after a quota
 * failure does not write the row again. A segment held by another take's row
 * leaves this take without a safety copy, and that is reported under
 * `"pending-take-write"`: "could not keep a safety copy" is then literally
 * true.
 */
function holdPendingTake(take: PendingTake): void {
  void writePendingTake(take, { isDiscardRequested }).then((result) => {
    if (result.ok && result.outcome === "kept-foreign") {
      reportPendingResult("pending-take-write")({
        ok: false,
        cause: new Error("Another take's pending row holds this segment"),
      });
      return;
    }
    reportPendingResult("pending-take-write")(result);
  });
}

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
   * Apply a transition to the held slot — the hook's `writeSlot`. An updater,
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
  if (replayed.has(take.clipId)) return commitReplayed(take, effects);
  // First, before the merge and the commit, and not awaited (see
  // `holdPendingTake`): the row is the only copy that outlives this page.
  holdPendingTake(take);
  let outcome: Awaited<ReturnType<typeof saveTake>>["outcome"];
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
    // The commit also deletes this take's row and records it saved, in its
    // own transaction (v13). It writes nothing for a take discarded here or
    // in another copy, or already saved by another copy.
    ({ outcome } = await saveTake(
      take.segmentId,
      take.clipId,
      merged,
      CANONICAL_SAMPLE_RATE,
      // The generation of the audio the recorder loaded, not the replaced
      // clip's, which a transcode under the open sheet may have moved
      // (#163 A-14); `null` keeps the re-read.
      {
        finished: take.finished,
        isDiscardRequested,
        baseGeneration: take.baseGeneration,
      }
    ));
  } catch (cause) {
    // The failure that produces the `SaveFailed` recovery screen — one row
    // per real failure (#456), console.error kept beside it, as
    // report-failure.ts's own contract asks. That includes a Retry that
    // fails again: each attempt is a real failure by this policy, so
    // repeated taps each write their own row rather than coalescing
    // (George R1 P3-4 — accepted as a trade, not a gap).
    console.error("Saving a take failed", cause);
    reportFailure(cause, "save-take");
    const kind = saveFailureKind(cause);
    // Before the failure state is shown: on a quota failure the pending row
    // may be what used the space, so it is given up (deleted, with a
    // `given-up` record the next hold reads), and Retry does not rewrite it.
    // Any other failure keeps the row for a relaunch to find.
    if (kind === "quota") {
      void settlePendingTake(take.segmentId, take.clipId, "give-up").then(
        reportPendingResult("pending-take-delete")
      );
    }
    effects.update((held) => failSave(held, take.clipId, kind));
    return false;
  }
  if (outcome === "discarded") {
    // Nothing was written: the take was discarded, here or in another copy.
    // The slot lets go of it, and the refusal is logged once.
    const cause = new Error("A discarded take was not saved");
    console.error("Saving a take was refused", cause);
    reportFailure(cause, "pending-take-refused");
    effects.update((held) => succeedSave(held, take.clipId));
    return true;
  }
  // `already-saved` lands here too: another copy saved this very take.
  return landed(take, effects);
}

/**
 * After a commit that landed: free the slot, reload, ask for the sweep.
 *
 * The write has committed: only the merge and the commit before this are the
 * save itself. Everything here is post-commit notification, so it is guarded
 * separately and always returns success — a throwing `update`, `onSaved`
 * or `requestSweep` must not be folded back into a false "save-take"
 * failure report, nor re-arm the recovery screen over a take that is
 * already durably on disk (Frank P2, PR #509 round 2 — the mirror of
 * `performErase`'s `onErased` guard).
 */
function landed(take: PendingTake, effects: SaveEffects): true {
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
 * One attempt at a take the launch replay installed: the conditional commit,
 * and what its outcome does to the slot (docs/design/pending-take-lifecycle.md
 * §4, "What each verdict does"). Never rejects.
 *
 *   - `saved`, `already-saved`: landed, as an ordinary save (#1557: a take
 *     another copy finished frees the slot with nothing written);
 *   - `discarded`, `kept`, and `gone` on the first attempt: nothing saved
 *     over the segment, the take is ended or on disk as a marked row, so the
 *     slot lets it go; logged once under `"pending-take-refused"`;
 *   - `held`: still only in the slot, failed `unknown` (the recovery screen;
 *     Retry runs the verdict again and never falls through to a save);
 *   - `gone` on a Retry: failed `stale`, as a missing segment is elsewhere.
 *
 * A failed write keeps the take held and its row on disk: a replayed take
 * gives nothing up on quota until PR 4 adds the screen that needs (§3).
 */
async function commitReplayed(
  take: PendingTake,
  effects: SaveEffects
): Promise<boolean> {
  let result: ReplayResult;
  try {
    const { baseRevision } = take;
    if (baseRevision === null) throw notSaved("legacy");
    const merged = mergeTake(take.existing, take.recorded, take.offset);
    result = await saveReplayedTake(
      { ...take, baseRevision },
      merged,
      CANONICAL_SAMPLE_RATE,
      { isDiscardRequested }
    );
  } catch (cause) {
    console.error("Saving a take failed", cause);
    reportFailure(cause, "save-take");
    effects.update((held) =>
      failSave(held, take.clipId, saveFailureKind(cause))
    );
    return false;
  }
  const { outcome } = result;
  if (outcome === "saved" || outcome === "already-saved") {
    replayed.delete(take.clipId);
    return landed(take, effects);
  }
  const cause = notSaved("verdict" in result ? result.verdict : outcome);
  console.error("Saving a take was refused", cause);
  reportFailure(cause, "pending-take-refused");
  if (outcome === "held" || (outcome === "gone" && take.attempts > 0)) {
    const kind = outcome === "gone" ? "stale" : "unknown";
    effects.update((held) => failSave(held, take.clipId, kind));
    return false;
  }
  replayed.delete(take.clipId);
  effects.update((held) => succeedSave(held, take.clipId));
  return true;
}

/**
 * Install a take the launch replay read back, and run its first attempt
 * (#38 rebuild PR 3). Quiet: a first attempt shows nothing, and only a
 * failure reaches the recovery screen (`App` shows it once `attempts > 0`).
 *
 * `"busy"` when the slot is held, and nothing is written: the replay stops
 * and leaves its row for the next launch rather than displace a recording.
 * The check is made twice, against `held` and inside the slot write itself,
 * so a take that reached the slot after `held` was read keeps it; `update`
 * is the hook's `writeSlot`, applied synchronously, so `installed` is known
 * before anything is saved. Otherwise resolves whether the slot is free
 * again, which is whether the replay may go on to the next row.
 */
export async function performResumeTake(
  held: PendingTake | null,
  take: ReplayTake,
  effects: SaveEffects
): Promise<boolean | "busy"> {
  const next = startSave(held, take);
  if (next === held) return "busy";
  let installed = false;
  effects.update((h) => {
    if (h) return h;
    installed = true;
    return next;
  });
  if (!installed) return "busy";
  replayed.add(next.clipId);
  return performSaveTake(next, effects);
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
  // In the tap's own turn, before anything is awaited: a hold or commit
  // already queued for this take reads it and writes nothing.
  if (held) discardRequested.add(held.clipId);
  const { next, orphan } = discardSave(held);
  update(() => next);
  if (!held || !orphan) return;
  replayed.delete(held.clipId);
  // The translator chose to lose this take, so a relaunch must not offer it:
  // the row goes with a `discarded` record, in one transaction, and the clip
  // a failed attempt may have written goes too unless something uses it.
  const settled = await settlePendingTake(held.segmentId, orphan, "discard");
  reportPendingResult("pending-take-delete")(settled);
  if (settled.ok) discardRequested.delete(orphan);
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
 *
 * Resolves `"stale"` rather than `false` when the store says this segment no
 * longer exists (#607): another copy deleted its book, and a retry of the
 * clear cannot bring the row back, so the sheet must not offer one. It is
 * still a failure and is reported the same way.
 */
export async function performClearEditedSegment(
  segmentId: SegmentId,
  onCleared?: () => void
): Promise<boolean | "stale"> {
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
    return isMissingSegmentFailure(cause, segmentId) ? "stale" : false;
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
 * The one slot, its in-flight guard, and the recordings waiting for it.
 *
 * Everything `useSaveTake` does minus React, so it runs in Node against
 * `fake-indexeddb` (`tests/take-slot.test.ts`). `publish` is React's
 * `setPending`; the slot itself lives here, so a reader between a write and
 * its render (the launch replay, a tap in the same frame) never sees a stale
 * slot, and a transition is never applied to two different snapshots.
 */
export interface TakeSlot {
  /** The live slot. */
  readonly held: () => PendingTake | null;
  /** Whether an attempt is in flight, readable synchronously. */
  readonly saving: () => boolean;
  /**
   * The launch replay's install and first attempt (`performResumeTake`).
   * Resolves whether the slot is free again; `false` while an attempt is in
   * flight or the slot is held, which stops the replay's run.
   */
  readonly resume: (take: ReplayTake) => Promise<boolean>;
  /**
   * Hand the slot a finished recording. Never rejects.
   *
   * While the slot is held or an attempt is in flight, the recording waits
   * here instead of being refused (#1549): the launch replay's quiet first
   * attempt holds the slot with nothing on screen, and a recording finished
   * in that window used to be dropped with only a console line. It is
   * installed and saved the moment the slot is free, in the same turn, so
   * the slot is never seen empty while it waits. The promise resolves with
   * that save's result; or `false` as soon as the held take has failed, so
   * the sheet exits to the recovery screen that now owns the body, while the
   * recording keeps waiting behind the take on that screen.
   */
  readonly save: (take: NewTake) => Promise<boolean>;
  /** Another attempt at a failed held take; ignored while one is in flight. */
  readonly retry: () => void;
  /** Deliberate, confirmed loss of the held take; ignored while saving. */
  readonly discard: () => void;
  /**
   * The callback a landed save fires, so the screen behind can reload. Set
   * from an effect, so a caller's new callback each render is not read
   * during render.
   */
  readonly setOnSaved: (onSaved: (() => void) | undefined) => void;
}

export function createTakeSlot(
  publish: (held: PendingTake | null) => void,
  notify: Omit<SaveEffects, "update">
): TakeSlot {
  let held: PendingTake | null = null;
  // Set before the first await of every attempt and released in its
  // `finally`: this is what a second tap in the same frame reads. Releasing
  // it is safe in a `finally` where emptying the slot is not: it is a guard,
  // not the samples, and a guard left set would lock out the Retry the
  // failure path exists to offer.
  let saving = false;
  // Recordings handed over while the slot was busy, oldest first. Held in
  // memory only, as the sheet held them until the hand-over: a kill before
  // the slot frees still loses them (#1549's residual, in the PR).
  const waiting: {
    readonly take: PendingTake;
    readonly settle: (saved: boolean) => void;
  }[] = [];

  const write = (
    transition: (current: PendingTake | null) => PendingTake | null
  ): void => {
    held = transition(held);
    publish(held);
    drain();
  };
  let onSaved = notify.onSaved;
  const effects: SaveEffects = {
    update: write,
    onSaved: () => onSaved?.(),
    requestSweep: notify.requestSweep,
  };

  const attempt = async <T>(
    run: (e: SaveEffects) => Promise<T>
  ): Promise<T> => {
    saving = true;
    try {
      return await run(effects);
    } finally {
      saving = false;
      drain();
    }
  };

  // Called after every slot write and every attempt's end: the only two
  // moments the slot can come free or a held take can fail.
  function drain(): void {
    if (saving) return;
    if (held === null) {
      const next = waiting.shift();
      if (!next) return;
      held = next.take;
      publish(held);
      void attempt((e) => performSaveTake(next.take, e)).then(next.settle);
      return;
    }
    // The held take failed, and its recovery screen takes the body over:
    // let every waiting sheet go, but keep the recordings queued. A promise
    // settles once, so the result of a later save is then ignored.
    if (held.state === "failed") for (const w of waiting) w.settle(false);
  }

  return {
    held: () => held,
    saving: () => saving,
    resume: async (take) => {
      if (saving) return false;
      return (await attempt((e) => performResumeTake(held, take, e))) === true;
    },
    save: (newTake) => {
      const take = startSave(null, newTake);
      if (held === null && !saving) {
        // Before any await AND before the fallible merge, so the only
        // reference to the recording is never a local in a function that
        // can throw.
        write(() => take);
        return attempt((e) => performSaveTake(take, e));
      }
      return new Promise<boolean>((settle) => {
        waiting.push({ take, settle });
        drain();
      });
    },
    retry: () => {
      // The live guard, ahead of the pure one: `SaveFailed` only hides Retry
      // once the saving re-render lands.
      if (saving) return;
      const current = held;
      const next = retrySave(current);
      // Identity means refused: nothing held, or a save already in flight.
      if (!next || next === current) return;
      write(() => next);
      void attempt((e) => performSaveTake(next, e));
    },
    discard: () => {
      // The same live guard Retry takes, and for the same window: between a
      // Retry tap and its re-render the armed Delete is still on screen and
      // still live. Discarding there races the write Retry just started:
      // the clip deleted out from under a take `saveTake` has already made
      // active, or the write landing after the discard so a recording the
      // translator confirmed deleting comes back.
      if (saving) return;
      void performDiscardTake(held, write);
    },
    setOnSaved: (next) => {
      onSaved = next;
    },
  };
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
  // The live slot, its in-flight guard and its waiting recordings (#38
  // rebuild PR 3, #1549), made once per mount. `setPending` is stable, so the
  // slot hands React every write in the same synchronous turn.
  const [slot] = useState(() =>
    createTakeSlot(setPending, {
      requestSweep: () => void requestTranscodeSweep(),
    })
  );
  // The latest `onSaved`, for the slot and the cut-to-empty clear, without
  // making either depend on a callback identity the caller re-creates each
  // render. Kept current in an effect, not written during render
  // (`react-hooks/refs`). The `useRef` initialiser already holds the first
  // render's callback, and effects flush before the next tap and before the
  // replay's effect below, so no commit can read a stale one.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
    slot.setOnSaved(onSaved);
  }, [slot, onSaved]);

  // Launch: finish any save the app was closed in the middle of
  // (`replay-pending-takes.ts`). After the first render, and once per mount:
  // the ref holds across React's development double-run. Each row takes the
  // same live guard Retry does, then the slot (`slot.resume`, which installs
  // through `performResumeTake`); a held slot stops the run.
  const replayStartedRef = useRef(false);
  useEffect(() => {
    if (replayStartedRef.current) return;
    replayStartedRef.current = true;
    void replayPendingTakes((take) => slot.resume(take));
  }, [slot]);

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
   * and the splice `offset`. The slot's attempt (`performSaveTake`) does the
   * merge and the write; `saveTake` REPLACES the segment's take (1:1) in one
   * transaction, so the merged buffer is the whole segment's audio. A merge or
   * write failure lands in the recovery screen, and retry re-runs the attempt —
   * never a save of the raw fragment, which under 1:1 would delete the original
   * clip. While the slot is busy the recipe waits in it instead (#1549,
   * `TakeSlot.save`).
   */
  const saveRecording = useCallback(
    (
      segmentId: SegmentId,
      // The segment's display number, carried on the take so the recovery
      // screen names the segment the audio belongs to (#710).
      ordinal: number | null,
      existing: Int16Array,
      recorded: Int16Array,
      insertionOffset: number,
      finished: boolean,
      // Set by the edit-only path below; a fresh recording leaves it false. Only
      // the recovery screen's wording depends on it — the save itself is identical.
      editOnly = false
    ): Promise<boolean> => {
      // The revision and generation `existing` was read at, not ones read
      // now: the hold stamps them, so a replay sees a move since (cell HM),
      // and the commit stamps the generation the audio was cut from (#163
      // A-14).
      return slot.save(
        withObservedRevision({
          segmentId,
          ordinal,
          // Minted here, not per attempt: IndexedDB `put` is an upsert, so a
          // retry with the same id overwrites the bytes a failed attempt may
          // already have written instead of spending the space twice.
          clipId: newClipId(),
          existing,
          recorded,
          offset: insertionOffset,
          finished,
          editOnly,
        })
      );
    },
    [slot]
  );

  /**
   * Persist an already-flattened, edited segment buffer (B5).
   *
   * A cut/paste session produces the whole new segment audio in memory; there is
   * no fresh recording to splice. So this reuses the exact record path with an
   * empty `recorded` and offset 0 — the attempt skips the merge and `saveTake`s the
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
   * Only this branch can resolve `"stale"` (`performClearEditedSegment`); a
   * non-empty buffer's missing target reaches `SaveFailed` as `stale` instead.
   */
  const saveEditedSegment = useCallback(
    (
      segmentId: SegmentId,
      ordinal: number | null,
      buffer: Int16Array,
      finished: boolean
    ): Promise<boolean | "stale"> => {
      if (buffer.length === 0) {
        return performClearEditedSegment(segmentId, () =>
          onSavedRef.current?.()
        );
      }
      return saveRecording(
        segmentId,
        ordinal,
        buffer,
        NO_SAMPLES,
        0,
        finished,
        true
      );
    },
    [saveRecording]
  );

  const retryPendingTake = useCallback(() => slot.retry(), [slot]);

  /** Deliberate, confirmed loss of the held recording. */
  const discardPendingTake = useCallback(() => slot.discard(), [slot]);

  return {
    pendingTake: pending,
    saveRecording,
    saveEditedSegment,
    retryPendingTake,
    discardPendingTake,
  };
}

export type { PendingTake };
