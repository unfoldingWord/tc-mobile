import { useEffect, useRef } from "react";

import { playheadViewportX } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";

interface PlayheadOverlayProps {
  /**
   * The sounding position in milliseconds, or `null` when nothing is sounding (a
   * HIDE sentinel distinct from 0, the clip start). A PULL (D-LEVEL-PULL, like
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
  /** Duration of the sounding buffer, for the position fraction. */
  durationMs: number;
  /**
   * The recorder viewport the bars are drawn through (`Waveform`'s `view`), so
   * the line maps clip fraction to the same screen x as the audio under it.
   */
  startFraction: number;
  endFraction: number;
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
      // Off-screen in the blank head/tail of the pan/zoom window ⇒ hide, rather
      // than pin to an edge — the same skip the canvas playhead made.
      if (px < 0 || px > 1) {
        line.style.opacity = "0";
      } else {
        // Clamp the CSS position so the whole 2px line stays inside the stage's
        // `overflow: hidden` box, the way the canvas clamped to `w - 2` — at
        // fraction 1 a bare `left: 100%` put the entire line past the edge, so
        // the last sample showed no playhead at all (George R2).
        line.style.left = `min(${px * 100}%, calc(100% - 2px))`;
        line.style.opacity = "1";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, durationMs, startFraction, endFraction]);

  return (
    <div
      ref={lineRef}
      aria-hidden="true"
      // `opacity-0` is the resting/initial hide via CLASS, not the JSX `style`
      // object: `opacity` and `left` are written imperatively in rAF, and a value
      // declared in `style` would be reset by React on any parent re-render
      // during a preview (VuMeter keeps its live `transform` out of JSX for the
      // same reason). `background` is static, so it stays in `style` safely.
      className={cn(
        "pointer-events-none absolute top-0 bottom-0 w-[2px] opacity-0",
        className
      )}
      style={{ background: "var(--s-ink)" }}
    />
  );
}
