import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  deletePendingTake,
  listPendingTakes,
  loadPendingRecipe,
  markPendingRefusal,
} from "@/lib/storage/pending-takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { StoredPendingTake, TakeId } from "@/types/domain";
import { reportFailure } from "./report-failure";

/**
 * Finish, on launch, every save the app was closed in the middle of (#38
 * slice 3). The DRI's pick, verbatim: "Finish the save quietly
 * (Recommended)". The person already pressed Stop or Save, so the take is
 * saved into its segment with no prompt and the segment simply reads as
 * recorded; only a save that fails shows anything, and what it shows is the
 * recovery screen a failed Save shows.
 *
 * Each row is read back through `loadPendingRecipe`:
 *
 *   - a recipe is handed to `resume`, which is the hook's slot plus the same
 *     `performSaveTake` a Save runs; its own release deletes the row. The
 *     save is conditional on the row and the segment's active take being as
 *     the read found them (`saveReplayedTake`); `"stale"` means another copy
 *     got there first, the row is dropped and reported, and the run goes on;
 *   - `"saved"` (the save landed and the row outlived it): the row is deleted;
 *   - `"segment-gone"`: reported, then the row is deleted, since there is
 *     nowhere left to save it;
 *   - `"sample-rate"`, `"base-missing"`, `"base-changed"`: reported and KEPT
 *     rather than drop field audio (the coordinator's reading of the pick, on
 *     #38). The report goes once: the row carries the refusal it was reported
 *     under (`markPendingRefusal`), and a later launch that finds the same
 *     refusal on the row stays quiet. If that mark fails to land, the next
 *     launch reports again: a repeated row, never a lost one;
 *   - `"failed"` (the read itself failed): reported, row untouched, so the
 *     next launch tries again.
 *
 * One at a time, oldest first. A save that fails stops the run: the recovery
 * screen is up and holds the one slot, so the rest wait for the next launch.
 * `"busy"` (the slot already holds a take) stops it the same way.
 *
 * Never rejects: it runs from a mount effect with nobody to catch it.
 */
export async function recoverPendingTakes(
  resume: (
    take: NewTake,
    against: TakeId | null
  ) => Promise<boolean | "busy" | "stale">
): Promise<void> {
  try {
    const listed = await listPendingTakes();
    if (!listed.ok) {
      report(listed.cause, "pending-take-read");
      return;
    }
    const rows = [...listed.rows].sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      const read = await loadPendingRecipe(row, CANONICAL_SAMPLE_RATE);
      switch (read.kind) {
        case "recipe": {
          // `"stale"`: another copy saved this segment since the read, so the
          // row was dropped and the slot is free again; go on to the next.
          const done = await resume(read.take, read.against);
          if (done !== true && done !== "stale") return;
          break;
        }
        case "saved":
          await release(row);
          break;
        case "segment-gone":
          report(refusal(read.kind), "pending-take-refused");
          await release(row);
          break;
        case "failed":
          report(read.cause, "pending-take-read");
          break;
        default:
          if (row.refusalReported === read.kind) break;
          report(refusal(read.kind), "pending-take-refused");
          await settled(
            markPendingRefusal(row.segmentId, row.clipId, read.kind),
            // Not "pending-take-write", which is the held take's safety copy:
            // a failed mark keeps the audio and only repeats the report.
            "pending-take-refused"
          );
      }
    }
  } catch (cause) {
    report(cause, "pending-take-read");
  }
}

/** The cause a refused row is logged with: which check refused it. */
function refusal(kind: string): Error {
  return new Error(`Pending take not saved on launch (${kind})`);
}

function report(cause: unknown, context: string): void {
  console.error(`Pending take recovery failed (${context})`, cause);
  reportFailure(cause, context);
}

function release(row: StoredPendingTake): Promise<void> {
  return settled(
    deletePendingTake(row.segmentId, row.clipId),
    "pending-take-delete"
  );
}

/** Await a store result that never rejects, and report a failure it carries. */
async function settled(
  result: Promise<{ readonly ok: boolean; readonly cause?: unknown }>,
  context: string
): Promise<void> {
  const done = await result;
  if (!done.ok) report(done.cause, context);
}
