import { useLayoutEffect, useRef } from "react";

import {
  CANVAS_FALLBACK_FAINT,
  CANVAS_FALLBACK_VOICE,
  withCanvasFallback,
} from "./canvas-fallback-colors";
import { useLiveTheme } from "@/hooks/use-theme";
import { clampUnit, displayGain } from "@/lib/audio/display-gain";
import { type WaveformWindow } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";
import type { Peaks } from "@/types/audio";

interface WaveformProps {
  /** Precomputed peaks, or `null` for a segment with no recording. */
  peaks: Peaks | null;
  height?: number;
  recorded?: boolean;
  className?: string;
  /**
   * Recorder mode (B4): draw only `view`'s slice of the clip, offset so the
   * centerline stays put while the audio pans under it. Omitted for a row.
   */
  view?: WaveformWindow | null;
  /**
   * A take is being made on a segment with NO committed audio yet — the paused
   * first take whose decoded preview this canvas draws while `LiveScope` is
   * unmounted (#101). It suppresses the #358 display fit, so that preview reads
   * at the same absolute level as the scope it replaced and Resume does not
   * collapse it again (George R1 P2).
   *
   * Narrower than "recording or paused" on purpose (the `capturing` prop this
   * used to be checked against was removed with #316, once the centerline
   * stopped needing a capturing flag to stay visible — see `recorder.tsx`'s
   * call site). A punch-in draws the segment's already committed audio while
   * recording, and un-fitting THAT is the #358 complaint all over again at
   * the moment the translator is aiming at the centreline (George R2 P2). A
   * row never sets it; a stored take is always fitted.
   */
  firstTakeInFlight?: boolean;
  /**
   * The peaks `displayGain` fits to, when they differ from `peaks` itself —
   * the punch-in Pause+Play preview, which PAINTS the merged buffer (`#101`'s
   * `previewShown.peaks`, insert included) but must FIT to the segment's
   * already-committed clip, not the preview (George R3 P2). Undefined (not
   * just omitted) falls back to `peaks`, which is every other call site: idle,
   * a first take, and a row never pass this, so nothing changes for them.
   *
   * A frozen gain fitted to one buffer and applied to a louder one can push
   * `value * gain` past the canvas edge — `displayGain`'s own [-1, 1]
   * guarantee only covers the buffer it was fitted to — so the draw loops
   * below clamp with `clampUnit` rather than assuming the invariant still
   * holds.
   */
  fitFrom?: Peaks | null;
  /**
   * A finished row, or the recorder of a finished segment (#926), repaints in
   * the green (`--s-done`) role. The stroke colour still comes from the
   * inherited `--c-wave-stroke` (remapped by `.row--finished` and
   * `.recorder-sheet--finished`); this flag exists only so the draw effect RE-RUNS when
   * finished toggles — a canvas painted once cannot observe a CSS-variable
   * change on its own (Frank/George R1 P2, the converged finding). A
   * `data-theme` switch is a CSS-variable change of the same class, which is
   * why the draw effect also subscribes to the live theme (George R2 P2 on
   * #457).
   */
  finished?: boolean;
}

/**
 * Canvas waveform.
 *
 * Canvas rather than SVG because a long section is thousands of bars, and that
 * many DOM nodes is visibly slow on the entry-level Android this has to run on.
 *
 * Colour carries the meaning: amber when there is audio, cold and faint when
 * there is not. That contrast is the fastest read on the section list, and it
 * requires no literacy.
 */
