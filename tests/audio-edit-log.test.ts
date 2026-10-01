import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  emptyLog,
  materialize,
  opRedone,
  opUndone,
  pushOp,
  redo,
  undo,
  type EditOp,
} from "@/lib/audio/edit-log";

/**
 * The undo/redo machine is an operation log replayed over the original buffer
 * (D2 / O-B), so all of it is arithmetic here — no canvas, no recorder. These
 * cases pin the two properties the recorder leans on: replaying the applied ops
 * reproduces the edited audio, and the cursor moves history without ever
 * mutating the original or the log it was handed.
 */

const buf = (...v: number[]) => Int16Array.from(v);
const arr = (a: Int16Array) => Array.from(a);

const original = buf(1, 2, 3, 4, 5, 6, 7, 8);

describe("edit-log", () => {
  it("starts empty: nothing to undo or redo, materialises to the original", () => {
    const log = emptyLog();
    expect(canUndo(log)).toBe(false);
    expect(canRedo(log)).toBe(false);
    expect(arr(materialize(original, log))).toEqual(arr(original));
  });

  it("applies a cut and offers an undo", () => {
    const log = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    expect(canUndo(log)).toBe(true);
    expect(canRedo(log)).toBe(false);
    // 3,4,5 removed.
    expect(arr(materialize(original, log))).toEqual([1, 2, 6, 7, 8]);
  });

  it("applies a paste as an insert at its offset", () => {
    const log = pushOp(emptyLog(), {
      kind: "paste",
      at: 3,
      clip: buf(90, 91),
    });
    expect(arr(materialize(original, log))).toEqual([
      1, 2, 3, 90, 91, 4, 5, 6, 7, 8,
    ]);
  });

  it("undo reverts the buffer and arms a redo; redo re-applies", () => {
    const cutLog = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 0, end: 3 },
    });
    const undone = undo(cutLog);
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    expect(arr(materialize(original, undone))).toEqual(arr(original));

    const redone = redo(undone);
    expect(canRedo(redone)).toBe(false);
    expect(arr(materialize(original, redone))).toEqual([4, 5, 6, 7, 8]);
  });

  it("undo at the start of history and redo at the end are no-ops", () => {
    const empty = emptyLog();
    expect(undo(empty)).toBe(empty);
    const one = pushOp(empty, { kind: "cut", range: { start: 0, end: 1 } });
    expect(redo(one)).toBe(one);
  });

  it("a new op after an undo discards the redo tail", () => {
    const a = pushOp(emptyLog(), { kind: "cut", range: { start: 6, end: 8 } });
    const b = pushOp(a, { kind: "cut", range: { start: 0, end: 2 } });
    const back = undo(b); // redo of the second cut is now available
    expect(canRedo(back)).toBe(true);

    const c = pushOp(back, { kind: "paste", at: 0, clip: buf(99) });
    // The second cut is gone from history — only the first cut and the paste.
    expect(canRedo(c)).toBe(false);
    // First cut removed 7,8; paste prepends 99.
    expect(arr(materialize(original, c))).toEqual([99, 1, 2, 3, 4, 5, 6]);
  });

  it("round-trips a cut then a paste of the removed range back to the original", () => {
    // The B5 cut→paste invariant, through the log: cut [2,5), paste the removed
    // samples back at the cut point.
    const removed = original.slice(2, 5); // 3,4,5
    const log = pushOp(
      pushOp(emptyLog(), { kind: "cut", range: { start: 2, end: 5 } }),
      { kind: "paste", at: 2, clip: removed }
    );
    expect(arr(materialize(original, log))).toEqual(arr(original));
  });

  it("replays sequential ops against their intermediate buffers", () => {
    // The second cut's range is meaningful only after the first cut shortened
    // the buffer — replay in order must reproduce those intermediate states.
    const log = pushOp(
      pushOp(emptyLog(), { kind: "cut", range: { start: 0, end: 2 } }), // -> 3,4,5,6,7,8
      { kind: "cut", range: { start: 1, end: 3 } } // removes 4,5 -> 3,6,7,8
    );
    expect(arr(materialize(original, log))).toEqual([3, 6, 7, 8]);
  });

  it("mutates neither the original buffer nor the log passed in", () => {
    const before = arr(original);
    const log = emptyLog();
    const op: EditOp = { kind: "cut", range: { start: 0, end: 4 } };
    const pushed = pushOp(log, op);
    materialize(original, pushed);
    undo(pushed);

    expect(arr(original)).toEqual(before); // original untouched
    expect(log.ops.length).toBe(0); // the empty log we started from is intact
    expect(log.cursor).toBe(0);
    expect(pushed).not.toBe(log);
  });
});

