/**
 * The words the Books shelf's failure Notice speaks, in a DOM-free function so
 * the choice is pinned by a test rather than by a ternary in JSX (the reason
 * `encoder-notice.ts` and `storage-pressure-notice.ts` are lifted out too).
 *
 * `deleteFailed` relabels the hook's current failure in the delete's own words
 * — except when that failure is `noRoom`. A full disk is the one condition a
 * translator can act on, and every other write names it the same way, so a
 * failed delete does too (#894; DRI pick 2026-09-28: "Show the phone-full
 * sentence (Recommended)").
 */

import { strings } from "@/lib/strings";
import type { FailureKey } from "@/hooks/save-failure";

export function shelfNoticeText(
  error: FailureKey | null,
  deleteFailed: boolean
): string | null {
  if (error === null) return null;
  if (deleteFailed && error !== "noRoom") return strings.deleteBookFailed;
  return strings[error];
}
