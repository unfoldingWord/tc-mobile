/**
 * Whether the Segments screen's own header and list must go `inert` because an
 * overlay is covering them (G8: `aria-modal` alone is not trusted to hide the
 * background, and every overlay on this screen is portalled out, so it stays
 * reachable while the content behind it does not).
 *
 * **Why this is a function and not four `||`s inline** (#452 PR4, Frank R1
 * P2-1). This predicate is what the design's Amendment C decision (b) rests on:
 * the Record control that starts the Segments → Recorder transition sits inside
 * the subtree this inerts, which is why `dismissOverlays()` is allowed to leave
 * an in-flight erase confirm standing rather than tearing it down over a
 * committing `clearSegmentTake` (`segments-screen.tsx`). A term dropped from it
 * is not a rendering nit — it is that argument silently becoming false.
 *
 * Inline in the JSX it had no Node-testable surface at all, and the only
 * automated evidence was one headless case that opens the chapter ≡ menu — so
 * the `eraseConfirmOpen` term the decision actually turns on could have been
 * deleted with every gate green. Here each term is one row.
 *
 * **What the table below is worth, stated plainly:** the operator is a
 * disjunction and nobody needed a test for that. What it pins is the SET —
 * that these four conditions, and no fewer, cover the content. Drop a term and
 * its row dies.
 *
 * **What it is NOT.** It says nothing about the value reaching the DOM. That
 * half is `segments-screen.tsx`'s wiring, which has no renderer in this repo's
 * Node suite (AGENTS.md) and is observed once, for one term, by
 * `e2e/back-navigation.spec.ts` case (m) in real Chromium. The two compose —
 * one `listInert` value feeds both `inert` props, so a branch proved to reach
 * the DOM proves the path for every term — but composition is the claim, not a
 * direct observation of the erase-confirm branch, which needs a RECORDED row
 * and so needs audio Playwright does not have.
 */
export interface SegmentsOverlayState {
  /** The erase confirm is armed for a row — including while its erase runs. */
  readonly eraseConfirmOpen: boolean;
  /** A row's overflow menu is open (only one ever is). */
  readonly rowMenuOpen: boolean;
  /** The chapter ≡ menu is open, in either its action-list or rename mode. */
  readonly chapterMenuOpen: boolean;
  /**
   * The share modal owns the screen — its whole timeline, busy hold and outcome
   * hold alike, which outlives `chapterMenuOpen` (#491).
   */
  readonly shareOwnsScreen: boolean;
}

/**
 * A named-field parameter rather than four positional booleans, deliberately:
 * four same-typed arguments transpose silently, and a transposition here is a
 * screen that inerts on the wrong condition with `tsc` none the wiser.
 */
export function segmentsListInert(open: SegmentsOverlayState): boolean {
  return (
    open.eraseConfirmOpen ||
    open.rowMenuOpen ||
    open.chapterMenuOpen ||
    open.shareOwnsScreen
  );
}
