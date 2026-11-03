import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { getSegment } from "@/lib/storage/books";
import {
  listPendingTakes,
  loadPendingRecipe,
} from "@/lib/storage/pending-takes";
import { dropRefusedPendingTake, settlePendingTake } from "@/lib/storage/takes";
import type { NewTake } from "@/lib/takes/pending-take";
import type { PendingRefusal, StoredPendingTake } from "@/types/domain";
import { reportFailure } from "./report-failure";

/** A take the replay hands the slot: its base revision is always known. */
export type ReplayTake = NewTake & { readonly baseRevision: number };

/**
 * Finish, on launch, every save the app was closed in the middle of (#38
 * rebuild PR 3, the replay slice; docs/design/pending-take-lifecycle.md §3
 * "The replay's own reads" and §4). The DRI's pick on #1546 stands: "Finish
 * the save quietly (Recommended)". Nothing is shown unless a save fails.
 *
 * The rows are listed once and taken oldest first. Each is classified
 * before any audio is read, the first match deciding:
 *
 *   1. its segment is gone: the row is ended in the owning transaction (a
 *      settle after a delete writes no record) and reported once;
 *   2. an earlier build marked it refused and kept it: dropped now, and
 *      reported once (#1562 item 2);
 *   3. it has no `baseRevision` (`legacy`) or another sample rate: dropped
 *      and reported once.
 *
 * Only then is the recipe read. A `stored` base that is missing or changed
 * is dropped and reported once, and never installed, so it can never reach
 * the verdict. A drop deletes the row and its audio in one transaction (the
 * DRI's pick on #1562, verbatim: "Delete it at the refusal, log it
 * (Recommended)"); the report names the refusal and the take's length. A recipe goes to `resume`, which installs it in the
 * slot and runs the conditional commit (`performResumeTake`); the commit,
 * not this read, decides whether it is saved, already saved, discarded or
 * kept. `resume` answers whether the slot is free again: a held slot stops
 * the run, and the remaining rows wait for the next launch.
 *
 * Never rejects: it runs from a mount effect with nobody to catch it.
 */
export async function replayPendingTakes(
  resume: (take: ReplayTake) => Promise<boolean>
): Promise<void> {
  try {
    const listed = await listPendingTakes();
    if (!listed.ok) {
      report(listed.cause, "pending-take-read");
      return;
    }
    const rows = [...listed.rows].sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      const take = await classify(row);
      if (take && !(await resume(take))) return;
    }
  } catch (cause) {
    report(cause, "pending-take-read");
  }
}

/** One row: the take to install, or `null` once the row is dealt with. */
async function classify(row: StoredPendingTake): Promise<ReplayTake | null> {
  if (!(await getSegment(row.segmentId))) {
    await gone(row);
    return null;
  }
  if (row.refusal !== undefined) {
    return refuse(row, `${row.refusal} (kept by an earlier build)`);
  }
  const { baseRevision } = row;
  if (baseRevision === undefined) return refuse(row, "legacy");
  if (row.sampleRate !== CANONICAL_SAMPLE_RATE) {
    return refuse(row, "sample-rate");
  }
  const read = await loadPendingRecipe(row, CANONICAL_SAMPLE_RATE);
  switch (read.kind) {
    case "recipe":
      return { ...read.take, baseRevision };
    case "segment-gone":
      await gone(row);
      return null;
    case "failed":
      report(read.cause, "pending-take-read");
      return null;
    default:
      return refuse(row, read.kind);
  }
}

/** Drop a row whose segment is gone, and say so once. */
async function gone(row: StoredPendingTake): Promise<void> {
  report(notSaved("segment-gone"), "pending-take-refused");
  const ended = await settlePendingTake(row.segmentId, row.clipId, "give-up");
  if (!ended.ok) report(ended.cause, "pending-take-delete");
}

/**
 * Drop a refused row and say so once. A failed drop leaves the row as it
 * was, and the next launch reports and tries again.
 */
async function refuse(
  row: StoredPendingTake,
  refusal: PendingRefusal | `${PendingRefusal} (kept by an earlier build)`
): Promise<null> {
  const samples = row.recorded.byteLength / Int16Array.BYTES_PER_ELEMENT;
  report(
    refusedAndDropped(refusal, null, samples, row.sampleRate),
    "pending-take-refused"
  );
  const dropped = await dropRefusedPendingTake(row.segmentId, row.clipId);
  if (!dropped.ok) report(dropped.cause, "pending-take-delete");
  return null;
}

/** The cause a refused row is logged with: which check refused it. */
export function notSaved(reason: string): Error {
  return new Error(`Pending take not saved on launch (${reason})`);
}

/**
 * The cause a refused take whose audio is dropped is logged with (#1562
 * item 2): the refusal, the verdict that refused it (`null` when the launch's
 * classification refused it before any verdict), and the length of the
 * recorded audio dropped, in milliseconds and samples at its own rate.
 */
export function refusedAndDropped(
  refusal: string,
  verdict: string | null,
  samples: number,
  sampleRate: number
): Error {
  const ms = Math.round((samples * 1000) / sampleRate);
  return new Error(
    `Pending take refused, audio dropped (refusal: ${refusal}; ` +
      `verdict: ${verdict ?? "not reached"}; ` +
      `length: ${ms} ms (${samples} samples))`
  );
}

function report(cause: unknown, context: string): void {
  console.error(`Pending take replay (${context})`, cause);
  reportFailure(cause, context);
}
