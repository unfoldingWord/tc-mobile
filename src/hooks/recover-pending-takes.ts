import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  deletePendingTake,
  listPendingTakes,
  loadPendingRecipe,
  markPendingRefusal,
} from "@/lib/storage/pending-takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { StoredPendingTake } from "@/types/domain";
import { reportFailure } from "./report-failure";

/**
 * Finish, on launch, every save the app was closed in the middle of (#38
 * slice 3; the DRI's pick, verbatim: "Finish the save quietly
 * (Recommended)"): no prompt, and only a failed save shows anything, the
 * recovery screen a failed Save shows. Each row, via `loadPendingRecipe`:
 *
 *   - a recipe goes to `resume` (the hook's slot, then `performSaveTake`),
 *     which saves only over the take the row says it replaces; `"stale"`: a
 *     newer save won, the row is kept refused, the run goes on;
 *   - `"saved"` (the row outlived its save): the row is deleted;
 *   - `"segment-gone"`: reported, then deleted: nowhere left to save it;
 *   - any other refusal (`PendingRefusal`): reported once and KEPT rather
 *     than drop field audio (the coordinator's reading, on #38); the row
 *     carries the refusal, so a later launch stays quiet;
 *   - `"failed"` (the read failed): reported, row untouched.
 *
 * One at a time, oldest first. A failed save or `"busy"` stops the run: the
 * one slot is held, so the rest wait for the next launch.
 *
 * Never rejects: it runs from a mount effect with nobody to catch it.
 */
export async function recoverPendingTakes(
  resume: (take: NewTake) => Promise<boolean | "busy" | "stale">
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
          const done = await resume(read.take);
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
