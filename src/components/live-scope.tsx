import { useEffect, useLayoutEffect, useRef } from "react";

import {
  CANVAS_FALLBACK_LIVE,
  CANVAS_FALLBACK_VOICE,
  withCanvasFallback,
} from "./canvas-fallback-colors";
import { useLiveTheme } from "@/hooks/use-theme";
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
   * The ring as it stands, WITHOUT advancing it. Used for the activation/remount
   * paint only; the animation loop uses `readScope`, which folds a column in.
   * Passing `readScope` here would double-count a column per active edge.
   */
  peekScope: () => CaptureScope | null;
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
   * Which one ships is a deferred UX call (the requirements owner, #120) — the geometry serves both.
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
 *
 * Drawn at ABSOLUTE level, deliberately — `Waveform` fits a stored take to the
 * lane (#358, `lib/audio/display-gain.ts`) and this does not. While capture is
 * live the scope is a level cue as much as a shape cue, and a scope that
 * auto-scaled would make a microphone capturing far too quietly look exactly
 * like a healthy one, which is the very problem #359 is about; the VU meter
 * beside it is absolute for the same reason.
 *
 * `Waveform` holds the same line rather than contradicting it: it suppresses
 * the fit whenever `firstTakeInFlight` is set — capturing AND nothing
 * committed yet, not `capturing` alone, which a punch-in also sets over
 * already-committed audio it must keep fitted (George R2 P2) — so the
 * mid-take swaps between the two canvases for a FIRST take — this scope
 * unmounting for a paused decoded preview (`recorder.tsx`'s `previewShown`),
 * and remounting on Resume — do not change the scale under the translator
 * (George R1 P2, R3 P2). The re-fit lands once, when the take is committed and
 * capture is over.
 *
 * An APPEND's own Pause+Play preview is the one deliberate exception (since
 * #283, George R-resume round 2): this scope keeps drawing absolute through
 * the whole live recording, but its Pause+Play preview swaps to `Waveform`
 * FITTED to the committed clip's own gain — a real scale change, accepted as
 * the outcome of an explicit Play tap reviewing the take, not the involuntary
 * "did I lose it" class this module's absolute-level contract exists to
 * prevent. See `recorder-stage.ts` and the stage ternary in `recorder.tsx`.
 *
 * #358 also sketches a running-max scale during capture; that half is
 * deliberately NOT built here, pending the requirements owner's call and the
 * Moto G peak/RMS measurement that separates #358 from #359.
 */
export function LiveScope({
  readScope,
  peekScope,
  active,
  headFraction = 0.5,
  height = 200,
  label,
  className,
}: LiveScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read for its subscription only: a `data-theme` switch remaps `--s-voice`
  // and `--s-live`, which the draw effect reads once per run, and a painted
  // canvas cannot see that on its own — so the effect lists it. Today a toggle
  // unmounts this canvas (the toggle is Books-only); once it is reachable from
  // the recorder (#149) this is what keeps the scope from holding the previous
  // theme's amber (George R2 P2 on #457) — while active through the loop's
  // restart, and while FROZEN (paused / processing / close) through the
  // explicit repaint after the observer bind below (George R4 P2-1).
  const theme = useLiveTheme();
  // Hold the latest reader without retriggering the loop — the hook may hand a
  // fresh function identity each render, and restarting for that drops frames.
  const readScopeRef = useRef(readScope);
  useEffect(() => {
    readScopeRef.current = readScope;
  }, [readScope]);
  // Same latching for the peek — a fresh identity per render must not restart
  // the loop, and the layout effect below reads it through this ref.
  const peekScopeRef = useRef(peekScope);
  useEffect(() => {
    peekScopeRef.current = peekScope;
  }, [peekScope]);
  // The last scope painted, so a resize while FROZEN (paused / processing /
  // close) can repaint at the new size. Its arrays are the ring's reused pair —
  // safe to re-read only while no push is happening, which is exactly the
  // inactive window this ref is read in.
  const lastScopeRef = useRef<CaptureScope | null>(null);

  // `useLayoutEffect`, not `useEffect`: the first paint below must land BEFORE
  // the browser paints the freshly-mounted canvas. A remount happens on a
  // first-take Resume after a preview, and in `useEffect` the synchronous paint
  // still ran after the browser had already shown one blank frame — shorter than
  // the rAF wait #130 filed, but the same class (George, round 2). The rAF loop
  // registered here is unaffected by the earlier timing; it is scheduled, not run.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Geometry and colours are read once per effect, not per frame: the window
    // is a pure function of headFraction, and the CSS tokens change only on a
    // `data-theme` switch — which `theme` in the deps below turns into a
    // re-run, so this read stays per-effect rather than per-frame. `--s-voice`
    // is the audio amber, `--s-live` the record-head red — the same roles
    // `Waveform` uses.
    const win = captureWindow(headFraction);
    const span = win.endFraction - win.startFraction;
    const styles = getComputedStyle(canvas);
    // Falls back to the unthemed dark-only hexes in `canvas-fallback-colors.ts`
    // (#506 item 1) only if the token read comes back empty — a token failing
    // to resolve, not the normal path.
    const stroke = withCanvasFallback(
      styles.getPropertyValue("--s-voice"),
      CANVAS_FALLBACK_VOICE
    );
    const live = withCanvasFallback(
      styles.getPropertyValue("--s-live"),
      CANVAS_FALLBACK_LIVE
    );

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
    // A theme change while FROZEN takes the same path (George R4 P2-1): this
    // effect re-runs on `theme`, and with `active` false nothing below would
    // paint — the colours above were re-read into fresh closures and the stale
    // frame stayed on the previous theme's amber until Resume or a resize. The
    // ring is not advanced here (`lastScopeRef`, never `readScope` — see the
    // peek note below), and a first mount while frozen has nothing to paint
    // yet, which `paint` already treats as a no-op. Inference, not observed:
    // ResizeObserver also delivers an initial notification on `observe()`
    // per its spec, which would repaint through the callback above — but that
    // is a spec detail of the engine, not this file's contract, so the repaint
    // is stated here rather than relied on there.
    if (!active) paint(lastScopeRef.current);

    let raf = 0;
    if (active) {
      // Paint the ring's current state NOW, before the browser paints and before
      // the first rAF. A first-take Resume after a preview REMOUNTS this canvas
      // (the preview unmounted it), and without this the stage showed a blank
      // frame while the ring — which `resume()` does not reset — waited to be
      // drawn (#130).
      //
      // This MUST be the non-mutating peek. `readScope` advances the ring, and
      // this effect re-runs on every `active` edge, so using it here folded an
      // extra column into every pause→resume cycle — the waveform ran ahead of
      // real time, ~5% of the window after ten cycles (George, round 3). The peek
      // also draws when the tap is refusing frames, which is exactly the frozen
      // ring this paint exists to show.
      const first = peekScopeRef.current();
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
    // `theme` is listed for its side effect only, like `Waveform`'s `finished`:
    // a re-run re-reads the two colours above. While active that restarts the
    // loop through the same peek-paint path an `active`/`height` edge already
    // takes, so a mid-take toggle repaints in place rather than freezing.
  }, [active, headFraction, height, theme]);

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
