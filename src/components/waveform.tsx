import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { Peaks } from "@/types/audio";

interface WaveformProps {
  /** Precomputed peaks, or `null` for a section with no recording. */
  peaks: Peaks | null;
  height?: number;
  /** Playback position as a fraction of the clip, or null when not playing. */
  playhead?: number | null;
  recorded?: boolean;
  className?: string;
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
  playhead = null,
  recorded = true,
  className,
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
    const voice = styles.getPropertyValue("--s-voice").trim() || "#e6a444";
    const faint = styles.getPropertyValue("--s-ink-faint").trim() || "#5f6b7a";
    const ink = styles.getPropertyValue("--s-ink").trim() || "#e7ecf3";
    const mid = h / 2;

    if (!peaks || !recorded) {
      // Not "an empty waveform" — a distinct dotted rule, so an unrecorded
      // section never reads as a recording of silence.
      ctx.fillStyle = faint;
      ctx.globalAlpha = 0.55;
      for (let x = 0; x < w; x += 6) ctx.fillRect(x, mid - 1, 3, 2);
      ctx.globalAlpha = 1;
      return;
    }

    const buckets = peaks.min.length;
    const barW = Math.max(1, w / buckets - 1);
    ctx.fillStyle = voice;
    for (let i = 0; i < buckets; i++) {
      const x = (i / buckets) * w;
      const top = mid - (peaks.max[i] ?? 0) * mid;
      const bottom = mid - (peaks.min[i] ?? 0) * mid;
      ctx.fillRect(x, top, barW, Math.max(1.5, bottom - top));
    }

    if (playhead !== null) {
      ctx.fillStyle = ink;
      ctx.fillRect(Math.min(w - 2, playhead * w), 0, 2, h);
    }
  }, [peaks, playhead, recorded, height]);

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className={cn("block w-full", className)}
    />
  );
}
