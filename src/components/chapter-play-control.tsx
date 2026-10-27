import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { strings } from "@/lib/strings";

import type { ChapterRowStatus } from "./chapter-row-status";
import { Icon } from "./icon";

interface ChapterPlayControlProps {
  /** The chapter's heading, for the accessible name. */
  heading: string;
  /** Segments holding a recording; none means nothing to play. */
  recordedCount: number;
  status: ChapterRowStatus;
  /** 0..1 where the pause left it; read only while paused. */
  pausedFraction: number | null;
  onPress: () => void;
  /** 0..1 through the chapter, or null. Pulled each frame while it plays. */
  readProgress: () => number | null;
}

/**
 * A chapter row's play control (#1469, Q8 `pause-progress`): a play or pause
 * glyph in a ring that fills as the chapter plays and stays filled while it
 * is paused. State is in the control itself and in its name, and no text
 * appears. The control announces nothing itself: what a play did (started,
 * paused, finished, failed) is said by the Books screen's polite status
 * region (`useChapterPlayAnnouncement`, #1344).
 *
 * Not a `Control`: with nothing recorded it is `aria-disabled`, not natively
 * disabled, so it keeps its place in the tab order and its name says why, and
 * `Control` only does that through a hint appended to a name that would then
 * read twice.
 *
 * The ring's fill is the `--play-progress` custom property. While the chapter
 * plays a requestAnimationFrame loop owns it, writing to this one element and
 * never to React state, so a moving ring does not re-render the screen. The
 * loop exists only while this row plays or loads. The markup carries no value
 * for it then, so a render cannot fight the loop; at rest it is 0 and while
 * paused it is the fraction the player held at the pause.
 */
export function ChapterPlayControl({
  heading,
  recordedCount,
  status,
  pausedFraction,
  onPress,
  readProgress,
}: ChapterPlayControlProps) {
  const ringRef = useRef<HTMLSpanElement>(null);
  const moving = status === "playing" || status === "loading";

  // Layout, not passive: the first value lands before paint, so a resume does
  // not show the ring at its old fill or at zero for a frame.
  useLayoutEffect(() => {
    const ring = ringRef.current;
    if (!moving || ring === null) return;
    let frame = 0;
    const tick = () => {
      const fraction = readProgress();
      if (fraction !== null) {
        ring.style.setProperty("--play-progress", String(fraction));
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [moving, readProgress]);

  const empty = recordedCount === 0;
  const label = empty
    ? strings.chapterNothingToPlay(heading)
    : status === "playing" || status === "loading"
      ? strings.pauseChapter(heading)
      : status === "paused"
        ? strings.resumeChapter(
            heading,
            Math.round((pausedFraction ?? 0) * 100)
          )
        : status === "failed"
          ? strings.chapterPlayFailed(heading)
          : strings.playChapter(heading);
  const fill = moving ? undefined : status === "paused" ? pausedFraction : 0;

  return (
    <span className="books-play" data-status={status}>
      <span
        ref={ringRef}
        className="books-play-ring"
        aria-hidden="true"
        style={
          fill === undefined
            ? undefined
            : ({ "--play-progress": fill ?? 0 } as CSSProperties)
        }
      />
      <button
        type="button"
        className="control control--quiet books-play-btn"
        aria-label={label}
        title={label}
        aria-disabled={empty || undefined}
        onClick={empty ? undefined : onPress}
      >
        <Icon name={moving ? "pause" : "play"} size={24} />
      </button>
    </span>
  );
}
