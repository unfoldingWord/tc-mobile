import { useEffect, useLayoutEffect, useRef } from "react";

import {
  CANVAS_FALLBACK_LIVE,
  CANVAS_FALLBACK_VOICE,
  withCanvasFallback,
} from "./canvas-fallback-colors";
import { useLiveTheme } from "@/hooks/use-theme";
import {
  advanceColumnRate,
  columnsRightOfHead,
  foldContextSide,
  newColumnRateClock,
  type CaptureContext,
} from "@/lib/audio/capture-context";
import { clampUnit } from "@/lib/audio/display-gain";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
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
   * the loop stops and the canvas is left FROZEN on its last frame — a take
   * that has stopped capturing (processing, the commit) must not keep
   * scrolling (R-B6), and the translator should still see where they got to.
   */
  active: boolean;
  /**
   * Where the record head sits across the width (0..1]. Defaults to the recorder
   * centerline (0.5); the right-edge full-width scope (1) is the alternative.
   * Which one ships is a deferred UX call (the requirements owner, #120) — the geometry serves both.
   */
  headFraction?: number;
  /**
   * The segment's existing clip either side of the take's insertion offset
   * (#640), or `null` for a first take. Drawn left of the new audio and right
   * of the head, at the scope's own measured column rate, so an append keeps
   * the take before it in view and a mid-clip insert keeps the clip on both
   * sides. Its `gain` scales every bar, the new audio's included (#1189).
   * Read once per paint through a ref; it is fixed for the take.
   */
  context?: CaptureContext | null;
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
 * Where the segment already holds audio, that pad is not left blank (#640):
 * the `context` prop carries the clip either side of the insertion offset,
 * and the paint draws the audio before the offset in the pad, butted against
 * the take's oldest column, and the audio after it from the head to the right
 * edge. So an append keeps the take before it in view while the new one
 * grows, and a mid-clip insert keeps the clip on both sides. A first take has
 * no context, and a take at the very start has nothing before it — those are
 * the two cases the requirements owner named where a blank left is right.
 *
 * A FIRST take is drawn at absolute level, deliberately — `Waveform` fits a
 * stored take to the lane (#358, `lib/audio/display-gain.ts`) and this does
 * not while nothing is committed. While capture is live the scope is a level
 * cue as much as a shape cue, and a scope that auto-scaled would make a
 * microphone capturing far too quietly look exactly like a healthy one, which
 * is the very problem #359 is about; the VU meter beside it is absolute for
 * the same reason, for every take.
 *
 * An APPEND or insert is drawn at the committed clip's display gain instead
 * (#1189), carried on `context.gain` and applied to the context AND the new
 * audio. Drawn absolute, a Record tap collapsed the audio already on the stage
 * from the height the idle `Waveform` fitted it to down to its raw level —
 * up to twenty times smaller on a quiet phone — and the new take grew beside
 * it at that raw level too. At the committed clip's gain, the existing audio
 * keeps the height it had a tap earlier and the new audio is on the same
 * scale. The whole buffer is re-fitted by `Waveform` when the take commits.
 *
 * #358 also sketches a running-max scale during capture; that is NOT built
 * here — the gain is fixed for the take, never tracked while it records.
 */
export function LiveScope({
  readScope,
  peekScope,
  active,
  headFraction = 0.5,
  context = null,
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
  // restart, and while FROZEN (processing / close) through the
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
  // The last scope painted, so a resize while FROZEN (processing /
  // close) can repaint at the new size. Its arrays are the ring's reused pair —
  // safe to re-read only while no push is happening, which is exactly the
  // inactive window this ref is read in.
  const lastScopeRef = useRef<CaptureScope | null>(null);
  // The existing clip beside the take (#640), latched like the readers above.
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  // The column rate the ring actually advances at, measured from this mount's
  // own ticks over a rolling window that a gap restarts (`advanceColumnRate`) —
  // kept across effect re-runs so a frozen repaint draws the context at the
  // scale the take was recorded at.
  const rateRef = useRef(newColumnRateClock());
  // Reused fold buffers for the context columns, grown on demand — never
  // reallocated per frame (#102).
  const foldRef = useRef({
    min: new Float32Array(0),
    max: new Float32Array(0),
  });

  // `useLayoutEffect`, not `useEffect`: the first paint below must land BEFORE
  // the browser paints the freshly-mounted canvas. In `useEffect` the
  // synchronous paint ran after the browser had already shown one blank frame
  // — shorter than the rAF wait #130 filed, but the same class (George, round
  // 2, on the first-take Resume remount that #614 since retired). The rAF loop
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
      const around = contextRef.current;
      // One factor for every bar this frame (#1189): the committed clip's
      // display gain when there is one, absolute (1) for a first take.
      // Clamped because the new take can be louder than the clip it was
      // fitted to.
      const gain = around ? around.gain : 1;
      const bar = (i: number, lo: number, hi: number) => {
        const x = ((i / buckets - win.startFraction) / span) * w;
        const top = mid - clampUnit(hi * gain) * mid;
        const bottom = mid - clampUnit(lo * gain) * mid;
        ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
      };
      // The existing clip (#640), in the same colour and at the same scale as
      // the take: `before` fills the not-yet pad left of the new audio,
      // walking outward from the oldest real column, and `after` runs from the
      // head to the right edge. Folded to the MEASURED column rate so a second
      // of stored audio is as wide as a second of the take beside it.
      if (around) {
        const bucketsPerColumn =
          CANONICAL_SAMPLE_RATE /
          rateRef.current.rate /
          around.samplesPerBucket;
        const right = columnsRightOfHead(buckets, span);
        const need = Math.max(buckets, right);
        if (foldRef.current.min.length < need) {
          foldRef.current = {
            min: new Float32Array(need),
            max: new Float32Array(need),
          };
        }
        const fold = foldRef.current;
        const oldest = buckets - scope.count;
        const left = foldContextSide(
          around.before,
          bucketsPerColumn,
          oldest,
          fold.min,
          fold.max
        );
        for (let j = 0; j < left; j++) {
          bar(oldest - 1 - j, fold.min[j]!, fold.max[j]!);
        }
        const ahead = foldContextSide(
          around.after,
          bucketsPerColumn,
          right,
          fold.min,
          fold.max
        );
        for (let j = 0; j < ahead; j++) {
          bar(buckets + j, fold.min[j]!, fold.max[j]!);
        }
      }
      // Paint only the real trailing columns; the leading `buckets - count` are
      // the not-yet pad (silence-valued, must not draw).
      for (let i = buckets - scope.count; i < buckets; i++) {
        bar(i, scope.min[i] ?? 0, scope.max[i] ?? 0);
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
      // the first rAF, so a mount or an effect re-run never shows a blank
      // frame while the ring waits for its first tick (#130 — found on the
      // first-take Resume remount that #614 since retired; a `theme` re-run
      // mid-take takes the same path today).
      //
      // This MUST be the non-mutating peek. `readScope` advances the ring, and
      // this effect re-runs on every `active` edge and `theme` change, so using
      // it here folded an extra column per re-run — the waveform ran ahead of
      // real time, ~5% of the window after ten pause→resume cycles while those
      // existed (George, round 3). The peek also draws when the tap is
      // refusing frames, which is exactly the frozen ring this paint exists to
      // show.
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
          // One more column pushed: fold it into the rate before painting, so
          // the context this frame draws is at the scale the ring runs at.
          advanceColumnRate(rateRef.current, performance.now());
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
