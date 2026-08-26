import { useCallback, useRef } from "react";

import { sampleToViewportX, viewportXToSample } from "@/lib/audio/viewport";
import type { WaveformViewport } from "@/lib/audio/viewport";
import type { SampleRange } from "@/types/audio";

/** A sample's position as a percentage of the viewport width (width cancels). */
const pct = (sample: number, win: WaveformViewport): number =>
  sampleToViewportX(sample, 100, win);

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
 * the frame never eats a tap meant for a control. Panning stays available on the
 * bare canvas beneath while the frame is open (the handles stopPropagation their
 * own grab), so an off-screen handle can be panned back into reach (George R2).
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
  // The edge under each active pointer, keyed by pointerId — so two fingers on
  // the two handles do not overwrite one shared "which edge" and swap targets
  // mid-drag (the multitouch class of #61, George R2).
  const dragging = useRef<Map<number, "start" | "end">>(new Map());
  // The authoritative range DURING a drag. Each move rebuilds from this ref, not
  // the render closure, so two edges moved in one frame compose instead of the
  // last write clobbering the other's edge (George R3). It is snapshotted from
  // the current selection on the FIRST finger down (below) and updated by every
  // move; between drags the props are authoritative, so no render-time sync is
  // needed (and none is allowed — refs cannot be read during render).
  const liveRange = useRef<SampleRange>(selection);

  const lo = Math.min(selection.start, selection.end);
  const hi = Math.max(selection.start, selection.end);
  const leftPct = pct(lo, win);
  const widthPct = pct(hi, win) - leftPct;

  const moveEdge = useCallback(
    (pointerId: number, clientX: number) => {
      const edge = dragging.current.get(pointerId);
      if (!edge) return;
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      if (rect.width === 0) return;
      const sample = viewportXToSample(clientX - rect.left, rect.width, win);
      const next =
        edge === "start"
          ? { start: sample, end: liveRange.current.end }
          : { start: liveRange.current.start, end: sample };
      liveRange.current = next;
      onChange(next);
    },
    [onChange, win]
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
      style={{ left: `${pct(valueNow, win)}%` }}
      onPointerDown={(e) => {
        // Stop the pan on the canvas beneath from also arming on this grab: only
        // a drag on the bare canvas pans; a handle adjusts its edge (George R2).
        e.stopPropagation();
        // Snapshot the authoritative range on the FIRST finger down, so a second
        // handle grabbed while the first is mid-drag does not reset the shared
        // ref to a stale committed value (George R3).
        if (dragging.current.size === 0) liveRange.current = selection;
        dragging.current.set(e.pointerId, edge);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => moveEdge(e.pointerId, e.clientX)}
      onPointerUp={(e) => {
        dragging.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={(e) => {
        dragging.current.delete(e.pointerId);
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
