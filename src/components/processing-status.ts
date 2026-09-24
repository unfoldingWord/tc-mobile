import type { RecorderState } from "@/hooks/use-recorder";

/**
 * Which status the recorder shows in the window between a take being confirmed
 * and its audio reaching the database — or null when there is nothing to say.
 *
 * #39: that window drew no record dot, no timer and no copy. There are two ways
 * into it, and — this is the subtlety Frank/George's round 1 caught — the
 * `processing` state does NOT span the whole of the first one:
 *
 *  - **The normal commit.** The take is ended (a Stop tap, an Edit entry, or a
 *    Back), then stop → decode → the multi-MB IndexedDB `saveTake`.
 *    `use-recorder` flips state from `processing` back to `idle` the instant
 *    decode finishes, BEFORE `stop()` returns, while the commit is still
 *    awaiting the write. So `isClosing` — set for the whole of that commit — is
 *    what spans it; gating on `state === "processing"` dropped the status
 *    before the slow part (the write) even began.
 *  - **The #59 interruption.** The mic is lost mid-take and the take freezes
 *    into `processing` before anything asked it to stop, so `!isClosing` for
 *    the render or two until the sheet's in-place commit picks it up (#614).
 *    The take is on its way to disk either way, so this says the same thing.
 *
 * Like `hooks/save-failure.ts`, the words a translator reads live in
 * `strings.ts`; this picks only which state applies. Lifting the whole gate
 * here — not just the two-way classification — is deliberate: nothing could
 * reach the recorder's JSX, so the mount predicate would otherwise be pinned by
 * nothing (Frank R1). The other half of that — which TONE each branch renders —
 * stayed unpinned for as long, and is now `components/recorder-status.tsx`,
 * rendered by `tests/recorder-status.test.ts` through the #197 harness.
 */
export type RecorderStatusKind = "saving";

export function recorderStatusKind(
  state: RecorderState,
  isClosing: boolean
): RecorderStatusKind | null {
  // `isClosing` spans stop → decode → save. The momentary `processing` nested
  // inside it reads the same, so the two arms collapsed into one at #614: a
  // take that reaches either has ended and is on its way to disk.
  //
  // `processing` with no commit in flight is the #59 interruption, for the
  // render or two before the sheet commits it in place. That used to be its own
  // "interrupted" status telling the translator to tap Back to save it — copy
  // that is now false, because nothing is waiting on them. Deleted rather than
  // reworded: there is no second thing left to say here.
  if (isClosing || state === "processing") return "saving";
  return null;
}
