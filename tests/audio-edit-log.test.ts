import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  emptyLog,
  materialize,
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
