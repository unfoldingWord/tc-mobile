/**
 * The paused-take preview's rules, minus React (#101; #160, L-2).
 *
 * While a take is paused, Play sounds the take-so-far spliced into the working
 * buffer where Back will save it. The machinery for that lived entirely inside
 * `recorder.tsx` — two `useState`s, three refs, two callbacks and an effect —
 * which meant Node could not reach any of it: the splice and the peaks pass ran
 * from an event handler, and the transitions were only observable by rendering
 * the sheet. This is the same split `lib/takes/pending-take.ts` already makes
 * for the save: the DECISIONS live here and are tested here; the component
 * keeps the state, the epoch and the effects.
 */

import { mergeTake } from "@/lib/audio/edit";
import { computePeaks } from "@/lib/audio/peaks";
import type { Peaks } from "@/types/audio";

/**
 * What the sheet does about a preview right now.
 *
 * `"none"` covers both "nothing asked for" and "one is prepared" — which of
 * those it is, is the prepared buffer's presence, not this. The two exist
 * separately because a prepared preview OUTLIVES its request: it stays on the
 * stage through the commit so the waveform does not blank (George R3 #1).
 */
export type PreviewState = "none" | "decoding" | "failed";

/** A preview ready to draw and to sound. */
export interface PreparedPreview {
  /** The working buffer with the paused capture spliced in at the insert point. */
  readonly buffer: Int16Array;
  /** Peaks over `buffer`, or null when there is nothing to draw. */
  readonly peaks: Peaks | null;
}

/**
 * Splice a paused take's captured audio into the working buffer and reduce it
 * for the stage — what Play sounds, and what the waveform draws, while paused.
 *
 * `insertAt` is the same offset `close()` will save at, so the preview lands
 * exactly where the take will. Its tail can still differ: the capture keeps
 * growing until Stop.
 *
 * Both steps allocate the whole result and can throw on a low-memory device —
 * the OOM class the save path already guards. The caller turns that into a
 * failed preview rather than leaving Play stuck on `"decoding"`; nothing is
 * caught here, so the throw is the caller's to see.
 *
 * Peaks are null on an EMPTY result rather than an empty `Peaks`: a zero-length
 * buffer has no shape to draw, and `computePeaks` would answer with one bucket
 * of silence — a flat line that reads as recorded audio rather than as nothing.
 */
export function buildPreview(
  working: Int16Array,
  captured: Int16Array,
  insertAt: number,
  bucketCount: number
): PreparedPreview {
  const buffer = mergeTake(working, captured, insertAt);
  const peaks = buffer.length > 0 ? computePeaks(buffer, bucketCount) : null;
  return { buffer, peaks };
}

/**
 * The state left by an exit that invalidates an in-flight decode but keeps any
 * prepared buffer — the ≡ menu, Back, a #59 interruption.
 *
 * A `"decoding"` state goes back to `"none"` because the decode it described is
 * gone. A `"failed"` one STAYS: it is a fact about this device's last attempt,
 * not about the request, and clearing it would re-enable a Play that is about
 * to fail again with no explanation. `"none"` is already where an abort lands.
 */
export function stateAfterAbort(state: PreviewState): PreviewState {
  return state === "decoding" ? "none" : state;
}

/**
 * Whether a prepared preview is what the stage should draw.
 *
 * The window is the whole take-in-flight span, not just `paused`, and each term
 * is a bug that was fixed by adding it:
 *
 *   paused      the preview's own window — Play prepared it, it is sounding.
 *   busy        a commit is running. Dropping the preview here REMOUNTS the
 *               `LiveScope` blank for the whole commit, which reads as the take
 *               having been discarded (George R3 #1).
 *   isClosing   the same, for the close path.
 *
 * At IDLE it is deliberately false: a stale object left behind by a failed
 * close must be inert, not drawn over a stored take. And a resume or re-record
 * discards the prepared buffer outright — the take GREW, so replaying it would
 * sound audio that is no longer the take.
 *
 * A named-field parameter, not three booleans, for the reason
 * `segmentsListInert` gives: three same-typed arguments transpose silently.
 */
export interface TakeInFlight {
  /** The take is paused — the preview's own window. */
  readonly paused: boolean;
  /** A commit is running. */
  readonly busy: boolean;
  /** The sheet is closing. */
  readonly isClosing: boolean;
}

export function previewOnStage(phase: TakeInFlight): boolean {
  return phase.paused || phase.busy || phase.isClosing;
}
