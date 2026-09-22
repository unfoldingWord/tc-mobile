/**
 * Derivations over a Segments row (B3), and the resolution its waveform is
 * drawn at.
 *
 * The shapes these read — `SegmentRow`, `SegmentRowState` — stay in
 * `types/view.ts`. The functions and the constant live here because `types/` is
 * declared "domain types, no internal dependencies" (`eslint.config.mjs`, the
 * onion header) and is compiled with no DOM lib as the innermost layer: a
 * module that emits runtime code is not that, however small the code is. It
 * also put a function where no caller would look for one — `segmentRowState`
 * was imported from `@/types/...` by a component (#160, L-17).
 *
 * `tests/types-erasable.test.ts` is what now holds `types/` to that, by
 * transpiling each of its modules and asserting the emit is empty.
 */

import type { SegmentRow, SegmentRowState } from "@/types/view";

/**
 * Waveform resolution of a Segments row, in min/max buckets.
 *
 * Shared between the row loader (which computes peaks from a PCM clip) and the
 * Finished transcode (which computes them from the PCM it is about to drop and
 * stores them on the MP3 clip, B8) — so a finished row draws from stored peaks
 * at exactly the resolution a PCM row is drawn at, and the two never diverge.
 */
export const ROW_PEAK_BUCKETS = 120;

/**
 * The three row states of mockup 2, derived clip-presence-first (F3):
 * a dangling/undecodable clip renders as "empty" so re-record is the only
 * offer, never a finished-looking row with no audio behind it.
 */
export function segmentRowState(row: SegmentRow): SegmentRowState {
  if (!row.hasClip) return "empty"; // no status glyph, flat line, red record
  return row.finished ? "finished" : "recorded"; // green check + green wave / amber wave, play
}

/**
 * F5 scroll target: where a returning user lands. Replaces `firstUnrecorded`
 * — the pivot lands on the first *not finished* segment, not the first with no
 * audio. All finished ⇒ null (caller scrolls to top).
 */
export function firstNotFinished(
  rows: readonly SegmentRow[]
): SegmentRow | null {
  return rows.find((r) => !r.finished) ?? null;
}
