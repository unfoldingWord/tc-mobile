/**
 * What the recorder sheet should do when a store operation fails: stay and let
 * the translator try again, or leave so the screen that can actually help takes
 * over.
 *
 * ## Why this is one function and not four branches
 *
 * `DatabasePanel` is withheld while the recorder is open (`panelWouldLoseAudio`)
 * — deliberately, because mounting it unmounts the sheet and `leave()` cancels a
 * live capture. Once this copy has yielded its connection to another copy's
 * upgrade, `getDb()` is latched: it rejects before it ever opens, identically,
 * for the rest of the page's life. Every failure path inside the sheet was
 * written before there was such a thing as a permanent store failure, so each
 * one answers a retryable question with retryable copy — "Could not clear the
 * audio. Try again." over a call that can never succeed — and the panel that
 * would say what is actually needed cannot mount behind them.
 *
 * Two rounds of review found that same shape at two different sites: the load
 * path (George R5 P3, #450) and the close tails plus erase (George R6 P2). Four
 * call sites, one cause — each site deciding for itself. So the decision is
 * taken away from the sites and made here, once.
 *
 * `RecorderFailureSite` is the enumeration of those four. It does not change the
 * answer today, and that uniformity is the point rather than an oversight: the
 * class was sites disagreeing. What the parameter buys is that a fifth failure
 * path cannot be added without coming here and naming itself, and that a future
 * divergence has to be written down as a divergence.
 *
 * ## What this deliberately does NOT cover
 *
 * Only a PERMANENTLY unreachable database. A `blocked` status is not that — it
 * ends when the other copy closes, and the app is told so (`onUnblocked`), so a
 * retry there is exactly right. Nor a quota or an unknown failure: those may
 * well succeed on the next tap, and turning them terminal would throw the
 * translator out of the sheet over a transient. Hence one narrow input.
 */

/** The four places inside the recorder that a store failure is reported from. */
export type RecorderFailureSite =
  /** A cut-to-empty close, which clears the take (`clearSegmentTake`). */
  | "clear"
  /** A pending Finished toggle written on close (`setSegmentFinished`). */
  | "mark"
  /** The in-sheet erase (`clearSegmentTake` again, from the ≡ menu). */
  | "erase"
  /** The segment's own load, whose panel offers a re-read (#450). */
  | "load";

/**
 * `stay` — keep the sheet up and report in place, which is what every one of
 * these sites did unconditionally before. `exit` — leave, so `recorder` clears
 * in `App` and `DatabasePanel` can finally mount with the restart that is the
 * only thing left that works.
 */
export type FailureExit = "stay" | "exit";

/**
 * @param site which failure is asking — see `RecorderFailureSite`.
 * @param databaseUnreachable this copy has given up its connection and cannot
 *   open another (`useDatabaseStatus` is `reloadNeeded`). NOT `blocked`.
 */
export function failureExit(
  site: RecorderFailureSite,
  databaseUnreachable: boolean
): FailureExit {
  // `site` is accepted and deliberately not branched on. See the header: the
  // defect this replaces was four sites answering separately, so answering them
  // all the same way is the fix, and the parameter is what makes the set of
  // sites a single declared list rather than an emergent one.
  void site;
  return databaseUnreachable ? "exit" : "stay";
}
