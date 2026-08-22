import { describe, expect, it } from "vitest";

import {
  discardSave,
  failSave,
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
 * `putClip` / `addTake` writes, the `deleteClip` of the orphan, the `useState`
 * slot surviving a re-render, and the recovery screen taking over are all
 * outside this module. `discardSave` reports which clip is orphaned; it does not
 * delete it, and nothing here asserts that a delete happened. The storage calls
 * themselves are covered by `tests/storage.test.ts`. The wiring between them is
 * **not verified at all yet** — it needs an on-device check (fill the device,
 * record, confirm the recovery screen and that Retry reuses the clip), and as
 * of 2026-08-22 nothing in this project has run on real hardware.
 */

const SEGMENT = "seg-1" as SegmentId;
const CLIP = "clip-1" as ClipId;

/** Stands in for a take's PCM. Identity is what the assertions care about. */
function pcm(): Int16Array {
  return Int16Array.from([1, -1, 2, -2]);
}

function held(): { take: PendingTake; samples: Int16Array } {
  const samples = pcm();
  const take = startSave(null, {
    segmentId: SEGMENT,
    clipId: CLIP,
    samples,
  });
  return { take, samples };
}

describe("startSave", () => {
  it("takes hold of the samples before anything can throw", () => {
    const { take, samples } = held();
    expect(take.samples).toBe(samples);
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
      samples: pcm(),
    });
    expect(second).toBe(take);
  });
});

describe("failSave", () => {
  it("keeps the samples on the failure path", () => {
    // The regression this guards is one line: a `finally { setPending(null) }`
    // in the hook's commit. The samples are the only copy of the recording.
    const { take, samples } = held();
    const failed = failSave(take, CLIP, "quota");
    expect(failed?.samples).toBe(samples);
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
    const { take, samples } = held();
    const failed = failSave(take, CLIP, "quota");
    const again = retrySave(failed);
    expect(again?.clipId).toBe(CLIP);
    expect(again?.samples).toBe(samples);
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
    const samples = pcm();
    const started = startSave(null, {
      segmentId: SEGMENT,
      clipId: CLIP,
      samples,
    });
    const failed = failSave(started, CLIP, "quota");
    const retried = retrySave(failed);
    expect(retried?.samples).toBe(samples);
    expect(retried?.clipId).toBe(CLIP);
    expect(retried?.segmentId).toBe(SEGMENT);
    expect(succeedSave(retried, CLIP)).toBeNull();
  });
});
