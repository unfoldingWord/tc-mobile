import { useEffect, useRef } from "react";

import { displayGain } from "@/lib/audio/display-gain";
import { type WaveformWindow } from "@/lib/audio/viewport";
import { cn } from "@/lib/utils";
import type { Peaks } from "@/types/audio";

interface WaveformProps {
  /** Precomputed peaks, or `null` for a segment with no recording. */
  peaks: Peaks | null;
  height?: number;
  /**
   * The recorder's buffer is sounding. The playhead itself is a DOM overlay now
   * (`PlayheadOverlay`, #102), not a bar in this canvas — this flag only tells
   * the canvas to SUPPRESS its record centerline during playback, where a
   * mid-clip red (insert-here) marker the disabled Record cannot act on would
   * mislead (George R2). Recorder-only; a row never sets it.
   */
  playing?: boolean;
  recorded?: boolean;
  className?: string;
  /**
   * Recorder mode (B4): draw only `view`'s slice of the clip, offset so the
   * centerline stays put while the audio pans under it. Omitted for a row.
   */
  view?: WaveformWindow | null;
  /**
   * The recorder is actively capturing (recording or paused). Keeps the red
   * centerline visible during a FIRST take — when there is no committed audio
   * yet (`recorded` is false) but the line still marks where recording is
   * happening. Without it, gating the centerline on `recorded` alone would drop
   * the record-position marker mid-first-take. Idle + never-recorded (neither
   * `recorded` nor `capturing`) shows no red line, per the requirements
   * owner's build feedback: the centerline appears only when a waveform exists
   * or one is being made.
   */
  capturing?: boolean;
  /**
   * A take is being made on a segment with NO committed audio yet — the paused
   * first take whose decoded preview this canvas draws while `LiveScope` is
   * unmounted (#101). It suppresses the #358 display fit, so that preview reads
   * at the same absolute level as the scope it replaced and Resume does not
   * collapse it again (George R1 P2).
   *
   * Narrower than `capturing` on purpose. A punch-in draws the segment's already
   * committed audio while recording, and un-fitting THAT is the #358 complaint
   * all over again at the moment the translator is aiming at the centreline
   * (George R2 P2). A row never sets it; a stored take is always fitted.
   */
  firstTakeInFlight?: boolean;
  /**
   * A finished row repaints in the green (`--s-done`) role. The stroke colour
   * still comes from the inherited `--c-wave-stroke` (remapped by
   * `.row--finished`); this flag exists only so the draw effect RE-RUNS when
   * finished toggles — a canvas painted once cannot observe a CSS-variable
   * change on its own (Frank/George R1 P2, the converged finding).
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
  playing = false,
  recorded = true,
  className,
  view = null,
  finished = false,
  capturing = false,
  firstTakeInFlight = false,
}: WaveformProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
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
    // back to the resolved voice value, then to amber, for a canvas outside a row.
    const stroke =
      styles.getPropertyValue("--c-wave-stroke").trim() ||
      styles.getPropertyValue("--s-voice").trim() ||
      "#e6a444";
    const faint = styles.getPropertyValue("--s-ink-faint").trim() || "#5f6b7a";
    const live = styles.getPropertyValue("--s-live").trim() || "#d84a4a";
    const mid = h / 2;

    // The fixed centerline (recorder mode): drawn last so it sits over the
    // audio, and in the record colour because it is where recording starts.
    // Suppressed while the buffer plays: during playback the recorder swaps to a
    // whole-clip view where the centerline would fall mid-clip and read as a
    // (red, insert-here) marker the disabled Record cannot act on — the sweeping
    // playhead overlay is the only position cue that means anything then (George R2).
    const drawCenterline = () => {
      if (!view || playing) return;
      // Only when a waveform exists (`recorded`) or one is being made
      // (`capturing`); an idle never-recorded segment shows the dotted rule with
      // no red line (the requirements owner's build feedback).
      if (!recorded && !capturing) return;
      ctx.fillStyle = live;
      ctx.fillRect(Math.round(view.centerFraction * w) - 1, 0, 2, h);
    };

    if (!peaks || !recorded) {
      // Not "an empty waveform" — a distinct dotted rule, so an unrecorded
      // segment never reads as a recording of silence.
      ctx.fillStyle = faint;
      ctx.globalAlpha = 0.55;
      for (let x = 0; x < w; x += 6) ctx.fillRect(x, mid - 1, 3, 2);
      ctx.globalAlpha = 1;
      drawCenterline();
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
    // `firstTakeInFlight` — NOT `capturing` — suppresses the fit, so an
    // uncommitted take reads at the same absolute level as the `LiveScope` this
    // canvas replaces mid-take, while committed audio that a punch-in is
    // recording over stays fitted and aimable (George R1 P2, R2 P2; the prop's
    // docblock carries both failures).
    const gain = displayGain(peaks, firstTakeInFlight);
    ctx.fillStyle = stroke;
    if (view) {
      // A bucket's fraction of the clip maps to a screen x by where the visible
      // window falls; a bucket outside the window is simply skipped. The span
      // is never zero (zoom ≥ 1, length ≥ 1), so no divide-by-zero guard.
      const span = view.endFraction - view.startFraction;
      const barW = Math.max(1, w / buckets / span - 1);
      for (let i = 0; i < buckets; i++) {
        const x = ((i / buckets - view.startFraction) / span) * w;
        if (x < -barW || x > w) continue;
        const top = mid - (peaks.max[i] ?? 0) * gain * mid;
        const bottom = mid - (peaks.min[i] ?? 0) * gain * mid;
        ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
      }
      drawCenterline();
      // The playback playhead is a DOM overlay now (`PlayheadOverlay`, #102), not
      // a bar here — so this draw effect no longer re-runs per position tick.
      return;
    }

    const barW = Math.max(1, w / buckets - 1);
    for (let i = 0; i < buckets; i++) {
      const x = (i / buckets) * w;
      const top = mid - (peaks.max[i] ?? 0) * gain * mid;
      const bottom = mid - (peaks.min[i] ?? 0) * gain * mid;
      ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
    }
    // `finished` is in the deps for its side effect only: it changes with the
    // `.row--finished` class, so listing it re-runs this draw (which re-reads
    // the now-green `--c-wave-stroke`) on the toggle. Not referenced above.
    // `firstTakeInFlight` IS referenced, in the gain above, and it toggles on
    // the Record and Back edges without `peaks` changing — the whole point of
    // the flag is that the same peaks draw at a different scale either side of
    // it, so a stale deps array would leave the canvas at the old scale until
    // something else happened to invalidate it.
  }, [
    peaks,
    playing,
    recorded,
    height,
    view,
    finished,
    capturing,
    firstTakeInFlight,
  ]);

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className={cn("block w-full", className)}
    />
  );
}