/**
 * #512 George R1 P2-2: `useSegmentEditor.undo`/`.redo` return the op they
 * stepped over so `recorder.tsx` can map the centerline through it (#449),
 * but that "which op did this step pass over" choice lived only inline in
 * the hook, untested (`tests/audio-edit-log.test.ts` covered cursor motion,
 * not this return; `tests/recorder-stage.test.ts` feeds hand-built `EditOp`s
 * into the mappers directly). Pulled out to a pure function here, next to
 * the log it reads, so the seam is testable without React.
 */
describe("opUndone / opRedone — the op a step is about to pass over (#512 George R1 P2-2)", () => {
  it("cut [2,5) applied: opUndone returns that cut", () => {
    const log = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    const op = opUndone(log);
    expect(op).toEqual({ kind: "cut", range: { start: 2, end: 5 } });
  });

  it("undo at the start of history returns null and does not map", () => {
    expect(opUndone(emptyLog())).toBeNull();
  });

  it("redo at the end of history (nothing undone) returns null", () => {
    const log = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 0, end: 3 },
    });
    expect(opRedone(log)).toBeNull();
  });

  it("after an undo, opRedone returns the SAME op opUndone just returned", () => {
    // The redo tail's next op is the one undo just stepped over — the exact
    // pairing `recorder.tsx`'s onUndo/onRedo lean on to map pan through the
    // inverse then the forward effect of the same op.
    const applied = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 2, end: 5 },
    });
    const undoneOp = opUndone(applied);
    const back = undo(applied);
    expect(opRedone(back)).toEqual(undoneOp);
  });

  it("a paste op round-trips through opUndone the same way", () => {
    const clip = buf(90, 91);
    const log = pushOp(emptyLog(), { kind: "paste", at: 3, clip });
    expect(opUndone(log)).toEqual({ kind: "paste", at: 3, clip });
  });

  it("names the LAST applied op, not the next redo-tail one, when both exist", () => {
    // Two ops applied (cursor 2): opUndone must name the SECOND (cursor - 1),
    // not the first (cursor - 2) or the (nonexistent) third.
    // RED-FIRST / mutation kill: swapping `log.cursor - 1` for `log.cursor`
    // in `opUndone` would instead read the (out-of-bounds, undefined) op at
    // the redo-tail position, failing this exact-equality check.
    const first = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 0, end: 2 },
    });
    const second = pushOp(first, { kind: "paste", at: 0, clip: buf(9) });
    expect(opUndone(second)).toEqual({ kind: "paste", at: 0, clip: buf(9) });
  });

  it("names the NEXT undone op, not the last applied one, when both exist", () => {
    // Mirror of the case above for opRedone: after undoing back to cursor 1
    // (one op applied, one on the redo tail), opRedone must read cursor
    // (the redo tail's op), not cursor - 1 (the still-applied one).
    const first = pushOp(emptyLog(), {
      kind: "cut",
      range: { start: 0, end: 2 },
    });
    const second = pushOp(first, { kind: "paste", at: 0, clip: buf(9) });
    const back = undo(second);
    expect(opRedone(back)).toEqual({ kind: "paste", at: 0, clip: buf(9) });
  });
});
