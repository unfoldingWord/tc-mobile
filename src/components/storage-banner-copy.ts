import { strings } from "@/lib/strings";
import type { UseLibraryShare } from "@/hooks/use-library-share";

/**
 * What the O4 storage banner's "Share your work" button (#983, #948 D14) says
 * about the library share's codes and its gap.
 *
 * Its own table rather than `share-error-copy.ts`'s, because that one keys
 * on a closed `"book" | "chapter"` scope and wording is not all that
 * differs: the library share adds a `"storage"` refusal (#987), and its gap
 * is a `LibraryShareGap` in books and chapters, which `shareGapText` cannot
 * take by type (`use-library-share.ts`).
 */
export function libraryShareErrorText(
  error: UseLibraryShare["error"]
): string | null {
  if (error === null) return null;
  switch (error) {
    case "nothing":
      return strings.shareAllNothing;
    case "failed":
      return strings.shareAllFailed;
    case "storage":
      return strings.shareAllStorage;
    // The encoder is the problem, not what was shared: the same line Share
    // Book and Share Chapter use (#166).
    case "encoder":
      return strings.shareEncoderStopped;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * What an armed archive left out, or `null` when it holds everything. Whole
 * books first, then the chapters inside included books that did not ship
 * whole, each a whole sentence from the table.
 */
export function libraryShareGapText(
  missingBooks: number,
  incompleteChapters: number
): string | null {
  const parts: string[] = [];
  if (missingBooks > 0) parts.push(strings.shareAllMissing(missingBooks));
  if (incompleteChapters > 0)
    parts.push(strings.shareAllIncomplete(incompleteChapters));
  return parts.length > 0 ? parts.join(" ") : null;
}
