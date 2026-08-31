import { useEffect, useRef } from "react";

import { playheadViewportX } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";

interface PlayheadOverlayProps {
  /**
   * The sounding position in milliseconds. A PULL (D-LEVEL-PULL, like
   * `VuMeter`'s `readLevel` and `LiveScope`'s `readScope`): this overlay polls it
   * on its own `requestAnimationFrame` clock and moves the line by DOM, so buffer
   * playback never lifts into React state and nothing re-renders per frame — the
   * inert Segments list behind the sheet included (#102).
   */
  readElapsedMs: () => number;
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
      const fraction = Math.min(1, Math.max(0, readRef.current() / durationMs));
      const px =
        span > 0 ? playheadViewportX(fraction, startFraction, endFraction) : -1;
      // Off-screen in the blank head/tail of the pan/zoom window ⇒ hide, rather
      // than pin to an edge — the same skip the canvas playhead made.
      if (px < 0 || px > 1) {
        line.style.opacity = "0";
      } else {
        line.style.left = `${px * 100}%`;
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
      className={cn(
        "pointer-events-none absolute top-0 bottom-0 w-[2px]",
        className
      )}
      style={{ background: "var(--s-ink)", opacity: 0 }}
    />
  );
}
