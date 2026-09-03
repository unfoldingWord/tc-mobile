/**
 * Which status the recorder shows while it sits in `processing` — the window
 * between a take being confirmed and its PCM reaching the database.
 *
 * #39: before this, `processing` drew no record dot, no timer and no copy. On
 * the normal commit path that window is the stop → decode → save wait, which on
 * a slow phone leaves a frozen waveform beside nothing saying work is in
 * progress. On the #59 interruption path the take freezes into `processing`
 * with no auto-progress at all — the mic was lost mid-take, the captured audio
 * is held in memory, and it is saved only when the translator taps Back — so a
 * silent screen there reads as a dead app over a recording that is actually
 * safe.
 *
 * Like `hooks/save-failure.ts`, this is the classifier only: it picks which of
 * two states applies, never the words. The words a translator reads live in
 * `strings.ts` — the recorder maps the kind to them.
 *
 * Two ways into `processing`, told apart by whether Back has been tapped:
 *  - `"saving"` — Back was tapped (`isClosing`); the sheet is committing. An
 *    in-progress status.
 *  - `"interrupted"` — the mic was lost mid-take (#59) and the frozen take is
 *    waiting on a Back the translator has not tapped. A settled status that
 *    points at the exit which saves it.
 */
export type ProcessingStatusKind = "saving" | "interrupted";

export function processingStatusKind(isClosing: boolean): ProcessingStatusKind {
  return isClosing ? "saving" : "interrupted";
}
