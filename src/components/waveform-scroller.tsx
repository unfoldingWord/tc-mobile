import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { playbackStripOffset } from "@/lib/audio/viewport";

interface WaveformScrollerProps {
  /**
   * A buffer is sounding AND the stage is in the scrolling render mode
   * (`stageView`'s `"scroll"`). While true this owns the strip's `transform`
   * and moves it every frame; while false it clears the transform and runs no
   * loop, so the strip sits exactly where the layout puts it.
   */
  active: boolean;
  /**
   * The strip's width as a multiple of the stage's — `playbackStrip`'s
   * `widthFactor` while scrolling, and 1 when the stage draws an ordinary
   * window. A percentage, not pixels, so a rotation needs no measurement and no
   * listener.
   */
  widthFactor: number;
  /** The working buffer's length, for the offset math. */
  length: number;
  /** What the STAGE spans at the current zoom (`length / zoom`). */
  visibleSamples: number;
  /**
   * The sounding position in samples, or `null` when nothing is sounding — the
   * same PULL contract `PlayheadOverlay`, `VuMeter` and `LiveScope` use
   * (D-LEVEL-PULL). Polled on this component's own rAF, so playback moves the
   * waveform by DOM and lifts nothing into React state: no sheet re-render, no
   * canvas repaint, and nothing in the inert Segments list behind the sheet
   * (#102, the finding that made the playhead an overlay in the first place).
   *
   * A `null` HOLDS the last position rather than resetting: it means the handle
   * is already gone but `active` has not yet been through a commit, and moving
   * the waveform back to the clip start for that one frame would be the same
   * flash the overlay's own null sentinel exists to prevent.
   */
  readPositionSample: () => number | null;
  /**
   * Report the position this frame is drawn at. **Called on the rAF clock, so
   * it must not set state** — the recorder writes it to a ref, which is what
   * `freezePlaybackPan` reads when playback stops, from ANY route: the
   * Play/Pause tap, the end of the clip, a finger landing on the waveform
   * (#317), the ≡ menu, Back. That ref is the whole of #416's fix: "the
   * waveform and the playhead stay exactly where playback had reached".
   */
  onPosition: (sample: number) => void;
  children: ReactNode;
}

/**
 * The strip the waveform is drawn on, and the one thing that moves during
 * playback (#415).
 *
 * There is ONE playhead — the red centerline, fixed at the middle of the stage
 * — and the waveform scrolls under it. The naive way to do that is to slide the
 * pan/zoom window a sample at a time, but the window is a React value and the
 * canvas repaints whenever it changes, so that is a full sheet render plus a
 * backing-store realloc and a 400-bar repaint every frame — #102's finding, at
 * 60 Hz instead of 16.
 *
 * So the clip is drawn ONCE, on a strip wider than the stage (`playbackStrip`:
 * the clip plus one viewport of blank, split at the centerline), and each frame
 * moves it with a single `translate3d`. Per frame this costs one compositor
 * transform and no repaint at all. The price is the strip's backing store,
 * which is `(zoom + 1)` stage widths — twice the stage at whole zoom, five
 * times at quarter zoom — and only while a buffer is sounding.
 *
 * The component owns the transform in BOTH directions and React never writes
 * it, for the reason `PlayheadOverlay` keeps `opacity` out of its JSX: a value
 * declared in a `style` object is reset by React on any parent re-render, which
 * during playback would snap the waveform back to the layout position for a
 * frame.
 */
export function WaveformScroller({
  active,
  widthFactor,
  length,
  visibleSamples,
  readPositionSample,
  onPosition,
  children,
}: WaveformScrollerProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest callbacks without retriggering the loop — the recorder
  // hands stable identities here, but a fresh one must never drop frames
  // (mirrors `LiveScope` and `PlayheadOverlay`).
  const readRef = useRef(readPositionSample);
  const notifyRef = useRef(onPosition);
  useEffect(() => {
    readRef.current = readPositionSample;
  }, [readPositionSample]);
  useEffect(() => {
    notifyRef.current = onPosition;
  }, [onPosition]);

  // `useLayoutEffect`, not `useEffect`: the first placement must land before the
  // browser paints the frame in which playback started, or the waveform shows
  // for one frame at the layout position (the clip's start) before jumping to
  // where the sound actually began — the same reason `Waveform` paints in a
  // layout effect.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    if (!active) {
      strip.style.transform = "";
      return;
    }
    let raf = 0;
    // Seeded from the first read below, never from 0: a play that starts at the
    // centerline (#317) begins partway through the clip.
    let last = 0;
    const place = () => {
      const sample = readRef.current();
      if (sample !== null) {
        last = sample;
        notifyRef.current(sample);
      }
      const offset = playbackStripOffset(last, length, visibleSamples);
      strip.style.transform = `translate3d(${offset * 100}%, 0, 0)`;
    };
    place();
    const tick = () => {
      place();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Back to the layout position, in the same commit the stage returns to
      // its static window — a stale transform would leave the waveform offset
      // under a window that no longer matches it.
      strip.style.transform = "";
    };
  }, [active, length, visibleSamples]);

  return (
    <div
      ref={stripRef}
      style={{
        width: `${widthFactor * 100}%`,
        // Only while it actually moves: a permanent promotion would keep a
        // multi-viewport layer alive for every idle recorder sheet.
        willChange: active ? "transform" : undefined,
      }}
    >
      {children}
    </div>
  );
}
