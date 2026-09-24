import { useState } from "react";

import {
  effectivePan,
  viewportWindow,
  type WaveformViewport,
} from "@/lib/audio/viewport";

export interface RecorderViewport {
  /**
   * Move the pan the RECORD path splices at. `null` ⇒ resting at the end of
   * the existing audio (append-ready, F7): the sheet mounts fresh on every
   * open, so `null` IS the open state, and a drag is what replaces it with an
   * absolute sample position.
   *
   * The setter WITHOUT its value, deliberately. Reading the raw offset is what
   * #346's P1 was — the view drawn from the record insertion point, or worse
   * the record point taken from the view. Callers get `pan` to draw and
   * `insertionPan` to splice, and there is no third answer to reach for. An
   * updater still sees the previous value where it belongs, inside the setter.
   */
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
 * that the two values leave one place, named for what each is FOR — `pan` for
 * drawing, `insertionPan` for splicing — and that the raw offset does not
 * leave at all. Only the SETTER is returned, so there is no third answer to
 * reach for and no way to read the record point as a view (or the reverse,
 * which is what #346 actually caught).
 *
 * `mode`, `selectionActive` and `length` are arguments rather than state
 * because they belong to the edit session and the buffer, not to the viewport —
 * the viewport only reads them to decide which pan applies.
 *
 * `centerFraction` and `initialZoom` are arguments for a different reason: both
 * of the recorder's values live in `components/`, and `hooks/` may not import
 * `components/` (the onion, enforced by `no-restricted-imports`). Taking them
 * in keeps the layering honest and the hook free of one screen's constants.
 * `initialZoom` in particular must NOT be inlined as a literal, even one that
 * happens to equal today's `ZOOM_WHOLE`: the caller's zoom-out control writes
 * `ZOOM_WHOLE`, so a copy here that did not track it would leave a fresh open
 * painting at one scale and every later zoom-to-whole at another, with neither
 * value wrong on its own (George R1 #1). `tests/recorder-viewport.test.ts`
 * pins the argument as the level the hook opens at, so a literal here fails.
 */
export function useRecorderViewport(
  mode: "record" | "edit",
  selectionActive: boolean,
  length: number,
  centerFraction: number,
  initialZoom: number
): RecorderViewport {
  const [panState, setPanState] = useState<number | null>(null);
  const [zoomPan, setZoomPan] = useState<number | null>(null);
  const [zoom, setZoom] = useState(initialZoom);

  const pan = effectivePan({
    mode,
    selectionActive,
    zoomPan,
    panState,
    length,
  });

  return {
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
