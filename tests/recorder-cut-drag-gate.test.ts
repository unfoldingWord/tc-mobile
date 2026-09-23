import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Cut must be gated against a live drag the same way Undo/Redo are (#512
 * George R1 P2-1).
 *
 * `onPointerMove` keeps writing `panAfterDragMove` into `panState` for as
 * long as `dragging` is true, and Cut does not clear `dragging`,
 * `ownerRef`, or `panAtDragStart` when it fires. Undo and Redo are wrapped in
 * `heldByDrag(dragging, …)` for exactly this reason — rematerialising
 * `working` (or, for Cut, writing `panState` through `panAfterCutCollapse`)
 * under a finger that is still moving is the #317 class. Cut's own gate was
 * `!idleEditable || !editor.canCut` with no `dragging` term, so a second
 * finger could tap Cut mid-drag, after which the first finger's next
 * `pointermove` writes a pan measured against the PRE-cut origin over the
 * POST-cut length — the exact clobber George R1 traced through
 * `recorder.tsx:1131-1136` and `1804-1806`.
 *
 * Source-shape, the same reason `tests/nav-commit-close-race-guards.test.ts`
 * and `tests/panel-recovery-focus.test.ts` are: there is no DOM runner here
 * (AGENTS.md), so the Cut control's `disabled` prop cannot be rendered and
 * inspected — only read as text.
 */
describe("Cut's disabled gate carries the #317 drag term, the way Undo/Redo do (#512 George R1 P2-1)", () => {
  const recorder = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
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

  it("wraps its existing gate in heldByDrag, exactly as Undo/Redo do", () => {
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

  it("matches the Undo control's gate shape exactly (same heldByDrag call convention)", () => {
    // Undo: `heldByDrag(dragging, !idleEditable || !editor.canUndo)`. Cut's
    // wrap must be the same call shape — `heldByDrag(dragging, <original>)`
    // — not, say, an inline `dragging || (...)` that reimplements the rule
    // heldByDrag exists to centralise (its own docblock: "so the rule is
    // written once rather than three times in JSX").
    const undoLabelIdx = recorder.indexOf("label={strings.undo}");
    expect(undoLabelIdx).toBeGreaterThan(-1);
    const undoMatch = /disabled=\{([^}]*)\}/.exec(recorder.slice(undoLabelIdx));
    expect(undoMatch).not.toBeNull();
    const undoDisabledExpr = undoMatch![1] ?? "";
    // Both must open with `heldByDrag(` and pass `dragging` as the first
    // argument, matching the shape `disabled={heldByDrag(\n  dragging,`.
    expect(undoDisabledExpr.replace(/\s+/g, "")).toMatch(
      /^heldByDrag\(dragging,/
    );
    expect(cutDisabledExpr.replace(/\s+/g, "")).toMatch(
      /^heldByDrag\(dragging,/
    );
  });
});
