/**
 * The one ownership verdict for a replayed take (#38, closes #1557).
 *
 * Pure: it decides from what the owning transaction read, and writes nothing.
 * `saveReplayedTake` (`lib/storage/takes.ts`) evaluates it inside that
 * transaction, before any write, and does exactly what the verdict says. The
 * order and the reasons are docs/design/pending-take-lifecycle.md, §4.
 *
 * **Absence is never consent.** A missing row frees the slot only when a
 * record says the take was saved (`done`) or discarded (`discarded`), and
 * allows a save only when a record says the row was given up for quota with
 * the take still wanted (`free`). A missing row with no record, or a row that
 * belongs to another clip, is `unexplained`, and `unexplained` keeps.
 */

import type {
  ClipId,
  Segment,
  StoredPendingTake,
  TakeDisposition,
} from "@/types/domain";

/**
 * - `gone`: the segment was deleted; there is nowhere to save.
 * - `done`: the take is already the active take, or a record says it was
 *   saved (by any copy).
 * - `discarded`: a record says it was discarded, or this copy asked to
 *   discard it.
 * - `moved`: the segment's active take changed since the take's base was
 *   read, so saving would replace or undo that change.
 * - `free`: the take's own unmarked row is there, or the row was given up
 *   for quota and the segment's row key is empty. Only this one saves.
 * - `unexplained`: anything else.
 */
export type Verdict =
  "gone" | "done" | "discarded" | "moved" | "free" | "unexplained";

/**
 * Judge a replayed take against the segment, its active clip, the segment's
 * row and the take's record, all read in one transaction. The first rule
 * that holds wins, in the order of `Verdict` above.
 *
 * `discardRequested` is this copy's in-memory Discard request for the take:
 * the writer rule's second half (the note, §3), read by the caller inside the
 * same transaction. It counts as a `discarded` record, so a `given-up` record
 * never hides it.
 */
export function judgePending(
  segment: Segment | undefined,
  activeClipId: ClipId | null,
  row: StoredPendingTake | undefined,
  disposition: TakeDisposition | undefined,
  take: { readonly clipId: ClipId; readonly baseRevision: number },
  discardRequested = false
): Verdict {
  if (!segment) return "gone";
  if (activeClipId === take.clipId || disposition?.kind === "saved") {
    return "done";
  }
  if (discardRequested || disposition?.kind === "discarded") {
    return "discarded";
  }
  if (segment.audioRevision !== take.baseRevision) return "moved";
  const ownRow = row?.clipId === take.clipId && row.refusal === undefined;
  if (ownRow || (row === undefined && disposition?.kind === "given-up")) {
    return "free";
  }
  return "unexplained";
}
