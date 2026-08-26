import { useCallback, useMemo, useState } from "react";

import { clampRange, sliceRange } from "@/lib/audio/edit";
import {
  canRedo as logCanRedo,
  canUndo as logCanUndo,
  emptyLog,
  materialize,
  pushOp,
  redo as logRedo,
  undo as logUndo,
  type EditLog,
} from "@/lib/audio/edit-log";
import { computePeaks } from "@/lib/audio/peaks";
import type { Peaks, SampleRange } from "@/types/audio";

/** Waveform resolution, matched to `useRecorderSegment` so the redraw is stable. */
const PEAK_BUCKETS = 400;

const EMPTY = new Int16Array(0);

/**
 * The clipboard the editor cuts to and pastes from — held ABOVE the recorder so
 * it survives the sheet remounting per segment (G3: reaches across a chapter,
 * lost on close). The recorder is keyed on `segmentId` and torn down on close,
 * so a clipboard inside it could not outlive one segment.
 */
export interface Clipboard {
  readonly clip: Int16Array | null;
  readonly set: (clip: Int16Array | null) => void;
}

export interface SegmentEditor {
  /** The edited audio: the loaded clip with the applied ops replayed over it. */
  readonly working: Int16Array;
  readonly workingLength: number;
  /** Peaks of `working`, recomputed on each edit; null when there is no audio. */
  readonly peaks: Peaks | null;
  /** An op has been applied (and not undone) — the segment must be re-persisted. */
  readonly hasEdits: boolean;
  /** The picked span while selection mode is open, or null (nothing picked). */
  readonly selection: SampleRange | null;
  /** Selection mode is on: the frame is shown and panning is suspended. */
  readonly selectionActive: boolean;
  readonly canCut: boolean;
  readonly canPaste: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Enter selection mode with a seed span (recorder derives it from the view). */
  readonly openSelection: (initial: SampleRange) => void;
  /** Leave selection mode without cutting (the toggle pressed again). */
  readonly closeSelection: () => void;
  /** Update the picked span as a handle drags. Clamped to the buffer. */
  readonly setSelection: (range: SampleRange) => void;
  /** Cut the selection to the clipboard, then drop the frame. */
  readonly cut: () => void;
  /** Paste the clipboard at a sample offset (the centerline). */
  readonly paste: (atSample: number) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

/**
 * The waveform-editing state for one recorder session (B5).
 *
 * The edit history is an in-memory operation log (`edit-log.ts`, O-B): `working`
 * is `original` with the applied ops replayed, so undo/redo is a cursor move and
 * costs a reference per step rather than a buffer snapshot. The log lives only
 * for this session — the flattened `working` is persisted on close, the history
 * is not — which is why this is a hook (session state), not a store.
 *
 * The clipboard is passed in rather than owned here: it must outlive the sheet
 * (G3), so it belongs to `App`. Cut writes it, paste reads it.
 *
 * `original` is the segment's loaded PCM (null until the async load resolves, or
 * on an empty segment); before it arrives the editor is an empty, no-op buffer.
 */
export function useSegmentEditor(
  original: Int16Array | null,
  clipboard: Clipboard
): SegmentEditor {
  const [log, setLog] = useState<EditLog>(emptyLog);
  const [selection, setSelectionState] = useState<SampleRange | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);

  const base = original ?? EMPTY;
  const working = useMemo(() => materialize(base, log), [base, log]);
  const peaks = useMemo(
    () => (working.length > 0 ? computePeaks(working, PEAK_BUCKETS) : null),
    [working]
  );

  const openSelection = useCallback(
    (initial: SampleRange) => {
      setSelectionState(clampRange(initial, working.length));
      setSelectionActive(true);
    },
    [working.length]
  );

  const closeSelection = useCallback(() => {
    setSelectionActive(false);
    setSelectionState(null);
  }, []);

  const setSelection = useCallback(
    (range: SampleRange) => {
      setSelectionState(clampRange(range, working.length));
    },
    [working.length]
  );

  const cut = useCallback(() => {
    if (!selection) return;
    const range = clampRange(selection, working.length);
    if (range.start === range.end) return; // nothing picked — not a no-op cut
    clipboard.set(sliceRange(working, range));
    setLog((l) => pushOp(l, { kind: "cut", range }));
    setSelectionActive(false);
    setSelectionState(null);
  }, [selection, working, clipboard]);

  const paste = useCallback(
    (atSample: number) => {
      const clip = clipboard.clip;
      if (!clip || clip.length === 0) return;
      const at = Math.max(0, Math.min(Math.round(atSample), working.length));
      setLog((l) => pushOp(l, { kind: "paste", at, clip }));
    },
    [clipboard.clip, working.length]
  );

  // Undo/redo move the cursor and clear any open selection, whose sample range
  // was measured against a buffer the history has just changed under it.
  const undo = useCallback(() => {
    setLog(logUndo);
    setSelectionActive(false);
    setSelectionState(null);
  }, []);

  const redo = useCallback(() => {
    setLog(logRedo);
    setSelectionActive(false);
    setSelectionState(null);
  }, []);

  const selectionSpan = selection
    ? clampRange(selection, working.length)
    : null;

  return {
    working,
    workingLength: working.length,
    peaks,
    hasEdits: log.cursor > 0,
    selection,
    selectionActive,
    canCut:
      selectionActive &&
      selectionSpan !== null &&
      selectionSpan.start !== selectionSpan.end,
    canPaste: clipboard.clip !== null && clipboard.clip.length > 0,
    canUndo: logCanUndo(log),
    canRedo: logCanRedo(log),
    openSelection,
    closeSelection,
    setSelection,
    cut,
    paste,
    undo,
    redo,
  };
}
