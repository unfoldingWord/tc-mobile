/**
 * The recorder's in-memory edit history — an operation log, not buffer copies.
 *
 * D2 (and O-B, 2026-08-26): undo is recorded as *what happened* — a cut of a
 * range, a paste of a clip at an offset — and the current audio is the original
 * buffer with those operations replayed over it. The alternative, keeping a
 * snapshot per step, costs ~16 MB for every edit of a three-minute segment
 * against a storage budget that is already #12's subject; the log costs a range
 * or a reference instead.
 *
 * The log is DOM-free and pure, so the whole undo/redo machine is testable in
 * plain Node with no canvas and no microphone — the same property that keeps
 * `edit.ts` unit-testable. It holds no audio of its own beyond the references a
 * paste carries: `materialize` folds the ops over a buffer the caller owns.
 *
 * Lifetime is the editing session only (O-B): the flattened result is persisted
 * on close, but the history is not — reopening a segment starts with an empty
 * log. Persisted, restart-surviving undo is the literal-D2 variant, deferred.
 */

import { cut, insertAt } from "./edit";
import type { SampleRange } from "@/types/audio";

/**
 * One recorded edit.
 *
 * A `paste` holds a *reference* to the pasted samples rather than copying them:
 * the bytes already exist (they are the clipboard's contents at paste time, and
 * the clipboard is replaced wholesale on each cut, never mutated in place), so
 * the reference stays valid for the life of the log.
 */
export type EditOp =
  | { readonly kind: "cut"; readonly range: SampleRange }
  | { readonly kind: "paste"; readonly at: number; readonly clip: Int16Array };

/**
 * The history and a cursor into it.
 *
 * `cursor` is how many ops are currently applied. Undo moves it back, redo
 * moves it forward, and a new op after an undo truncates the redo tail — the
 * standard linear-history model, no branching. Everything is immutable: each
 * transition returns a new `EditLog`, so React state holds it directly.
 */
export interface EditLog {
  readonly ops: readonly EditOp[];
  readonly cursor: number;
}

/** A history with nothing applied and nothing to redo. */
export function emptyLog(): EditLog {
  return { ops: [], cursor: 0 };
}

/**
 * Record a new op at the cursor, discarding any undone tail.
 *
 * The op is captured against the CURRENT materialised buffer, so replaying the
 * ops in order from the original reproduces the same intermediate buffers each
 * op was recorded against — which is what makes a stored range or offset still
 * valid on replay.
 */
export function pushOp(log: EditLog, op: EditOp): EditLog {
  const ops = log.ops.slice(0, log.cursor);
  ops.push(op);
  return { ops, cursor: ops.length };
}

export function canUndo(log: EditLog): boolean {
  return log.cursor > 0;
}

export function canRedo(log: EditLog): boolean {
  return log.cursor < log.ops.length;
}

/** Step back one op. A no-op at the start of history. */
export function undo(log: EditLog): EditLog {
  return canUndo(log) ? { ops: log.ops, cursor: log.cursor - 1 } : log;
}

/** Re-apply the next undone op. A no-op at the end of history. */
export function redo(log: EditLog): EditLog {
  return canRedo(log) ? { ops: log.ops, cursor: log.cursor + 1 } : log;
}

/**
 * The op {@link undo} is about to step over — the last applied one — or
 * `null` at the start of history.
 *
 * Pulled out of `useSegmentEditor` (#512 George R1 P2-2): the hook returns
 * this same op so `recorder.tsx` can map the centerline through its inverse
 * (#449), and that "which op did this step pass over" choice used to live
 * only as an inline `log.ops[log.cursor - 1]` read in the hook — untested,
 * because no test mounts the hook itself directly (a jsdom hook-mount
 * harness exists elsewhere in this repo,
 * `tests/use-audio-session-supersession.test.ts`, #735/#739, but nothing
 * applies it here yet, #549). Read BEFORE the cursor moves, next to the log
 * it reads, so the seam is testable in plain Node
 * (`tests/audio-edit-log.test.ts`, `tests/recorder-stage.test.ts`).
 */
export function opUndone(log: EditLog): EditOp | null {
  return canUndo(log) ? (log.ops[log.cursor - 1] ?? null) : null;
}

/**
 * The op {@link redo} is about to step over — the next undone one — or
 * `null` at the end of history. {@link opUndone}'s forward-history sibling.
 */
export function opRedone(log: EditLog): EditOp | null {
  return canRedo(log) ? (log.ops[log.cursor] ?? null) : null;
}

/**
 * The audio the log currently describes: `original` with the applied ops
 * (those before the cursor) replayed in order.
 *
 * Pure — `original` is not mutated; each op returns a fresh buffer from
 * `edit.ts`. A cut drops its range; a paste splices its clip in. The undone
 * tail (ops at or after the cursor) is not applied, which is exactly what makes
 * an undo reversible: redo just moves the cursor forward and re-folds.
 */
export function materialize(original: Int16Array, log: EditLog): Int16Array {
  let buffer = original;
  for (const op of log.ops.slice(0, log.cursor)) {
    buffer =
      op.kind === "cut"
        ? cut(buffer, op.range).remaining
        : insertAt(buffer, op.clip, op.at);
  }
  return buffer;
}
