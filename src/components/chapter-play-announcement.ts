import { useCallback, useState } from "react";

import type { ChapterPlayState } from "@/hooks/chapter-player";
import { useChapterHeading } from "@/hooks/use-settings";
import { strings } from "@/lib/strings";
import type { BookCard } from "@/types/view";

/**
 * The line the chapter-play status says for one change of the player's
 * state, or null when the change says nothing new (#1344).
 *
 * - started: the chapter is sounding, not merely reading its playlist, so a
 *   play that fails while it loads says only that it failed;
 * - paused: from a tap, or from the page being hidden (the hide path calls
 *   the same pause);
 * - failed: the control's own failed sentence (`chapterPlayFailed`);
 * - finished: a playing chapter went idle on its own. A stop the screen asked
 *   for (`hushed`) says nothing, and nor does a load that went idle.
 */
function lineFor(
  prev: ChapterPlayState,
  next: ChapterPlayState,
  hushed: boolean,
  heading: string
): string | null {
  const same = prev.chapterId === next.chapterId;
  switch (next.status) {
    case "playing":
      return same && prev.status === "playing"
        ? null
        : strings.chapterPlayStarted(heading);
    case "paused":
      return same && (prev.status === "playing" || prev.status === "loading")
        ? strings.chapterPlayPaused(heading)
        : null;
    case "failed":
      return same && prev.status === "failed"
        ? null
        : strings.chapterPlayFailed(heading);
    case "idle":
      return prev.status === "playing" && !hushed
        ? strings.chapterPlayFinished(heading)
        : null;
    case "loading":
      return null;
  }
}

/**
 * What a chapter's play did, for the Books screen's polite status region
 * (#1344). The play control's name changes with the state, but a screen
 * reader does not reliably re-read a changed name (inference, not checked
 * on a device), so a person would otherwise hear nothing when a chapter
 * starts, pauses, finishes or fails.
 *
 * The line is worked out while rendering, from the state this screen last
 * saw and the one it is given, so it lands in the same commit as the state.
 * A new play clears it, so a second failure in a row is a change the region
 * can say again.
 *
 * `hush` is for the screen's own stops (a collapse, a share, a delete): call
 * it before `stopChapter`, and the idle that follows is not called a finish.
 * It holds until that idle or the next play.
 */
export function useChapterPlayAnnouncement(
  play: ChapterPlayState,
  books: readonly BookCard[]
): { readonly line: string; readonly hush: () => void } {
  const [seen, setSeen] = useState(play);
  const [line, setLine] = useState("");
  const [hushed, setHushed] = useState(false);
  // The chapter the change is about: the new state's, or for an idle one the
  // chapter that was playing.
  const subject = play.chapterId ?? seen.chapterId;
  const chapter =
    subject === null
      ? undefined
      : books
          .flatMap((book) => book.chapters)
          .find((c) => c.chapterId === subject);
  const heading = useChapterHeading(
    chapter?.name ?? null,
    chapter?.number ?? 0
  );
  if (play !== seen) {
    setSeen(play);
    if (play.status === "loading" || play.status === "idle") {
      setHushed(false);
    }
    if (play.status === "loading") {
      setLine("");
    } else if (chapter) {
      const said = lineFor(seen, play, hushed, heading);
      if (said !== null) setLine(said);
    }
  }
  const hush = useCallback(() => setHushed(true), []);
  return { line, hush };
}
