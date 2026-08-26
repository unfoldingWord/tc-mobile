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
  /** A last edit could not be applied (an allocation failed). */
  readonly error: boolean;
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

/** The base buffer, the current edited buffer, and the history that maps between. */
interface History {
  readonly base: Int16Array;
  readonly working: Int16Array;
  readonly log: EditLog;
}

/**
 * The waveform-editing state for one recorder session (B5).
 *
 * The edit history is an operation log (`edit-log.ts`, O-B): `working` is
 * `original` with the applied ops replayed, so undo/redo is a cursor move and
 * costs a reference per step rather than a buffer snapshot. The log lives only
 * for this session — the flattened `working` is persisted on close, the history
 * is not — which is why this is a hook (session state), not a store.
 *
 * `working` is held in state and recomputed INSIDE the edit handlers, not in a
 * render-time `useMemo`: replaying a paste allocates a buffer the size of the
 * result and can throw on a low-memory device, and a throw during render would
 * crash the sheet (there is no error boundary). Allocating in the handler lets a
 * failure drop the op and surface in place instead — the same move the record
 * save path made for the same OOM class.
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
  const base = original ?? EMPTY;
  const [hist, setHist] = useState<History>(() => ({
    base,
    working: base,
    log: emptyLog(),
  }));
  const [selection, setSelectionState] = useState<SampleRange | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const [error, setError] = useState(false);

  // Reset when the loaded clip changes (the async load resolves, or the hook is
  // reused for a different base). Adjusting state during render — React's
  // documented pattern — keeps `working` consistent with `base` in the same
  // render, with no one-frame empty flash an effect would leave on open.
  if (hist.base !== base) {
    setHist({ base, working: base, log: emptyLog() });
    setSelectionState(null);
    setSelectionActive(false);
    setError(false);
  }
  const { working, log } = hist;

  const peaks = useMemo(
    () => (working.length > 0 ? computePeaks(working, PEAK_BUCKETS) : null),
    [working]
  );

  // Apply a proposed history, allocating the new buffer INSIDE a guard. A paste
  // replays `insertAt`, which allocates the full result and can throw on a
  // low-memory device; a throw must neither advance history nor crash the render
  // tree. On failure everything is dropped and the control reports it in place.
  // `produce` runs ENTIRELY inside the guard — every buffer allocation (a
  // paste's `insertAt`, a cut's `sliceRange`) included — so an OOM there cannot
  // escape the handler with history half-advanced.
  const runEdit = useCallback(
    (produce: () => { next: History; after?: () => void }) => {
      try {
        const { next, after } = produce();
        setHist(next);
        setError(false);
        after?.();
      } catch (cause) {
        console.error("An edit could not be applied", cause);
        setError(true);
      }
    },
    []
  );

  const applyLog = useCallback(
    (nextLog: EditLog, after?: () => void) =>
      runEdit(() => ({
        next: { base, working: materialize(base, nextLog), log: nextLog },
        after,
      })),
    [base, runEdit]
  );

  const clearSelection = useCallback(() => {
    setSelectionActive(false);
    setSelectionState(null);
  }, []);

  // Clamp each endpoint to the buffer but do NOT reorder: a handle dragged past
  // the other edge must stay under the finger. The overlay renders a reversed
  // span (lo/hi), and `cut` normalises with `clampRange` at the point it matters.
  const clampPoint = useCallback(
    (v: number) => Math.max(0, Math.min(v, working.length)),
    [working.length]
  );

  const openSelection = useCallback(
    (initial: SampleRange) => {
      setSelectionState({
        start: clampPoint(initial.start),
        end: clampPoint(initial.end),
      });
      setSelectionActive(true);
    },
    [clampPoint]
  );

  const closeSelection = clearSelection;

  const setSelection = useCallback(
    (range: SampleRange) => {
      setSelectionState({
        start: clampPoint(range.start),
        end: clampPoint(range.end),
      });
    },
    [clampPoint]
  );

  const cut = useCallback(() => {
    if (!selection) return;
    const range = clampRange(selection, working.length);
    if (range.start === range.end) return; // nothing picked — not a no-op cut
    runEdit(() => {
      const removed = sliceRange(working, range);
      const nextLog = pushOp(log, { kind: "cut", range });
      return {
        next: { base, working: materialize(base, nextLog), log: nextLog },
        after: () => {
          clipboard.set(removed);
          clearSelection();
        },
      };
    });
  }, [selection, working, log, base, runEdit, clipboard, clearSelection]);

  const paste = useCallback(
    (atSample: number) => {
      const clip = clipboard.clip;
      if (!clip || clip.length === 0) return;
      const at = Math.max(0, Math.min(Math.round(atSample), working.length));
      applyLog(pushOp(log, { kind: "paste", at, clip }));
    },
    [clipboard.clip, working.length, log, applyLog]
  );

  // Undo/redo re-materialise from base and clear any open selection, whose
  // sample range was measured against a buffer the history has just changed.
  const undo = useCallback(
    () => applyLog(logUndo(log), clearSelection),
    [log, applyLog, clearSelection]
  );

  const redo = useCallback(
    () => applyLog(logRedo(log), clearSelection),
    [log, applyLog, clearSelection]
  );

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
    error,
    openSelection,
    closeSelection,
    setSelection,
    cut,
    paste,
    undo,
    redo,
  };
}
