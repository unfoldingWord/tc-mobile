/**
 * Pure derivations over a Segments row, and the resolution its waveform is
 * drawn at.
 *
 * These lived in `src/types/view.ts` beside the shapes they read, which put
 * runtime code in the one layer `eslint.config.mjs` defines as "Domain types
 * (no internal dependencies)" and `tsconfig.lib.json` compiles as erasable
 * (audit finding L-17, #160). The shapes stayed there; the behaviour is here.
 * `tests/types-erasable.test.ts` is what keeps the split from drifting back.
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
