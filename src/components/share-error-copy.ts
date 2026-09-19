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
 * have their own lines; the three error codes keep the SAME words the menu's
 * Notice shows once the flash clears (`shareErrorText`), so the glyph and the
 * menu never disagree. Hidden: nothing. Exhaustive with a `never` default,
 * like the table it extends.
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
        case "dismissed":
          return strings.shareDismissed;
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
