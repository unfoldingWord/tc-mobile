/**
 * When a newly created row is scrolled to, and when focus is handed into it —
 * the decision alone, so it can be a truth table rather than a phone (#160
 * L-15).
 *
 * Both list screens create rows the translator cannot see yet: Books creates a
 * book or a chapter, Segments appends a segment. The row is not in the DOM on
 * the commit that starts the create, so each screen arms an id and reveals it
 * from an effect once the list includes it.
 *
 * Scroll and focus are NOT the same decision, and that asymmetry is the whole
 * reason this file exists:
 *
 * - **A scroll always runs.** `scrollIntoView` works on an element inside an
 *   `inert` subtree, so there is nothing to wait for.
 * - **A focus may have to wait.** An element inside an `inert` subtree cannot
 *   take focus at all, so `.focus()` there is a silent no-op — and, worse, it
 *   CONSUMES the armed target, so the hand-off is lost for good rather than
 *   deferred. That is #364, and `docs/progress_tracker.md` records the lesson
 *   in one line: *"a focus fix that ignores `inert` is dead code"*. Books holds
 *   the hand-off while its delete confirm is up for exactly this reason.
 *
 * Expressed as a plan rather than as a pair of calls, "held ⇒ retained, never
 * consumed" is a line a mutation kills (`tests/pending-reveal.test.ts`) instead
 * of a claim in a comment. It takes ids and a boolean, never elements, so it
 * stays inside `lib/`'s DOM ban and runs in the Node-only suite. The half that
 * reads the DOM and calls `scrollIntoView` / `.focus()` is
 * `hooks/use-scroll-to-new.ts`, and that half has no automated coverage
 * anywhere in this repo (the same gap as #361) — it is review and on-device
 * surface, and is not claimed as tested.
 */

/** What a screen has armed but not yet revealed. `null` is "nothing armed". */
export interface PendingReveal<Id> {
  readonly scroll: Id | null;
  readonly focus: Id | null;
}

export interface RevealPlan<Id> {
  /** Scroll this row into view now. `null` scrolls nothing. */
  readonly scroll: Id | null;
  /** Hand focus into this row now. `null` focuses nothing. */
  readonly focus: Id | null;
  /** What stays armed for a later commit. Both halves are consumed by default. */
  readonly rest: PendingReveal<Id>;
}

/**
 * Split what is armed into what runs now and what stays armed.
 *
 * @param pending what the screen has armed.
 * @param focusHeld the row that would take focus is unreachable on this commit
 *   — in practice, it is inside a subtree this screen has marked `inert`. The
 *   armed target is kept, not spent: the caller's effect runs again on the
 *   render that lifts `inert` (which is why that flag belongs in its deps), and
 *   the hand-off happens then.
 */
export function planReveal<Id>(
  pending: PendingReveal<Id>,
  focusHeld: boolean
): RevealPlan<Id> {
  // A scroll is never held: an inert subtree still scrolls, and holding one
  // would leave the new row off-screen for as long as an overlay is up.
  const focusNow = focusHeld ? null : pending.focus;
  return {
    scroll: pending.scroll,
    focus: focusNow,
    rest: {
      scroll: null,
      // Retained, not consumed — the #364 line. `focusHeld` with nothing armed
      // is still `null`, so a hold cannot invent a target either.
      focus: focusHeld ? pending.focus : null,
    },
  };
}
