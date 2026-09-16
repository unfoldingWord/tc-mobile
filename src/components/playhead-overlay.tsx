import { useEffect, useRef } from "react";

import { playheadViewportX } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";

interface PlayheadOverlayProps {
  /**
   * The sounding position in milliseconds **within the drawn buffer**, or `null`
   * when nothing is sounding (a HIDE sentinel distinct from 0, the clip start).
   * Usually the two are the same thing; they part company for an edit-mode
   * audition (#284), which sounds a view of the middle of the buffer that stays
   * drawn, and the recorder adds that view's offset before this is read. The line
   * belongs over the audio the eye can see, so this overlay is deliberately given
   * one coordinate system — the drawn one — and knows nothing of selections. A
   * PULL (D-LEVEL-PULL, like
   * `VuMeter`'s `readLevel` and `LiveScope`'s `readScope`): this overlay polls it
   * on its own `requestAnimationFrame` clock and moves the line by DOM, so buffer
   * playback never lifts into React state and nothing re-renders per frame — the
   * inert Segments list behind the sheet included (#102).
   */
  readElapsedMs: () => number | null;
  /**
   * The buffer is sounding. While true the line tracks the position; while false
   * the loop stops and the line hides, so a resting playhead never sits over a
   * paused or idle waveform.
   */
  active: boolean;
  /** Duration of the DRAWN buffer, for the position fraction. */
  durationMs: number;
  /**
   * The recorder viewport the bars are drawn through (`Waveform`'s `view`), so
   * the line maps clip fraction to the same screen x as the audio under it.
   */
  startFraction: number;
  endFraction: number;
  /**
   * Clamp an off-window position to the nearest edge instead of hiding it
   * (#284, George R7). The hide branch below exists for the blank head/tail of
   * a SWAPPED view — real screen space with no audio under it. An in-place
   * audition never swaps the view, so a position outside `[0,1]` there is real,
   * still-sounding audio that has simply outgrown the pan/zoom window, not
   * blank space; hiding the one cue that says "this is what you're hearing" is
   * the wrong response to that. `stage.inPlaceAudition` names exactly this
   * case and nothing else — every other caller (a preview, a record-mode play,
   * a no-selection audition) leaves this `false` and keeps the original hide.
   */
  clampToEdge?: boolean;
  className?: string;
}

/**
 * The recorder's playback playhead, as a DOM overlay rather than a bar in
 * `Waveform`'s canvas (#102).
 *
 * Drawing the playhead inside the canvas made every position tick re-run the
 * whole `Waveform` draw effect — reallocating the canvas backing store and
 * repainting every peak bar ~16×/s (George, #102 R1). A dedicated pull-model
 * overlay — the pattern `LiveScope` and `VuMeter` already use, and the same
 * positioned-marker shape the Segments row's scrub dot uses — owns its own rAF,
 * pulls the position, and moves one element by `left`. The canvas paints its
 * peaks ONCE and never re-runs for playback.
 *
 * `--s-ink` (a semantic role, layer 2) so the line reads over both the audio and
 * the record-coloured centerline — the colour the canvas playhead used.
 */
export function PlayheadOverlay({
  readElapsedMs,
  active,
  durationMs,
  startFraction,
  endFraction,
  clampToEdge = false,
  className,
}: PlayheadOverlayProps) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest reader without retriggering the loop — the hook hands a
  // stable identity here, but this keeps a fresh one from dropping frames if it
  // ever did not (mirrors `LiveScope`).
  const readRef = useRef(readElapsedMs);
  useEffect(() => {
    readRef.current = readElapsedMs;
  }, [readElapsedMs]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    // Idle / paused / empty: hide the line and run no loop.
    if (!active || durationMs <= 0) {
      line.style.opacity = "0";
      return;
    }
    const span = endFraction - startFraction;
    let raf = 0;
    const tick = () => {
      const ms = readRef.current();
      // `null` is the hide sentinel: playback ended or was stopped and the handle
      // is gone, but this loop is still running until `active` (React state) goes
      // false a commit later. Hide rather than treat a 0 as "draw at clip start",
      // which would teleport the line to the left edge for that frame (George R2).
      const px =
        ms === null || span <= 0
          ? -1
          : playheadViewportX(
              Math.min(1, Math.max(0, ms / durationMs)),
              startFraction,
              endFraction
            );
      // Off-screen in the blank head/tail of a SWAPPED pan/zoom window ⇒ hide,
      // rather than pin to an edge — the same skip the canvas playhead made.
      // `clampToEdge` (#284, George R7) is the one exception: an in-place
      // audition never swaps the view, so off-screen there is real, still-
      // sounding audio the pan/zoom window is simply too narrow to show, and
      // the cue this feature exists to add must stay up rather than vanish.
      if ((px < 0 || px > 1) && !clampToEdge) {
        line.style.opacity = "0";
      } else {
        const clamped = Math.min(1, Math.max(0, px));
        // Clamp the CSS position so the whole 2px line stays inside the stage's
        // `overflow: hidden` box, the way the canvas clamped to `w - 2` — at
        // fraction 1 a bare `left: 100%` put the entire line past the edge, so
        // the last sample showed no playhead at all (George R2).
        line.style.left = `min(${clamped * 100}%, calc(100% - 2px))`;
        line.style.opacity = "1";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs, startFraction, endFraction, clampToEdge]);

  return (
    <div
      ref={lineRef}
      aria-hidden="true"
      // `opacity-0` is the resting/initial hide via CLASS, not the JSX `style`
      // object: `opacity` and `left` are written imperatively in rAF, and a value
      // declared in `style` would be reset by React on any parent re-render
      // during a preview (VuMeter keeps its live `transform` out of JSX for the
      // same reason). `background` is static, so it stays in `style` safely.
      // `z-[1]` so the line is painted ABOVE the selection overlay (#284 /
      // George R5). Neither node set a z-index, so document order decided it and
      // this one is mounted first: on the flow this PR exists for — tighten the
      // frame to a word, then audition it — the band is a couple of pixels wide
      // and its two 24px handles cover the line completely, so the one cue that
      // says "this highlight is what you are hearing" never appeared. Stated
      // here rather than fixed by reordering the JSX, so the invariant survives
      // whatever is mounted next to it; the line is `pointer-events-none`, so
      // lifting it does not take the handles' drags.
      className={cn(
        "pointer-events-none absolute top-0 bottom-0 z-[1] w-[2px] opacity-0",
        className
      )}
      style={{ background: "var(--s-ink)" }}
    />
  );
}
