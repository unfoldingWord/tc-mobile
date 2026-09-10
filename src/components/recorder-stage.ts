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
   * Deliberately **not** read by {@link liveScopeShown}. The first #283 fix
   * gated the frozen arm on it (`!hasAudio && (paused || …)`), which made an
   * append SWAP `LiveScope`→`Waveform` at the recording→paused/close edge:
   * `Waveform` paints in `useEffect`, so the stage flashed blank then showed the
   * pre-take clip (Model A does not splice the take into `working` until close),
   * reading as "pause discarded my take" — the "read as discarded" class the
   * first-take `isClosing` clause exists to prevent (George R1 P2). Kept as an
   * input so the tests can pin that prior audio never changes the outcome.
   */
  hasAudio: boolean;
  /** The mic tap could not be wired — no live scope data to draw. */
  meterFailed: boolean;
  /** A prepared whole-buffer preview is up (`previewShown !== null`). */
  previewShown: boolean;
}

/**
 * Whether the dedicated live scope (vs. the `Waveform` path) drives the record
 * stage.
 *
 * - A failed tap or a prepared preview always wins the stage — no live scope.
 * - Otherwise the live scope drives the **whole take-in-flight window**
 *   (recording, paused, processing, and the F8 close) for a first take **and an
 *   append (#283)**, growing while `recording` and freezing on its last frame
 *   otherwise. Before #283 an append fell to `Waveform` for the whole take, so a
 *   second take showed the VU moving but no waveform growing until the segment
 *   was left and re-entered.
 *
 * `hasAudio` is intentionally absent from the logic — see {@link StageState}.
 * Treating an append exactly like a first take is both the behaviour #283 asked
 * for ("the same way it renders during the first take") and what avoids the
 * pause/close swap-and-flash that gating the frozen arm on `hasAudio` caused.
 *
 * Tradeoff: while an append is in flight this shows the head-growing (then
 * frozen) live scope in place of the existing clip; the clip returns once the
 * take commits. For the default end-append that reads naturally; for a mid-clip
 * insert it shows the take without the surrounding clip / insert position.
 * Preserving the existing clip *and* live growth together (a composed view) is a
 * larger change tracked separately if wanted.
 */
export function liveScopeShown(s: StageState): boolean {
  if (s.meterFailed || s.previewShown) return false;
  return s.recording || s.paused || s.processing || s.isClosing;
}
