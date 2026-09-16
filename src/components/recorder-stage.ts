/**
 * The record stage's one branch, lifted out of the JSX so it can be tested in
 * Node without a canvas (#283). It decides whether the dedicated {@link
 * LiveScope} drives the stage, or the {@link Waveform} path does.
 *
 * `LiveScope` is a pull-model drawer that grows the take-in-flight from the head
 * (#120) and, when frozen (`active` false), holds its last frame; `Waveform`
 * draws stored/preview peaks with the #110 record centerline. The rule below is
 * the whole reason the two coexist.
 */

/** The record-stage inputs this decision reads, all already-derived booleans. */
export interface StageState {
  /** `state === "recording"` — the mic is actively capturing. */
  recording: boolean;
  /** `state === "paused"`. */
  paused: boolean;
  /** `state === "processing"` — a #59 interruption's decode, or an F8 decode. */
  processing: boolean;
  /** The F8 close window (`stop()` flipped to idle, PCM not yet in `working`). */
  isClosing: boolean;
  /**
   * `length > 0` — the segment already holds audio, so this take is an append.
   *
   * **Not** read by the recording/frozen half of {@link liveScopeShown}. The
   * first #283 fix gated the frozen arm on it (`!hasAudio && (paused || …)`),
   * which made an append SWAP `LiveScope`→`Waveform` at the recording→
   * paused/close edge: `Waveform` paints in `useEffect`, so the stage flashed
   * blank then showed the pre-take clip (Model A does not splice the take into
   * `working` until close), reading as "pause discarded my take" — the "read
   * as discarded" class the first-take `isClosing` clause exists to prevent
   * (George R1 P2). Kept as an input so the tests can pin that prior audio
   * never changes that half of the outcome.
   *
   * It IS read by the `previewShown` half (George R-resume P2, on rebasing
   * onto #366's display-gain fit): a first take's Pause+Play preview is meant
   * to win the stage (its `Waveform` draws absolute, matching the `LiveScope`
   * it replaces, because `isFirstTakeInFlight` is true when `hasAudio` is
   * false). An append's Pause+Play preview must NOT — its `Waveform` would
   * draw the merged buffer FITTED (`isFirstTakeInFlight` is false once
   * `hasAudio` is true), a scale jump off the absolute `LiveScope` the append
   * was just growing on, on top of `Waveform`'s `useEffect` blank-first-frame.
   * So an append keeps `LiveScope` through a preview too — see
   * {@link liveScopeShown}'s second guard.
   */
  hasAudio: boolean;
  /** The mic tap could not be wired — no live scope data to draw. */
  meterFailed: boolean;
  /**
   * A prepared whole-buffer preview is up (`previewShown !== null`). Wins the
   * stage for a FIRST take only — see {@link hasAudio}'s second paragraph.
   */
  previewShown: boolean;
}

/**
 * Whether the dedicated live scope (vs. the `Waveform` path) drives the record
 * stage.
 *
 * - A failed tap always wins the stage — no live scope data to draw.
 * - A prepared whole-buffer preview wins the stage only for a FIRST take
 *   (`!hasAudio`). An append's preview stays on `LiveScope` (George R-resume
 *   P2) — see {@link StageState.hasAudio}'s second paragraph for why letting
 *   it win there reintroduces a scale jump and a blank first frame.
 * - Otherwise the live scope drives the **whole take-in-flight window**
 *   (recording, paused, processing, and the F8 close) for a first take **and an
 *   append (#283)**, growing while `recording` and freezing on its last frame
 *   otherwise. Before #283 an append fell to `Waveform` for the whole take, so a
 *   second take showed the VU moving but no waveform growing until the segment
 *   was left and re-entered.
 *
 * `hasAudio` does not gate the recording/frozen half of this rule — see
 * {@link StageState}. Treating an append exactly like a first take there is
 * both the behaviour #283 asked for ("the same way it renders during the first
 * take") and what avoids the pause/close swap-and-flash that gating the frozen
 * arm on `hasAudio` caused.
 *
 * Tradeoff: while an append is in flight (including its preview) this shows
 * the head-growing (then frozen) live scope in place of the existing clip; the
 * clip returns once the take commits. For the default end-append that reads
 * naturally; for a mid-clip insert it shows the take without the surrounding
 * clip / insert position. Preserving the existing clip *and* live growth
 * together (a composed view) is a larger change tracked separately if wanted.
 * A caller that mounts `LiveScope` on the strength of this predicate must also
 * suppress anything keyed to the merged-preview view (e.g. `PlayheadOverlay`)
 * while it is true and a preview is playing — see the recorder call site.
 */
export function liveScopeShown(s: StageState): boolean {
  if (s.meterFailed) return false;
  if (s.previewShown && !s.hasAudio) return false;
  return s.recording || s.paused || s.processing || s.isClosing;
}
