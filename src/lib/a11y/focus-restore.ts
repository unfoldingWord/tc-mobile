/**
 * Where focus goes when an overlay closes (#97) — the decision alone, so it can
 * be a truth table rather than a phone.
 *
 * The first attempt at this (pulled from #96) failed because it did not compose
 * with this app's `inert` model. Two orderings are the whole issue, and a
 * correct mechanism has to get both right:
 *
 * 1. **Capture at the tap, not in an effect.** Adding `inert` to a subtree
 *    blurs whatever is focused inside it to `<body>` during the MUTATION phase,
 *    before any passive effect runs. A hook that read `document.activeElement`
 *    on the open edge therefore captured `body` for every trigger that sits in
 *    a subtree that goes inert on open — which, in this app, is all of them.
 * 2. **Restore after `inert` lifts.** An element inside an inert subtree cannot
 *    take focus, so `.focus()` there is a silent no-op that looks like a fix.
 *    `docs/progress_tracker.md`: *"a focus fix that ignores `inert` is dead
 *    code"* — and #364 is that same defect landing again on the Books screen.
 *
 * This module owns half 2, expressed as a decision rather than as a call, so
 * that "still inert ⇒ never the previous element" is a line a mutation kills
 * rather than a claim in a comment.
 *
 * It takes booleans, never elements: that keeps it inside `lib/`'s DOM ban and
 * lets the table run in the Node-only suite. The half that reads the DOM and
 * calls `.focus()` is `hooks/use-focus-restore.ts`, and that half has no
 * automated coverage anywhere in this repo (#361) — it is review and on-device
 * surface, and is not claimed as tested.
 */

/**
 * - `previous` — focus the element captured when the overlay opened.
 * - `fallback` — focus the caller's named landmark instead.
 * - `none` — focus nothing, and leave whatever has it alone.
 */
type FocusRestore = "previous" | "fallback" | "none";

interface FocusRestoreInput {
  /**
   * The open edge captured a trigger. False when nothing was focused at open —
   * a touch user, whose `document.activeElement` is `<body>`.
   */
  readonly captured: boolean;
  /**
   * Another surface has deliberately taken focus in the same commit that closed
   * the overlay — in the recorder, one of the full-body panels and its
   * `autoFocus`ed control. The capture is still consumed; it is simply not
   * used, so a later close cannot resurrect a trigger the translator left long
   * ago.
   */
  readonly suppressed: boolean;
  /** The captured element is still in the document. */
  readonly connected: boolean;
  /**
   * The captured element is still inside an `inert` subtree, where `.focus()`
   * cannot land. The reason this function exists.
   */
  readonly inert: boolean;
  /**
   * The captured element can still take focus at all — chiefly, it has not gone
   * natively `disabled` since it was tapped (the recorder's ≡ opener does
   * exactly that while `denied`). An `aria-disabled` control is deliberately
   * still focusable here, as it is everywhere else in this app (#135).
   */
  readonly focusable: boolean;
  /** The caller supplied a landmark to fall back to. */
  readonly hasFallback: boolean;
}

export function focusRestoreTarget(input: FocusRestoreInput): FocusRestore {
  // Nothing was taken, so nothing is restored — not even to the fallback.
  // Inventing a focus ring for a touch user who never had one is a state
  // change, not a repair.
  if (!input.captured) return "none";
  // Someone else owns focus on purpose. Consume and stand down.
  if (input.suppressed) return "none";
  // The only path that returns the trigger. `!inert` is the guard the whole
  // cluster exists for: drop it and every one of these decisions still "works"
  // while the resulting `.focus()` does nothing.
  if (input.connected && input.focusable && !input.inert) return "previous";
  // Alive but unreachable, or gone. A named landmark beats the document.
  return input.hasFallback ? "fallback" : "none";
}
