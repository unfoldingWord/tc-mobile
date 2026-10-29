/**
 * The states the style-diff verdict may see unsettled without failing (#954).
 *
 * The DRI's pick on #954, verbatim: "Named tolerated list (Recommended)". A
 * state goes on this list only when what the spec does at that step keeps the
 * page changing by nature, and each entry says why in one line. Every other
 * unsettled state still fails the verdict. `diffRuns` in `diff.ts` reads the
 * list and reports, besides the states it tolerated:
 *   - a listed state that settled, as a stale tolerance. For an entry whose
 *     `settles` is "never", that fails the verdict, so the list stays exact.
 *     For "sometimes", it is printed as a warning and does not fail;
 *   - a listed state that a run did not capture at all, which fails, so a
 *     renamed test or a moved step cannot leave a dead entry behind.
 *
 * Each entry is keyed the way the report names a state: the capture's test id
 * (`<project> | <title path>`) and the state's own key
 * (`<ordinal> p<page> <action>`). Both are fixed by the spec's steps, not by
 * timing, so a key reads the same in every run.
 */

export interface ToleratedState {
  /** The capture's test id: `<project> | <title path>`. */
  test: string;
  /** The state's key within that test: `<ordinal> p<page> <action>`. */
  state: string;
  /** Why it cannot settle, in one line. */
  reason: string;
  /**
   * "never": the page keeps changing for as long as the step lasts, so a
   * settled read means the entry is stale. "sometimes": the step's own motion
   * ends right at the capture's DOM bound, so it settles in some runs and not
   * in others, and a settled read is only a warning.
   */
  settles: "never" | "sometimes";
}

const SHIPPED = "chromium-shipped-build";

export const TOLERATED: readonly ToleratedState[] = [
  {
    test: `${SHIPPED} | a Stop after Play from a mid-take line leaves the line past where it started (#361)`,
    state: "012 p0 locator.click",
    reason:
      "Play: playhead-overlay.tsx moves the line every frame while the take plays",
    settles: "never",
  },
  {
    test: `${SHIPPED} | a Stop after Play from a mid-take line leaves the line past where it started (#361)`,
    state: "016 p0 locator.click",
    reason:
      "Play after Edit: playhead-overlay.tsx moves the line every frame while the take plays",
    settles: "never",
  },
  {
    test: `${SHIPPED} | an audition of a picked span draws its playhead inside the band (#361)`,
    state: "135 p0 locator.click",
    reason:
      "Play the selection: playhead-overlay.tsx moves the line every frame while the span plays",
    settles: "never",
  },
  {
    test: `${SHIPPED} | while Play sounds, the paste marker and the bin leave and Zoom greys (#361)`,
    state: "014 p0 locator.click",
    reason:
      "Play: playhead-overlay.tsx moves the line every frame while the take plays",
    settles: "never",
  },
  {
    test: "chromium-back-navigation | (a) a failed-save exit while a goBack is in flight absorbs that Back's landing rather than issuing a second back() (#763)",
    state: "010 p0 locator.click",
    reason:
      "Close recorder, clicked while the take started at 009 records: the live level display redraws every frame",
    settles: "never",
  },
  {
    test: `${SHIPPED} | a short drag springs the sheet back and leaves it open`,
    state: "006 p0 mouse.up",
    reason:
      "the release's spring-back mutates the panel at 0 and 200 ms (SHEET_SETTLE_MS, menu.tsx), so 100 ms quiet ends at the 300 ms DOM bound",
    settles: "sometimes",
  },
];
