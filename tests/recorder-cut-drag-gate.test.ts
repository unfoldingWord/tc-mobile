import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * Cut must be gated against a live drag the same way Undo/Redo are (#512
 * George R1 P2-1).
 *
 * `onPointerMove` keeps writing `panAfterDragMove` into `panState` for as
 * long as `dragging` is true, and Cut does not clear `dragging`,
 * `ownerRef`, or `panAtDragStart` when it fires. Undo and Redo carry a
 * `dragging` term for exactly this reason — rematerialising
 * `working` (or, for Cut, writing `panState` through `panAfterCutCollapse`)
 * under a finger that is still moving is the #317 class. They carried it as a
 * literal `heldByDrag(dragging, …)` wrap until #91 moved them onto
 * `undoReason`/`redoReason`, so that a disabled history control can also say
 * WHY it is disabled; `tests/edit-control-state.test.ts` pins those two as
 * equivalent to the wrap. Cut still calls `heldByDrag` directly, and Cut is
 * what this file is about. Cut's own gate was
 * `!idleEditable || !editor.canCut` with no `dragging` term, so a second
 * finger could tap Cut mid-drag, after which the first finger's next
 * `pointermove` writes a pan measured against the PRE-cut origin over the
 * POST-cut length — the exact clobber George R1 traced through
 * `recorder.tsx:1131-1136` and `1804-1806`.
 *
 * Source-shape, and only for Cut. Cut lives in `recorder.tsx`, not in the
 * presentational bar, and rendering it means mounting the whole sheet with its
 * hook boundary mocked (the `tests/interactive-mount.ts` shape
 * `tests/recorder-edit-toolbar-glyph.test.ts` uses). This file does not do
 * that, so it reads Cut's `disabled` prop as text. Undo lives
 * in the presentational bar, so its half of the comparison is RENDERED in
 * `tests/edit-control-state.test.ts` ("the toolbar reads one value for both
 * halves") rather than read here (#822).
 */
describe("Cut's disabled gate wraps its idle/canCut guard in the #317 drag term (#512 George R1 P2-1)", () => {
  // The read is stripped before anything is searched (#822): unstripped,
  // a comment carrying `label={strings.cut}` and the full gate ahead of the
  // live control is what `indexOf` finds, so the live Cut could lose its
  // drag term with every case here still green.
  const recorder = stripComments(
    readFileSync(
      new URL("../src/components/recorder.tsx", import.meta.url),
      "utf8"
    )
  );
  const cutDisabledExpr = (() => {
    // Isolate the Cut control by its unique `label={strings.cut}` and read
    // the `disabled={...}` expression that follows it — the same isolation
    // idiom `tests/nav-commit-close-race-guards.test.ts` uses for Close.
    const labelIdx = recorder.indexOf("label={strings.cut}");
    expect(
      labelIdx,
      "no Control with label={strings.cut} in recorder.tsx"
    ).toBeGreaterThan(-1);
    const match = /disabled=\{([^}]*)\}/.exec(recorder.slice(labelIdx));
    if (!match) {
      throw new Error(
        "the Cut control's disabled={...} prop was not found after its label"
      );
    }
    return match[1] ?? "";
  })();

  it("wraps its existing gate in heldByDrag", () => {
    // RED-FIRST kill: on PR #512's pre-fix head this expression was
    // `!idleEditable || !editor.canCut` with no `heldByDrag`/`dragging` term
    // at all, so this fails until the gate reads
    // `heldByDrag(dragging, !idleEditable || !editor.canCut)`.
    expect(cutDisabledExpr).toMatch(/heldByDrag\(/);
    expect(cutDisabledExpr).toMatch(/dragging/);
  });

  it("keeps the original idle/canCut guard inside the wrap — this is additive, not a replacement", () => {
    expect(cutDisabledExpr).toMatch(/idleEditable/);
    expect(cutDisabledExpr).toMatch(/editor\.canCut/);
  });

  it("calls the centralised rule rather than reimplementing it inline", () => {
    // Cut's wrap must be `heldByDrag(dragging, <original>)` — not, say, an
    // inline `dragging || (...)` that reimplements the rule heldByDrag exists
    // to centralise (its own docblock: "so the rule is written once rather
    // than three times in JSX").
    expect(cutDisabledExpr.replace(/\s+/g, "")).toMatch(
      /^heldByDrag\(dragging,/
    );
  });
});
