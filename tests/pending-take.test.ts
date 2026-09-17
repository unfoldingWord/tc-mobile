import { describe, expect, it } from "vitest";

import {
  discardSave,
  failSave,
  holdsUnsavedAudio,
  retrySave,
  startSave,
  succeedSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import type { ClipId, SegmentId } from "@/types/domain";

/**
 * The transitions that stand between a failed write and permanently lost field
 * audio. Each test below names the regression it exists to catch. None of them
 * could be written while this logic lived inside `useObsChapter`: `vitest`
 * runs in the Node environment here and the project has no renderer, so a
 * regression in any of these transitions used to ship with the suite green.
 *
 * Written against mutations rather than by inspection: when this file was
 * written, each guard in `pending-take.ts` was removed or inverted in turn and
 * confirmed to fail at least one test below — the samples dropped on the
 * failure path, the retry minting a fresh `clipId`, the re-entry guard, both
 * `clipId` match guards, the attempt counter, the displacement guard, and the
 * orphan report.
 *
 * What is NOT covered here: everything the hook does with the results. The
 * `saveTake` write (clip + take in one transaction), the `deleteClip` of the
 * orphan, the `useState` slot surviving a re-render, and the recovery screen
 * taking over are all outside this module. `discardSave` reports which clip is orphaned; it does not
 * delete it, and nothing here asserts that a delete happened. The storage calls
 * themselves are covered by `tests/storage.test.ts`. The wiring between them —
 * `performSaveTake` and `performDiscardTake`, the orchestration minus React —
 * is covered in Node by `tests/use-save-take.test.ts` since #180; what has NO
 * automated coverage is the React state around it (the `useState` slot, the
 * `savingRef` guard), and the specific on-device check that has still not been
 * run: fill the device, record, and confirm the recovery screen appears and
 * that Retry reuses the same clip. Record → playback has been run on a phone
 * (2026-08-24 and 2026-08-25, one iPhone on iOS Safari, as recorded in
 * AGENTS.md and `docs/progress_tracker.md`; never on Android) — but a
 * *successful* save exercises none of this. The failure path only opens when
 * the write actually rejects, which on a phone with room to spare it never
 * does.
 */

const SEGMENT = "seg-1" as SegmentId;
const CLIP = "clip-1" as ClipId;

/** Stands in for a take's PCM. Identity is what the assertions care about. */
function pcm(): Int16Array {
  return Int16Array.from([1, -1, 2, -2]);
}

function held(
  finished = false,
  editOnly = false
): { take: PendingTake; recorded: Int16Array } {
  const recorded = pcm();
  const take = startSave(null, {
    segmentId: SEGMENT,
    clipId: CLIP,
    existing: new Int16Array(0),
    recorded,
    offset: 0,
    finished,
    editOnly,
  });
  return { take, recorded };
}

describe("startSave", () => {
  it("takes hold of the samples before anything can throw", () => {
    const { take, recorded } = held();
    // The recipe is owned before anything fallible: the newly recorded PCM,
    // the (empty, here) existing audio, and the splice offset.
    expect(take.recorded).toBe(recorded);
    expect(take.existing).toHaveLength(0);
    expect(take.offset).toBe(0);
    expect(take.segmentId).toBe(SEGMENT);
    expect(take.clipId).toBe(CLIP);
    expect(take.state).toBe("saving");
    expect(take.kind).toBeNull();
    // Zero means "the first attempt is still in flight" — the recovery screen
    // waits for a real failure rather than flashing after every take.
    expect(take.attempts).toBe(0);
  });

  it("refuses to displace a recording that is already held", () => {
    // One slot, not a queue. Displacing the first take is the silent loss all
    // of this exists to prevent.
    const { take } = held();
    const second = startSave(take, {
      segmentId: "seg-2" as SegmentId,
      clipId: "clip-2" as ClipId,
      existing: new Int16Array(0),
      recorded: pcm(),
      offset: 0,
      finished: false,
      editOnly: false,
    });
    expect(second).toBe(take);
  });
});

describe("failSave", () => {
  it("keeps the samples on the failure path", () => {
    // The regression this guards is one line: a `finally { setPending(null) }`
    // in the hook's commit. The samples are the only copy of the recording.
    const { take, recorded } = held();
    const failed = failSave(take, CLIP, "quota");
    expect(failed?.recorded).toBe(recorded);
    expect(failed?.state).toBe("failed");
    expect(failed?.kind).toBe("quota");
    expect(failed?.attempts).toBe(1);
    expect(failed?.clipId).toBe(CLIP);
    expect(failed?.segmentId).toBe(SEGMENT);
  });

  it("counts attempts across repeated failures", () => {
    const { take } = held();
    const once = failSave(take, CLIP, "unknown");
    const armed = retrySave(once);
    const twice = failSave(armed, CLIP, "quota");
    expect(twice?.attempts).toBe(2);
    expect(twice?.kind).toBe("quota");
  });

  it("ignores a failure belonging to some other attempt", () => {
    // A write that rejects after its take was discarded must not put a
    // recovery screen back over a slot that is empty or holds something else.
    const { take } = held();
    expect(failSave(take, "clip-other" as ClipId, "quota")).toBe(take);
    expect(failSave(null, CLIP, "quota")).toBeNull();
  });
});

describe("retrySave", () => {
  it("reuses the same clipId and the same samples", () => {
    // A second id would spend the space twice on the phone that just ran out
    // of it; `put` with the held id overwrites whatever the failed attempt
    // already wrote.
    const { take, recorded } = held();
    const failed = failSave(take, CLIP, "quota");
    const again = retrySave(failed);
    expect(again?.clipId).toBe(CLIP);
    expect(again?.recorded).toBe(recorded);
    expect(again?.state).toBe("saving");
    // The old message is cleared so the screen shows "Saving", not the failure
    // that is being retried.
    expect(again?.kind).toBeNull();
    // Retrying is not itself a failure.
    expect(again?.attempts).toBe(1);
  });

  it("is not re-entrant while a save is in flight", () => {
    // Two taps on Retry, or a tap while the first attempt is still running.
    const { take } = held();
    expect(retrySave(take)).toBe(take);
    const failed = failSave(take, CLIP, "quota");
    const again = retrySave(failed);
    expect(retrySave(again)).toBe(again);
  });

  it("has nothing to do with an empty slot", () => {
    expect(retrySave(null)).toBeNull();
  });

  it("refuses a downgrade, which no attempt can clear", () => {
    // A newer copy of the app has moved the database past this build, so
    // `getDb()` fails the version check before any transaction — identically,
    // every time. Arming a save here spins the recovery screen through "Saving"
    // and back for as long as someone keeps tapping. Refused by returning the
    // slot UNCHANGED, which is the same "refused" every caller already reads
    // (George R2 P2-1).
    const { take } = held();
    const failed = failSave(take, CLIP, "downgrade");
    expect(retrySave(failed)).toBe(failed);
    // And the retryable kinds are untouched by the guard.
    const blip = failSave(take, CLIP, "unknown");
    expect(retrySave(blip)).not.toBe(blip);
    const full = failSave(take, CLIP, "quota");
    expect(retrySave(full)).not.toBe(full);
  });
});

describe("holdsUnsavedAudio", () => {
  const empty = { pendingTake: null, recorderOpen: false, clipboard: null };

  it("holds nothing when nothing is in hand", () => {
    expect(holdsUnsavedAudio(empty)).toBe(false);
  });

  it("holds a take whose save has not landed", () => {
    const { take } = held();
    expect(holdsUnsavedAudio({ ...empty, pendingTake: take })).toBe(true);
  });

  it("holds an open recorder, coarsely — the sheet, not a running capture", () => {
    // Capture state is not visible from `App`, and the coarse answer is wrong
    // only in the direction that costs the other copy a wait.
    expect(holdsUnsavedAudio({ ...empty, recorderOpen: true })).toBe(true);
  });

  it("holds CUT audio that has not been pasted", () => {
    // The hole it came from is already committed to disk, so these samples are
    // the only copy left of that phrase. Yielding the connection unmounts the
    // screen that could paste them, and a restart drops the slot — the segment
    // keeps its hole and the phrase is gone (George R2 P2-2).
    expect(holdsUnsavedAudio({ ...empty, clipboard: pcm() })).toBe(true);
  });

  it("does not hold an emptied clipboard", () => {
    // Reachable — the slot is set from a cut whose selection can be empty — and
    // holding it would block another copy's upgrade over nothing.
    expect(holdsUnsavedAudio({ ...empty, clipboard: new Int16Array(0) })).toBe(
      false
    );
  });

  it("releases once the clipboard is pasted or cleared", () => {
    // Pasting clears the slot, and so does changing chapter. Either way the
    // refused upgrade is free to go through.
    const holding = { ...empty, clipboard: pcm() };
    expect(holdsUnsavedAudio(holding)).toBe(true);
    expect(holdsUnsavedAudio({ ...holding, clipboard: null })).toBe(false);
  });
});

describe("succeedSave", () => {
  it("is the only transition that empties the slot", () => {
    const { take } = held();
    const failed = failSave(take, CLIP, "quota");
    const again = retrySave(failed);
    expect(failed).not.toBeNull();
    expect(again).not.toBeNull();
    expect(succeedSave(again, CLIP)).toBeNull();
  });

  it("ignores a success belonging to some other attempt", () => {
    const { take } = held();
    expect(succeedSave(take, "clip-other" as ClipId)).toBe(take);
    expect(succeedSave(null, CLIP)).toBeNull();
  });
});

describe("discardSave", () => {
  it("empties the slot and names the clip left behind", () => {
    const { take } = held();
    const failed = failSave(take, CLIP, "quota");
    const { next, orphan } = discardSave(failed);
    expect(next).toBeNull();
    // The caller deletes this; a failed attempt may already have written the
    // bytes before the take row failed.
    expect(orphan).toBe(CLIP);
  });

  it("names nothing when there is nothing held", () => {
    const { next, orphan } = discardSave(null);
    expect(next).toBeNull();
    expect(orphan).toBeNull();
  });
});

describe("a take that is saved on the second attempt", () => {
  it("carries the same audio and the same clip through the whole sequence", () => {
    const recorded = pcm();
    const started = startSave(null, {
      segmentId: SEGMENT,
      clipId: CLIP,
      existing: new Int16Array(0),
      recorded,
      offset: 0,
      finished: false,
      editOnly: false,
    });
    const failed = failSave(started, CLIP, "quota");
    const retried = retrySave(failed);
    expect(retried?.recorded).toBe(recorded);
    expect(retried?.clipId).toBe(CLIP);
    expect(retried?.segmentId).toBe(SEGMENT);
    expect(succeedSave(retried, CLIP)).toBeNull();
  });

  it("carries the Finished mark through fail and retry", () => {
    // The property Frank's round-6 P2 turned on: a take marked Finished that
    // fails to save must still be Finished when a retry commits it, or the
    // translator's explicit mark is silently dropped on the recovery path.
    const { take } = held(true);
    expect(take.finished).toBe(true);
    const failed = failSave(take, CLIP, "quota");
    expect(failed?.finished).toBe(true);
    const retried = retrySave(failed);
    expect(retried?.finished).toBe(true);
  });

  it("carries the edit-only flag through fail and retry", () => {
    // The recovery screen words itself off `editOnly` (#67): an edit-save that
    // fails must still read as an edit — not "delete this recording for good" —
    // through every transition, or the screen lies about what discarding costs.
    const { take } = held(false, true);
    expect(take.editOnly).toBe(true);
    const failed = failSave(take, CLIP, "unknown");
    expect(failed?.editOnly).toBe(true);
    const retried = retrySave(failed);
    expect(retried?.editOnly).toBe(true);
  });
});
