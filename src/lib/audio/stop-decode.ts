/**
 * The pure verdict for what `stop()` returns after it tries to decode a capture
 * (`hooks/use-recorder.ts`). Extracted so the #106/#165 data-loss contract is
 * pinned by a Node test rather than living only in the browser-bound hook, which
 * has no jsdom coverage (George R3 G-3).
 *
 * The load-bearing rule: when the decode THREW, the captured container bytes are
 * KEPT even if the stop was superseded. A `leave()`/pagehide bumping the
 * recorder generation mid-decode is the very #106 interruption most likely to
 * fail the decode, so gating the bytes on "still current" drops the take on
 * exactly the case #165 exists to recover. Re-gate `keepBlob` on `current` and
 * the superseded-throw test dies — that is the mutation this file exists to fail.
 */

import type { CaptureFailure } from "./capture-failure";

/** What the decode produced: usable samples, silence (zero samples), or a throw. */
export type StopDecodeOutcome =
  | { readonly decoded: true; readonly sampleCount: number }
  | { readonly decoded: false };

/**
 * Why `stop()` has no usable samples to show, or null when there is nothing to
 * say — a superseded stop, whose UI belongs to a newer recording.
 *
 * The two DECODE members of {@link CaptureFailure}, narrowed from it rather
 * than spelled again, so this stays a strict subset by construction.
 *
 * Where a rename actually fails, precisely, because the line below still
 * spells the two members and so cannot itself go red (George R1 finding 3):
 * renaming `"silence"` in `CaptureFailure` makes this `Extract` quietly
 * evaluate to `"undecodable"` alone, and the compiler then rejects
 * `classifyStopDecode`'s `error: "silence"` return. The guarantee is real —
 * a rename cannot leave a stale second spelling alive — but it is enforced at
 * the assignment, not here.
 *
 * `"unfinished"` is deliberately outside the subset — nothing about a decode
 * can produce it; it is what `stop()`'s own exits report when the engine never
 * handed the capture over.
 *
 * Local since #169: it was exported for `use-recorder.ts`'s `stopDecodeMessage`,
 * which turned it into a sentence. That function is gone — the hook passes
 * `verdict.error` straight into `StopResult.error`, where the wider
 * {@link CaptureFailure} accepts it — so nothing outside this file names the
 * subset any more, and knip fails an export nothing uses.
 */
type StopDecodeError = Extract<
  CaptureFailure,
  "silence" | "undecodable"
> | null;

export interface StopDecodeVerdict {
  /** Return the decoded samples to the caller (a usable, non-empty decode). */
  readonly emitSamples: boolean;
  /** The message class, withheld (null) when the stop was superseded. */
  readonly error: StopDecodeError;
  /** Keep the captured container bytes for recovery (#165). */
  readonly keepBlob: boolean;
}

export function classifyStopDecode(
  outcome: StopDecodeOutcome,
  current: boolean
): StopDecodeVerdict {
  if (outcome.decoded) {
    if (outcome.sampleCount === 0) {
      // Decoded to silence — no usable take, and a retry of the same bytes cannot
      // help, so the bytes are not worth keeping. Only a current stop earns a
      // message; a superseded one stays silent.
      return {
        emitSamples: false,
        error: current ? "silence" : null,
        keepBlob: false,
      };
    }
    // Usable audio — emitted EVEN WHEN SUPERSEDED; these are confirmed samples and
    // the caller decides what to do with them. Only the shared UI state is withheld.
    return { emitSamples: true, error: null, keepBlob: false };
  }
  // Decode threw — keep the bytes for recovery EVEN WHEN SUPERSEDED (#165 / #106):
  // the interruption that supersedes the stop is the very event most likely to
  // fail the decode. Only the shared message is withheld when a newer owner speaks
  // for the screen.
  return {
    emitSamples: false,
    error: current ? "undecodable" : null,
    keepBlob: true,
  };
}
