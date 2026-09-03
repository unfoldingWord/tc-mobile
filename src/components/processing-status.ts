import type { RecorderState } from "@/hooks/use-recorder";

/**
 * Which status the recorder shows in the window between a take being confirmed
 * and its audio reaching the database — or null when there is nothing to say.
 *
 * #39: that window drew no record dot, no timer and no copy. There are two ways
 * into it, and — this is the subtlety Frank/George's round 1 caught — the
 * `processing` state does NOT span the whole of the first one:
 *
 *  - **The normal commit.** Back is tapped, then stop → decode → the multi-MB
 *    IndexedDB `saveTake`. `use-recorder` flips state from `processing` back to
 *    `idle` the instant decode finishes, BEFORE `stop()` returns, while
 *    `close()` is still awaiting the write. So `isClosing` — set for the whole
 *    of `close()` — is what spans the commit; gating on `state === "processing"`
 *    dropped the status before the slow part (the write) even began.
 *  - **The #59 interruption.** The mic is lost mid-take and the take freezes
 *    into `processing` with no Back tapped yet, held in memory until one saves
 *    it. Here there is no `close()` in flight, so `!isClosing`.
 *
 * Like `hooks/save-failure.ts`, the words a translator reads live in
 * `strings.ts`; this picks only which state applies. Lifting the whole gate
 * here — not just the two-way classification — is deliberate: the recorder's
 * JSX has no test runner in this repo, so the mount predicate would otherwise
 * be pinned by nothing (Frank R1).
 */
export type RecorderStatusKind = "saving" | "interrupted";

export function recorderStatusKind(
  state: RecorderState,
  isClosing: boolean
): RecorderStatusKind | null {
  // `isClosing` spans stop → decode → save, so it wins over the momentary
  // `processing` nested inside it: a committing take is "saving", never
  // "interrupted", whatever `state` reads at the instant of the render.
  if (isClosing) return "saving";
  // `processing` with no close in flight is reachable only through the #59
  // interruption path — the frozen take waiting to be closed, which saves it.
  // This is NOT an error state: the recording is safe, so its Notice takes the
  // `info` tone (a done heads-up), never the red `alert` nor the `busy` wait.
  if (state === "processing") return "interrupted";
  return null;
}
