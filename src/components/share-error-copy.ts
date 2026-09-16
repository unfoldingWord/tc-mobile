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
