import { useCallback, useMemo, useState } from "react";

import {
  clampRange,
  sliceRange,
  spansWholeSample,
  wholeSampleRange,
} from "@/lib/audio/edit";
import {
  canRedo as logCanRedo,
  canUndo as logCanUndo,
  emptyLog,
  materialize,
  opRedone,
  opUndone,
  pushOp,
  redo as logRedo,
  undo as logUndo,
  type EditLog,
  type EditOp,
} from "@/lib/audio/edit-log";
import { computePeaks } from "@/lib/audio/peaks";
import type { Peaks, SampleRange } from "@/types/audio";

/**
 * Waveform resolution of the recorder stage — coarser than a row is wrong.
 *
 * The only declaration: `useRecorderSegment` used to carry a second copy for a
 * peaks pass nothing drew, dropped with it (L-9, #160). A row's resolution is
 * `ROW_PEAK_BUCKETS`, which is a different number for a different surface.
 */
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
  /** Selection mode is on: the frame is shown (pan stays available beneath it). */
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
  /** Cut the selection to the clipboard, then drop the frame. Returns the
   *  whole-sample range removed — the same truncated bounds `cut`/
   *  `sliceRange` (`lib/audio/edit.ts`) act on, via `wholeSampleRange`, not
   *  the raw fractional selection — or null if nothing was cut. */
  readonly cut: () => SampleRange | null;
  /** Paste the clipboard at a sample offset (the centerline). */
  readonly paste: (atSample: number) => void;
  /** Step history back one op. Returns the op that was undone (so the
   *  recorder can map the centerline through its inverse, #449), or null if
   *  there was nothing to undo or the rematerialise failed. */
  readonly undo: () => EditOp | null;
  /** Step history forward one op. Returns the op that was (re-)applied, or
   *  null if there was nothing to redo or the rematerialise failed. */
  readonly redo: () => EditOp | null;
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
    (produce: () => { next: History; after?: () => void }): boolean => {
      try {
        const { next, after } = produce();
        setHist(next);
        setError(false);
        after?.();
        return true;
      } catch (cause) {
        console.error("An edit could not be applied", cause);
        setError(true);
        return false;
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

  // Returns the whole-sample range actually removed, or null if nothing was
  // cut or the edit failed — so the recorder can shift the pan left by a cut
  // that fell before the centerline. Normalised through `wholeSampleRange`
  // (#512 George R1 P3), not just `clampRange`: the buffer edit below
  // (`sliceRange`/`cut` in `lib/audio/edit.ts`) truncates fractional edges
  // the way `Int16Array.slice` does, so the range stored on the `EditOp` —
  // and handed back here — must already be truncated too, or a caller that
  // does not re-truncate (the mappers in `recorder-stage.ts` do, today, but
  // `wholeSampleRange`'s own docblock calls itself "the ONE place" this
  // happens) reads a position `Math.round`ed instead of truncated.
  const cut = useCallback((): SampleRange | null => {
    if (!selection) return null;
    const range = wholeSampleRange(clampRange(selection, working.length));
    // Nothing picked — and "picked" is the one `spansWholeSample` question the
    // audition asks, so what Play refuses to sound, Cut refuses to remove. The
    // float compare this replaces called a span inside a single sample a real
    // selection: `sliceRange` then took nothing, yet the op still went onto the
    // undo log and `clipboard.set(removed)` below REPLACED the chapter-wide
    // clipboard with an empty buffer — a tap that did nothing, and silently
    // dropped audio the translator was about to paste somewhere else (Frank R3).
    // Refusing here is not a no-op: it leaves the selection open to be resized.
    if (!spansWholeSample(range)) return null;
    const applied = runEdit(() => {
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
    return applied ? range : null;
  }, [selection, working, log, base, runEdit, clipboard, clearSelection]);

  const paste = useCallback(
    (atSample: number) => {
      const clip = clipboard.clip;
      if (!clip || clip.length === 0) return;
      const at = Math.max(0, Math.min(Math.round(atSample), working.length));
      applyLog(pushOp(log, { kind: "paste", at, clip }));
      // The slot is NOT emptied, and nothing is told about the paste. One cut
      // goes into several segments across a chapter (G3), and two rounds of
      // review established that nothing derived from a paste can safely say the
      // phrase is now somewhere else — an undo or an erase takes it back again.
      // The upgrade guard holds on the samples themselves until the chapter
      // changes (`lib/takes/pending-take.ts`, George R4 P2).
    },
    [clipboard, working.length, log, applyLog]
  );

  // Undo/redo re-materialise from base and clear any open selection, whose
  // sample range was measured against a buffer the history has just changed.
  //
  // Each returns the op it stepped over — the one being undone, or the one
  // being (re-)applied — so the recorder can map the centerline through its
  // inverse (#449) rather than dropping it unconditionally, through the
  // shared `opUndone`/`opRedone` pair (`lib/audio/edit-log.ts`, #512 George
  // R1 P2-2) rather than an inline index read — no test mounts this hook
  // directly today (a jsdom hook-mount harness exists elsewhere in this
  // repo, `tests/use-audio-session-supersession.test.ts`, #735/#739, but
  // nothing applies it here yet, #549), so the "which op did this step pass
  // over" choice is pulled out to where it IS tested, in plain Node. Read
  // BEFORE `applyLog` runs (the cursor this closes over is the pre-step
  // one); `null` when there was nothing to step to, or when `applyLog`'s
  // guard reports the rematerialise failed, mirroring `cut()`'s own
  // `applied ? range : null`.
  const undo = useCallback((): EditOp | null => {
    const undoneOp = opUndone(log);
    if (undoneOp === null) return null;
    const applied = applyLog(logUndo(log), clearSelection);
    return applied ? undoneOp : null;
  }, [log, applyLog, clearSelection]);

  const redo = useCallback((): EditOp | null => {
    const redoneOp = opRedone(log);
    if (redoneOp === null) return null;
    const applied = applyLog(logRedo(log), clearSelection);
    return applied ? redoneOp : null;
  }, [log, applyLog, clearSelection]);

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
    // The scissors' enabled state asks the SAME question `cut` and the audition
    // ask, so the control cannot be live for a span that would remove nothing
    // (Frank R3).
    canCut:
      selectionActive &&
      selectionSpan !== null &&
      spansWholeSample(selectionSpan),
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
