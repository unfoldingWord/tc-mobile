import { useState } from "react";

import {
  effectivePan,
  viewportWindow,
  type WaveformViewport,
} from "@/lib/audio/viewport";

export interface RecorderViewport {
  /**
   * The pan the RECORD path splices at — `null` ⇒ resting at the end of the
   * existing audio (append-ready, F7). A derived rest rather than a value set
   * in an effect once the segment loads: the sheet mounts fresh on every open,
   * so `null` IS the open state, and a drag is what replaces it with an
   * absolute sample position.
   */
  readonly panState: number | null;
  setPanState: React.Dispatch<React.SetStateAction<number | null>>;
  /**
   * Where a zoom moved the view to keep an open selection on screen (#91).
   * A VIEW value only. Cleared when a selection opens (a fresh span has not
   * been zoomed yet), when a drag takes the pan over, and on leaving edit.
   */
  readonly zoomPan: number | null;
  setZoomPan: React.Dispatch<React.SetStateAction<number | null>>;
  readonly zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  /** The pan actually DRAWN, through `effectivePan`'s gate. */
  readonly pan: number;
  /** The window `pan` and `zoom` put on screen. */
  readonly win: WaveformViewport;
  /** Where a new recording is spliced — `panState`, clamped to the buffer. */
  readonly insertionPan: number;
  /** The window a given pan would put on screen, at the current zoom. */
  windowAt: (pan: number) => WaveformViewport;
}

/**
 * The recorder's pan/zoom viewport: its three pieces of state and the whole
 * derivation chain over them (#160, L-1).
 *
 * These were three `useState`s and three expressions loose in a 4000-line
 * component, which is how the derivation order stopped being obvious — and the
 * order is the part that matters. `pan` is not `panState`: it goes through
 * `effectivePan`, which is the gate keeping a zoom's view fit OUT of the record
 * insertion offset. #346 found that writing a re-centred pan into `panState`
 * would make the next recording splice mid-clip instead of appending, and the
 * fix was to give the view its own value (`zoomPan`) that the record path
 * cannot read.
 *
 * That gate stays where it is — pure and table-tested in `lib/audio/viewport`,
 * deliberately not an expression a reader has to spot. What this hook adds is
 * that the two values now leave one place, named for what each is FOR:
 * `pan` for drawing, `insertionPan` for splicing. A caller reaching past them
 * to raw `panState` for a view is still possible, but it is now visibly
 * reaching past something.
 *
 * `mode`, `selectionActive` and `length` are arguments rather than state
 * because they belong to the edit session and the buffer, not to the viewport —
 * the viewport only reads them to decide which pan applies. `centerFraction`
 * is an argument for a different reason: the recorder's value lives in
 * `components/recorder-stage.ts`, and `hooks/` may not import `components/`
 * (the onion, enforced by `no-restricted-imports`). Taking it in keeps the
 * layering honest and the hook free of one screen's layout constant.
 */
export function useRecorderViewport(
  mode: "record" | "edit",
  selectionActive: boolean,
  length: number,
  centerFraction: number
): RecorderViewport {
  const [panState, setPanState] = useState<number | null>(null);
  const [zoomPan, setZoomPan] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const pan = effectivePan({
    mode,
    selectionActive,
    zoomPan,
    panState,
    length,
  });

  return {
    panState,
    setPanState,
    zoomPan,
    setZoomPan,
    zoom,
    setZoom,
    pan,
    win: viewportWindow(length, pan, zoom, centerFraction),
    insertionPan: Math.min(panState ?? length, length),
    windowAt: (at) => viewportWindow(length, at, zoom, centerFraction),
  };
}
