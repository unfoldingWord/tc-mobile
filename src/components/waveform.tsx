import { useEffect, useRef } from "react";

import { computePeaks } from "@/lib/audio/peaks";
import { cn } from "@/lib/utils";

interface WaveformProps {
  samples: Int16Array;
  /** Playback position as a fraction of the clip, or null when not playing. */
  playhead?: number | null;
  /** Selected edit window as fractions of the clip, or null. */
  selection?: { start: number; end: number } | null;
  className?: string;
  onScrub?: (fraction: number) => void;
}

/**
 * Canvas waveform.
 *
 * Canvas rather than SVG because a two-minute clip is thousands of bars and
 * that many DOM nodes is visibly slow on the entry-level Android phones this
 * has to run on.
 */
export function Waveform({
  samples,
  playhead = null,
  selection = null,
  className,
  onScrub,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth === 0 || cssHeight === 0) return;

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const mid = cssHeight / 2;

    if (selection) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.18)";
      const x0 = selection.start * cssWidth;
      ctx.fillRect(
        x0,
        0,
        (selection.end - selection.start) * cssWidth,
        cssHeight
      );
    }

    if (samples.length === 0) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(cssWidth, mid);
      ctx.stroke();
      return;
    }

    const buckets = Math.max(1, Math.floor(cssWidth));
    const peaks = computePeaks(samples, buckets);

    ctx.fillStyle = "#38bdf8";
    for (let i = 0; i < buckets; i++) {
      const top = mid - (peaks.max[i] ?? 0) * mid;
      const bottom = mid - (peaks.min[i] ?? 0) * mid;
      // Always paint at least one pixel so silence still reads as a line
      // rather than disappearing entirely.
      ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
    }

    if (playhead !== null) {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(
        Math.min(cssWidth - 2, playhead * cssWidth),
        0,
        2,
        cssHeight
      );
    }
  }, [samples, playhead, selection]);

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onScrub) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onScrub(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointer}
      className={cn(
        "h-32 w-full touch-none rounded-xl bg-slate-900",
        className
      )}
    />
  );
}