export function Waveform({
  peaks,
  height = 26,
  recorded = true,
  className,
  view = null,
  finished = false,
  firstTakeInFlight = false,
  fitFrom,
}: WaveformProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Read for its subscription only: a `data-theme` switch remaps every token
  // this draw reads (`--c-wave-stroke`, `--s-voice`, `--s-ink-faint`), and a
  // painted canvas cannot see that on its own — so the draw effect lists it.
  // Written while the toggle was Books-only, where a toggle unmounted every
  // canvas and this cost nothing yet; #149 put the toggle in the chapter and
  // recorder menus, so this is now what keeps the bars from holding the
  // previous theme's colours rather than what will (George R2 P2 on #457).
  const theme = useLiveTheme();

  // `useLayoutEffect`, not `useEffect`: the first paint below must land BEFORE
  // the browser paints a freshly-mounted canvas — the same reasoning
  // `LiveScope` documents for its own mount effect. A first-take Pause+Play
  // preview, and (since #283) an append's Pause+Play preview, both remount
  // this component right where `LiveScope` unmounts; in `useEffect` the
  // synchronous paint still runs after the browser had already shown one
  // blank frame (George R-resume, rounds 1 and 2, both raised the class even
  // though the fix each round landed on did not itself need it — closing it
  // here rather than leaving it latent for the next remount path to hit).
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(canvas);
    // The bar colour is a component token so a finished row can remap it to green
    // (`.row--finished { --c-wave-stroke: var(--s-done) }`) without a prop. Falls
    // back to the resolved voice value, then, only if BOTH reads come back
    // empty, to the unthemed dark-only fallback in `canvas-fallback-colors.ts`
    // (#506 item 1) — a token failing to resolve, not the normal path.
    const stroke = withCanvasFallback(
      styles.getPropertyValue("--c-wave-stroke"),
      withCanvasFallback(
        styles.getPropertyValue("--s-voice"),
        CANVAS_FALLBACK_VOICE
      )
    );
    const faint = withCanvasFallback(
      styles.getPropertyValue("--s-ink-faint"),
      CANVAS_FALLBACK_FAINT
    );
    const mid = h / 2;

    // The centerline is NOT painted here (#415). It used to be, unconditionally
    // whenever a recorder `view` was present (#316). But the recorder now
    // translates this canvas under a line that must not move with it, so the
    // line is a fixed element on the stage instead — see `recorder.tsx`'s
    // centerline overlay, and `recorder-stage.ts` for the history. That #415
    // change was only about WHERE it paints. WHEN it shows changed later, with
    // #418: the overlay now hides for a loaded edit-mode span (and while
    // `LiveScope` owns the stage), and stays visible otherwise
    // (`centerlineOverlayShown` in `recorder-stage.ts`).

    if (!peaks || !recorded) {
      // Not "an empty waveform" — a distinct dotted rule, so an unrecorded
      // segment never reads as a recording of silence.
      ctx.fillStyle = faint;
      ctx.globalAlpha = 0.55;
      for (let x = 0; x < w; x += 6) ctx.fillRect(x, mid - 1, 3, 2);
      ctx.globalAlpha = 1;
      return;
    }

    const buckets = peaks.min.length;
    // Fit the take to the lane (#358). DISPLAY ONLY: the samples, the stored
    // peaks, the MP3 and the export are untouched — this is a factor applied to
    // the drawn height, never a gain on the audio (that is #359). Computed here
    // rather than passed in so every call site — the recorder canvas and the
    // Segments-list row — is scaled by the same rule, and recomputed from
    // `peaks` alone so it is the same number on every repaint: panning and
    // zooming change `view`, not the peaks, so the waveform does not breathe.
    // 400 buckets in the recorder, 120 in a row — one extra pass over what the
    // draw loop below already walks.
    //
    // `firstTakeInFlight` — narrower than "recording or paused" — suppresses
    // the fit, so an uncommitted take reads at the same absolute level as the
    // `LiveScope` this canvas replaces mid-take, while committed audio that a
    // punch-in is recording over stays fitted and aimable (George R1 P2, R2
    // P2; the prop's docblock carries both failures).
    //
    // Fit from `fitFrom` when the caller supplied one — the punch-in Pause+Play
    // preview paints the merged buffer but must fit to the committed clip, not
    // the preview it is momentarily replacing (George R3 P2, `fitFrom`'s
    // docblock). Every other call site leaves this undefined and fits the
    // buffer it draws, same as before.
    const gain = displayGain(fitFrom ?? peaks, firstTakeInFlight);
    if (view) {
      // The amplitude axis, faint, across the whole drawn width and UNDER the
      // bars (#415: "left of the centerline there is no audio yet, so show only
      // a grayed-out horizontal line... at the end... the same grayed-out
      // horizontal line running to the right edge"). Where there IS audio the
      // bars cover it — a silent stretch draws a 1.5px bar of its own — so what
      // this actually renders is the blank head and tail the window (or, during
      // playback, the strip) overhangs the clip by. Recorder only: a row draws
      // no `view` and is unchanged.
      ctx.fillStyle = faint;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, mid - 1, w, 2);
      ctx.globalAlpha = 1;
      // A bucket's fraction of the clip maps to a screen x by where the visible
      // window falls; a bucket outside the window is simply skipped. The span
      // is never zero (zoom ≥ 1, length ≥ 1), so no divide-by-zero guard.
      ctx.fillStyle = stroke;
      const span = view.endFraction - view.startFraction;
      const barW = Math.max(1, w / buckets / span - 1);
      for (let i = 0; i < buckets; i++) {
        const x = ((i / buckets - view.startFraction) / span) * w;
        if (x < -barW || x > w) continue;
        // Clamped: `gain` may be fitted from `fitFrom`, a different buffer
        // than `peaks` (George R3 P2), so `displayGain`'s own [-1, 1]
        // guarantee for `peaks` alone does not cover this product.
        const top = mid - clampUnit((peaks.max[i] ?? 0) * gain) * mid;
        const bottom = mid - clampUnit((peaks.min[i] ?? 0) * gain) * mid;
        ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
      }
      // Neither the playhead (`PlayheadOverlay`, #102) nor the centerline
      // (#415) is a bar here — both are DOM elements over this canvas — so this
      // draw effect re-runs on peaks/window changes only, never per frame.
      return;
    }

    ctx.fillStyle = stroke;
    const barW = Math.max(1, w / buckets - 1);
    for (let i = 0; i < buckets; i++) {
      const x = (i / buckets) * w;
      // Clamped for the same reason as the `view` loop above: `gain` may be
      // fitted from a different buffer than `peaks` (`fitFrom`, George R3 P2).
      const top = mid - clampUnit((peaks.max[i] ?? 0) * gain) * mid;
      const bottom = mid - clampUnit((peaks.min[i] ?? 0) * gain) * mid;
      ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
    }
    // `finished` is in the deps for its side effect only: it changes with the
    // `.row--finished` / `.recorder-sheet--finished` class, so listing it
    // re-runs this draw (which re-reads the now-green `--c-wave-stroke`) on the
    // toggle. Not referenced above.
    // `theme` is the same shape for the same reason: a `data-theme` switch
    // remaps the tokens read above, and only a re-run re-reads them.
    // `firstTakeInFlight` IS referenced, in the gain above, and it toggles on
    // the Record and Back edges without `peaks` changing — the whole point of
    // the flag is that the same peaks draw at a different scale either side of
    // it, so a stale deps array would leave the canvas at the old scale until
    // something else happened to invalidate it. `fitFrom` is referenced there
    // too: it can change (preview shown/cleared) while `peaks` also changes,
    // and a stale value would fit the previous stage's committed clip to the
    // current one's preview.
  }, [
    peaks,
    recorded,
    height,
    view,
    finished,
    firstTakeInFlight,
    fitFrom,
    theme,
  ]);

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className={cn("block w-full", className)}
    />
  );
}
