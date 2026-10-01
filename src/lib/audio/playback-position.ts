/**
 * Where buffer playback is — and whether that is a position anything actually
 * MEASURED (George R4 P1).
 *
 * Playback is started optimistically: the sounding flag flips inside the tap so
 * the control answers the finger rather than the graph, and the real handle
 * arrives only after a context resume, a synchronous whole-clip AudioBuffer
 * fill (~600 `copyToChannel` calls for ten minutes, #175) and a yielded task —
 * a window that grows with the clip and that `audio-io.ts` yields precisely so
 * a tap landing in it is handled before the source starts. For that window
 * there is a sounding claim but no clock.
 *
 * The defect this exists to close is what a single number did in that window.
 * The boundary answered `0`, and two consumers read it as two different claims:
 * the playhead overlay as "draw the line at the start of the range", which is
 * true, and the recorder's freeze as "playback reached this sample", which is
 * an assumption — and the freeze writes `panState`, which is also the record
 * insertion offset (#61, F9). A Pause or a #317 finger landing in that window
 * therefore turned the default Play from the F7 append rest into a punch-in at
 * sample 0. Round 2 had already closed the same class on the `playSamples`
 * throw path; this is the arm that a stop could still reach, which is why the
 * DRI sent round 5 at the class rather than at the symptom.
 *
 * So the answer carries its own provenance, and each consumer takes the half it
 * is entitled to: draw from `ms`, remember only when `measured`.
 *
 * Pure and DOM-free (the `hooks/` layer owns the refs and the handle), so the
 * rule is a test rather than a phone.
 */
export interface PlaybackPosition {
  /** Milliseconds into the buffer that was handed to the player. */
  readonly ms: number;
  /**
   * A real playback handle produced `ms`. `false` means "sounding, but not
   * started yet" — the position is this module's assumption, not the graph's.
   */
  readonly measured: boolean;
}

/**
 * @param elapsedMs the handle's own position, or `null` when there is no handle
 * @param sounding a playback claim is live (the optimistic flag)
 * @returns the position, or `null` — the HIDE sentinel, distinct from 0
 */
export function playbackPosition(
  elapsedMs: number | null,
  sounding: boolean
): PlaybackPosition | null {
  // A handle that reports 0 IS measured: the gate is "did the graph answer",
  // never "is the number nonzero". Reading it the other way would leave a real
  // stop in a play's first frame unable to freeze.
  if (elapsedMs !== null) return { ms: elapsedMs, measured: true };
  return sounding ? { ms: 0, measured: false } : null;
}
