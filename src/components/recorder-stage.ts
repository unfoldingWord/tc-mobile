/**
 * The record stage's one branch, lifted out of the JSX so it can be tested in
 * Node without a canvas (#283). It decides whether the dedicated {@link
 * LiveScope} drives the stage, or the {@link Waveform} path does.
 *
 * `LiveScope` is a pull-model drawer that grows the take-in-flight from the head
 * (#120); `Waveform` draws stored/preview peaks with the #110 record centerline
 * over any existing clip. The rule below is the whole reason the two coexist.
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
  /** `length > 0` — the segment already holds audio, so this take is an append. */
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
 * - **Actively recording always shows the live scope — a first take OR an
 *   append (#283).** Before this, `hasAudio` routed every append to `Waveform`,
 *   so a second take on a segment that already had audio showed the VU moving
 *   but no waveform growing until the translator left the segment and came back:
 *   capture was fine (the audio was there on re-entry), but nothing on screen
 *   said so — disorienting in the field.
 * - The frozen take-in-flight states (paused / processing / the F8 close) keep
 *   the live scope only for a FIRST take. There, without it the frozen take
 *   snapped back to the empty dotted rule for the multi-MB IndexedDB write and
 *   read as discarded (the `isClosing` clause, George R2/R4). An append in those
 *   same states stays on `Waveform` instead, so the existing clip and the #110
 *   insert centerline remain visible while it commits.
 *
 * Note: while an append records, this shows the head-growing live scope in place
 * of the existing clip; the clip returns on pause/stop. For the default
 * end-append that reads naturally; for a mid-clip insert it shows growth without
 * the insert position. Preserving the existing clip *and* live growth together
 * (a composed view) is a larger change tracked separately if wanted.
 */
export function liveScopeShown(s: StageState): boolean {
  if (s.meterFailed || s.previewShown) return false;
  if (s.recording) return true;
  return !s.hasAudio && (s.paused || s.processing || s.isClosing);
}
