/**
 * The words a screen shows for each `CaptureFailure` code, as one pure
 * function.
 *
 * Built the way `shareErrorText` is, and for the reason that module records:
 * a `switch` with a `never` default makes the compiler name every code, where
 * the ternary-ending-in-`: null` shape this replaces is exactly how a new code
 * goes silent — widening the union compiles cleanly and the Notice simply
 * shows nothing.
 *
 * It exists at all because the three producers used to mint their own
 * sentences down in `hooks/` (#169). Two of them wrote the SAME sentence in
 * two files, with nothing tying them together; now they write the same code
 * and this is the only place the sentence is chosen.
 */

import { strings } from "./strings";
import type { CaptureFailure } from "@/lib/audio/capture-failure";

/**
 * Null in, null out — the superseded stop, whose UI belongs to a newer
 * recording, so the caller can pass a `StopResult.error` straight through
 * without re-testing it.
 *
 * Overloaded rather than always-nullable because two callers have already
 * proved the code present: `classifyCapture`'s `notice` verdict and
 * `planClose`'s `stay` action both carry a non-null `CaptureFailure`, and
 * `stayOpen` wants a sentence, not a maybe. Without the first signature each
 * would need a `?? ""` or a non-null assertion at the call site — a fallback
 * that can only ever paint an empty Notice on a sheet that stayed open
 * precisely because it had something to say.
 */
export function captureFailureText(failure: CaptureFailure): string;
export function captureFailureText(
  failure: CaptureFailure | null
): string | null;
export function captureFailureText(
  failure: CaptureFailure | null
): string | null {
  if (failure === null) return null;
  switch (failure) {
    case "silence":
      return strings.captureSilence;
    case "undecodable":
      return strings.captureUndecodable;
    case "unfinished":
      return strings.captureUnfinished;
    default: {
      const unhandled: never = failure;
      return unhandled;
    }
  }
}
