import { useCallback, useRef } from "react";

import { viewportXToSample } from "@/lib/audio/viewport";
import type { WaveformViewport } from "@/lib/audio/viewport";
import type { SampleRange } from "@/types/audio";

interface SelectionOverlayProps {
  /** The viewport the waveform is drawn under — the sample↔x mapping. */
  readonly win: WaveformViewport;
  /** The picked span in samples (may be reversed; normalised for display). */
  readonly selection: SampleRange;
  readonly workingLength: number;
  /** Report a moved edge; the editor clamps and normalises. */
  readonly onChange: (range: SampleRange) => void;
  readonly startLabel: string;
  readonly endLabel: string;
}

/**
 * The on-canvas selection frame (mockup 4): a highlighted span with a draggable
 * handle at each edge, laid over the waveform.
 *
 * The waveform is a canvas, so the frame cannot hang off a DOM bar — it is an
 * absolutely-positioned sibling filling the same stage. Positions are expressed
 * as fractions of the viewport width (CSS percentages), so no measured pixel
 * width is needed to render; a drag reads the live width once, at the event, to
 * turn a pointer x back into a sample (the same conversion the pan uses).
 *
 * The body is pointer-transparent; only the two handles take pointer events, so
 * the frame never eats a tap meant for a control. Panning is suspended while the
 * frame is open (the recorder gates it), so nothing competes for the drag.
 */
export function SelectionOverlay({
  win,
  selection,
  workingLength,
  onChange,
  startLabel,
  endLabel,
}: SelectionOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<"start" | "end" | null>(null);

  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  const leftPct = ((lo - win.start) / win.visibleSamples) * 100;
  const widthPct = ((hi - lo) / win.visibleSamples) * 100;

  const moveEdge = useCallback(
    (clientX: number) => {
      const edge = dragEdge.current;
      if (!edge) return;
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      const sample = viewportXToSample(clientX - rect.left, rect.width, win);
      onChange(
        edge === "start"
          ? { start: sample, end: selection.end }
          : { start: selection.start, end: sample }
      );
    },
    [onChange, win, selection.start, selection.end]
  );

  const handle = (edge: "start" | "end", label: string, valueNow: number) => (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={workingLength}
      aria-valuenow={Math.round(valueNow)}
      tabIndex={0}
      className="selection-handle"
      style={{
        left: `${((valueNow - win.start) / win.visibleSamples) * 100}%`,
      }}
      onPointerDown={(e) => {
        dragEdge.current = edge;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => moveEdge(e.clientX)}
      onPointerUp={(e) => {
        dragEdge.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragEdge.current = null;
      }}
      onKeyDown={(e) => {
        // Nudge one bucket per arrow press, so the frame is operable without a
        // precise drag (a bucket is `visibleSamples / 400`, the drawn resolution).
        const step = win.visibleSamples / 400;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? -step : step;
          onChange(
            edge === "start"
              ? { start: selection.start + delta, end: selection.end }
              : { start: selection.start, end: selection.end + delta }
          );
        }
      }}
    />
  );

  return (
    <div ref={hostRef} className="selection-overlay" aria-hidden={false}>
      <div
        className="selection-band"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
      {handle("start", startLabel, selection.start)}
      {handle("end", endLabel, selection.end)}
    </div>
  );
}
