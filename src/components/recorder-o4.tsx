import { useEffect, useRef } from "react";

import type { Design } from "@/lib/design";
import { formatDuration } from "@/lib/utils";
import type { RecorderLook } from "./recorder-look";

/**
 * The one piece of new markup the O4 Recorder needs (#945, epic #936): the
 * mono timestamp states 10 and 11 show. Everything else O4 changes on this
 * screen is CSS, in `app/styles/o4/recorder.css`, keyed off the stage's
 * `data-o4-look` attribute (`recorder-look.ts`).
 */

interface RecorderStampProps {
  readonly design: Design;
  readonly look: RecorderLook;
  /** The drawn buffer's duration — the same denominator the playhead uses. */
  readonly durationMs: number;
  /** The sounding position within the drawn buffer, or null when nothing sounds. */
  readonly readElapsedMs: () => number | null;
}

/**
 * The mono timestamp in the stage's top-right corner: the duration while
 * recorded (10), and position / duration while playing (11). O4 only.
 *
 * Pull-model while playing, like `PlayheadOverlay`: it reads the position on
 * its own rAF and writes the text node directly, so playback re-renders
 * nothing. A null read (playback just ended) keeps the last position rather
 * than flashing back to zero for the frame before `look` changes.
 *
 * `aria-hidden`: the brief asks for the same accessibility tree in both looks,
 * and a clock that changes every frame is noise to a screen reader.
 */
export function RecorderStamp({
  design,
  look,
  durationMs,
  readElapsedMs,
}: RecorderStampProps) {
  const posRef = useRef<HTMLSpanElement | null>(null);
  const readRef = useRef(readElapsedMs);
  useEffect(() => {
    readRef.current = readElapsedMs;
  }, [readElapsedMs]);

  const playing = design === "o4" && look === "playing";
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const ms = readRef.current();
      const pos = posRef.current;
      if (ms !== null && pos)
        pos.textContent = formatDuration(Math.min(ms, durationMs));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs]);

  if (design !== "o4") return null;
  if (look === "recorded")
    return (
      <span className="recorder-stamp" aria-hidden="true">
        {formatDuration(durationMs)}
      </span>
    );
  if (look === "playing")
    return (
      <span className="recorder-stamp" aria-hidden="true">
        <span ref={posRef}>{formatDuration(0)}</span>
        {" / "}
        {formatDuration(durationMs)}
      </span>
    );
  return null;
}
