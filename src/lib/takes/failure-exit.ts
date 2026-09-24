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
 * ## The second terminal cause: a target that is gone (#607)
 *
 * A second live copy can delete the book while this sheet is open. The write a
 * close tail makes then throws `No such segment`, and no retry can land:
 * segment ids are never reused, so the row the write names will not come back.
 * The answer is to leave AND re-read (`leave-stale`), because the screen behind
 * shows its own stale state for a missing chapter only once it reloads (#597).
 * An unreachable database outranks it: a re-read would fail there too, and the
 * restart `DatabasePanel` offers is what is needed.
 *
 * The caller decides whether its failure was a missing target, with the #597
 * classifier in `lib/storage/stale-target.ts`, and only the close tails can
 * tell today. The erase and load sites pass `false`: their hooks surface a
 * result or a message, not the cause (#378 tracks them).
 *
 * ## What this deliberately does NOT cover
 *
 * Anything that may still succeed. A `blocked` status ends when the other copy
 * closes, and the app is told so (`onUnblocked`), so a retry there is exactly
 * right. A quota or an unknown failure may well succeed on the next tap, and
 * turning it terminal would throw the translator out of the sheet over a
 * transient. Hence two narrow inputs.
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
 * only thing left that works. `leave-stale` — leave with the screen behind
 * marked dirty, so its re-read finds the missing chapter and shows that state.
 */
export type FailureExit = "stay" | "exit" | "leave-stale";

/** What the failing site knows about why its store call failed. */
export interface FailureCause {
  /**
   * This copy has given up its connection and cannot open another
   * (`useDatabaseStatus` is `reloadNeeded`). NOT `blocked`.
   */
  readonly databaseUnreachable: boolean;
  /**
   * The store rejected the write because the segment it names no longer
   * exists (`isMissingSegmentFailure`) — another copy deleted its book.
   */
  readonly targetMissing: boolean;
}

/**
 * @param site which failure is asking — see `RecorderFailureSite`.
 * @param cause both inputs are required, so a site cannot drop one silently.
 */
export function failureExit(
  site: RecorderFailureSite,
  cause: FailureCause
): FailureExit {
  // `site` is accepted and deliberately not branched on. See the header: the
  // defect this replaces was four sites answering separately, so answering them
  // all the same way is the fix, and the parameter is what makes the set of
  // sites a single declared list rather than an emergent one.
  void site;
  if (cause.databaseUnreachable) return "exit";
  return cause.targetMissing ? "leave-stale" : "stay";
}
