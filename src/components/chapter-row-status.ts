import type { ChapterPlayState } from "@/hooks/chapter-player";
import type { ChapterId } from "@/types/domain";

/** What one chapter row shows: the player's status, or rest for a row that is
 *  not the chapter in play. */
export type ChapterRowStatus =
  "rest" | "loading" | "playing" | "paused" | "failed";

/**
 * The status the row for `id` shows. Only the chapter the player is about
 * leaves rest; every other row stays at rest while it plays (#1469).
 */
export function chapterRowStatus(
  play: ChapterPlayState,
  id: ChapterId
): ChapterRowStatus {
  if (play.chapterId !== id || play.status === "idle") return "rest";
  return play.status;
}
