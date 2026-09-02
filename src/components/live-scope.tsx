import { useEffect, useRef } from "react";

import { captureWindow } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";
import type { CaptureScope } from "@/lib/audio/capture-peaks";

interface LiveScopeProps {
  /**
   * Reads the live-waveform scope for the current take, or `null` when nothing
   * is capturing. Per D-LEVEL-PULL this is a PULL: the scope polls it on its own
   * frame clock so the recorder never re-renders per frame (mirrors `VuMeter`'s
   * `readLevel`). Each read folds one column in and returns the ring.
   */
  readScope: () => CaptureScope | null;
  /**
   * Whether capture is live. While true the loop pulls and paints; while false
   * the loop stops and the canvas is left FROZEN on its last frame — a paused
   * take must not keep scrolling (a paused mic still emits frames, R-B6), and
   * the translator should still see where they got to.
   */
  active: boolean;
  /**
   * Where the record head sits across the width (0..1]. Defaults to the recorder
   * centerline (0.5); the right-edge full-width scope (1) is the alternative.
   * Which one ships is a deferred UX call (Tim, #120) — the geometry serves both.
   */
  headFraction?: number;
  height?: number;
  /**
   * The whole accessible name. The scope is decorative status, so the canvas is
   * labelled once here, not per frame.
   */
  label: string;
  className?: string;
}

/**
 * The live waveform that grows as you speak (#120): a scope scrolling
 * right-to-left under the record head while recording.
 *
 * A DEDICATED pull-model drawer, not `Waveform`'s `view`/`peaks` path (George
 * R1): it owns its `requestAnimationFrame` loop, pulls a `CaptureScope`, and
 * paints the canvas imperatively — no React state, so only this element repaints
 * and the loop stops cleanly when `active` goes false or it unmounts. That also
 * keeps it off the `!recorded` gate that would blank a first take, and off the
 * per-render `canvas.width` reallocation #102 flags (the backing store is sized
 * once per effect / resize, never per frame).
 *
 * The zero-valued pad the ring emits before it fills is skipped via
 * `scope.count`: a `{0,0}` column is silence to a canvas, so painting it would
 * draw the unfilled head as amber "recorded silence".
 */
export function LiveScope({
  readScope,
  active,
  headFraction = 0.5,
  height = 200,
  label,
  className,
}: LiveScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Hold the latest reader without retriggering the loop — the hook may hand a
  // fresh function identity each render, and restarting for that drops frames.
  const readScopeRef = useRef(readScope);
  useEffect(() => {
    readScopeRef.current = readScope;
  }, [readScope]);
  // The last scope painted, so a resize while FROZEN (paused / processing /
  // close) can repaint at the new size. Its arrays are the ring's reused pair —
  // safe to re-read only while no push is happening, which is exactly the
  // inactive window this ref is read in.
  const lastScopeRef = useRef<CaptureScope | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Geometry and colours are read once per effect, not per frame: the window
    // is a pure function of headFraction, and the CSS tokens do not change mid
    // take. `--s-voice` is the audio amber, `--s-live` the record-head red —
    // the same roles `Waveform` uses.
    const win = captureWindow(headFraction);
    const span = win.endFraction - win.startFraction;
    const styles = getComputedStyle(canvas);
    const stroke = styles.getPropertyValue("--s-voice").trim() || "#e6a444";
    const live = styles.getPropertyValue("--s-live").trim() || "#d84a4a";

    // Paint one scope at the canvas's CURRENT css size. Sizing the backing store
    // only on an actual change is the #102 cost avoidance; doing it here (not
    // once per effect) is also what lets a resize while frozen repaint correctly.
    const paint = (scope: CaptureScope | null) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!scope || w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      const pxW = Math.floor(w * dpr);
      const pxH = Math.floor(h * dpr);
      if (canvas.width !== pxW || canvas.height !== pxH) {
        canvas.width = pxW;
        canvas.height = pxH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const buckets = scope.min.length;
      const mid = h / 2;
      // Bar width from the CLAMPED window span — the same `w/buckets/span - 1`
      // the `Waveform` view loop uses, so the bars and the head share one
      // coordinate model even after `captureWindow` clamps the head. Span is
      // never zero (head > 0), so no divide-by-zero guard.
      const barW = Math.max(1, w / buckets / span - 1);
      ctx.fillStyle = stroke;
      // Paint only the real trailing columns; the leading `buckets - count` are
      // the not-yet pad (silence-valued, must not draw).
      for (let i = buckets - scope.count; i < buckets; i++) {
        const x = ((i / buckets - win.startFraction) / span) * w;
        const top = mid - (scope.max[i] ?? 0) * mid;
        const bottom = mid - (scope.min[i] ?? 0) * mid;
        ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
      }
      // The record head, over the audio, in the record colour.
      ctx.fillStyle = live;
      ctx.fillRect(Math.round(win.centerFraction * w) - 1, 0, 2, h);
    };

    // A resize while FROZEN (a rotate mid-pause, or a `height` change) must
    // repaint the last frame at the new size: the active loop resizes per frame,
    // but while inactive nothing else would, so CSS would stretch the stale
    // backing store (Frank R4). While active, the loop owns the repaint.
    const observer = new ResizeObserver(() => {
      if (!active) paint(lastScopeRef.current);
    });
    observer.observe(canvas);

    let raf = 0;
    if (active) {
      // Paint the ring's current state NOW, before the first rAF. A first-take
      // Resume after a preview REMOUNTS this canvas (the preview unmounted it),
      // and waiting for the first animation frame left one commit of blank stage
      // before the ring — which `resume()` does not reset — repainted (#130).
      // `resume()` sets the recording flag synchronously before React commits,
      // so the reader already returns the ring here; a null (tap not wired) just
      // leaves the canvas as it was, the same as the loop below.
      const first = readScopeRef.current();
      if (first) {
        lastScopeRef.current = first;
        paint(first);
      }
      const tick = () => {
        const scope = readScopeRef.current();
        // A null scope is the tap-failed / teardown transient — the tap is
        // nulled a frame before the state leaves "recording". Leave the last
        // painted frame rather than clearing to blank: a freeze, not a flash
        // (George R1). On a real scope, remember it for a later resize-repaint.
        if (scope) {
          lastScopeRef.current = scope;
          paint(scope);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, headFraction, height]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      style={{ height }}
      className={cn("block w-full", className)}
    />
  );
}
