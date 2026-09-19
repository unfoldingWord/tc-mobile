/**
 * The words a Share menu shows for each `ShareError` code — for a chapter or a
 * book — as one pure function.
 *
 * Both screens used to map the code inline with a nested ternary that ended in
 * `: null`. That shape is exactly how a new code goes silent: widening
 * `ShareError` (#166 added `encoder`) compiles cleanly and the menu simply shows
 * nothing. A `switch` with a `never` default makes the compiler name every code,
 * and the table below pins what each says, since this repo has no DOM runner to
 * pin the JSX.
 */

import { strings } from "./strings";
import type { ShareError } from "@/hooks/share-flow";
import type { ShareProgress } from "@/hooks/share-progress";

/**
 * The words under the share modal's glyph (#491), for each phase of the
 * progress timeline — secondary text, never the signal.
 *
 * Busy while tap 1 works: the existing preparing line for the scope. Busy
 * while tap 2 works: the sheet is opening. An outcome: `sent` and `dismissed`
 * have their own lines; `partial` (P1, this lane's own review round) reuses
 * `shareSent` — the same honesty-constrained "handed over" sentence, since a
 * partial share still genuinely reached the sheet — followed by the SAME gap
 * sentence the ready-state Notice already shows
 * (`shareMissing`/`shareBookMissing`/`shareBookPartial`/
 * `shareBookMissingAndPartial`), not a new one: one wording for "what did not
 * make it", read here and there. The three error codes keep the SAME words
 * the menu's Notice shows once the flash clears (`shareErrorText`), so the
 * glyph and the menu never disagree. Hidden: nothing. Exhaustive with a
 * `never` default, like the table it extends.
 */
export function shareProgressText(
  progress: ShareProgress,
  scope: "chapter" | "book"
): string | null {
  switch (progress.phase) {
    case "hidden":
      return null;
    case "busy":
      if (progress.work === "send") return strings.shareHandingOver;
      return scope === "chapter"
        ? strings.sharePreparing
        : strings.shareBookPreparing;
    case "outcome":
      switch (progress.settled) {
        case "sent":
          return strings.shareSent;
        case "partial":
          return `${strings.shareSent} ${shareGapText(progress.gap, scope)}`;
        case "dismissed":
          return strings.shareDismissed;
        case "unproven":
          return strings.shareUnproven;
        case "nothing":
        case "failed":
        case "encoder":
          return shareErrorText(progress.settled, scope);
        default: {
          const unhandled: never = progress.settled;
          return unhandled;
        }
      }
    default: {
      const unhandled: never = progress;
      return unhandled;
    }
  }
}

/**
 * The gap sentence — for the outcome glyph's `partial` settle AND for the
 * ready-state gap Notice each screen shows once a share is armed (George r1
 * P3-5, #491): the two used to compose the SAME words twice, inline at each
 * call site, which is exactly the drift `strings.ts`'s own header on
 * `shareBookPartial` warns against — a later tightening of the copy landing
 * in one and not the other. Now genuinely one function, called from both.
 * Chapter scope has only the one grain (`PreparedShare.partial` is never set
 * there — see `share-flow.ts`), so it never reads the finer count.
 */
export function shareGapText(
  gap: { readonly missing: number; readonly partial: number } | undefined,
  scope: "chapter" | "book"
): string {
  const missing = gap?.missing ?? 0;
  const partial = gap?.partial ?? 0;
  if (scope === "chapter") return strings.shareMissing(missing);
  if (missing > 0 && partial > 0)
    return strings.shareBookMissingAndPartial(missing, partial);
  if (missing > 0) return strings.shareBookMissing(missing);
  return strings.shareBookPartial(partial);
}

export function shareErrorText(
  error: ShareError | null,
  scope: "chapter" | "book"
): string | null {
  if (error === null) return null;
  switch (error) {
    case "nothing":
      return scope === "chapter"
        ? strings.shareNothing
        : strings.shareBookNothing;
    case "failed":
      return scope === "chapter"
        ? strings.shareFailed
        : strings.shareBookFailed;
    case "encoder":
      return strings.shareEncoderStopped;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}
