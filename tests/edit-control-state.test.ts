import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  editControlHint,
  redoReason,
  undoReason,
  type EditControlReason,
} from "@/components/edit-control-state";
import { heldByDrag } from "@/components/recorder-stage";
import { strings } from "@/components/strings";

/**
 * #91 — a disabled edit-toolbar history control must carry its reason.
 *
 * The rule is #135's, and it is the reason this module exists at all rather
 * than a `hint={...}` ternary beside each control: the cue has to be derived
 * from the SAME predicate that disables the control, or the two drift and the
 * control lies. So the first group below does not assert a hand-written truth
 * table — it asserts `reason !== null` against `heldByDrag` itself, over every
 * cell of the input space. A gate rewritten in one place and not the other
 * fails there, which a table of expected reasons would not catch.
 *
 * Nothing here renders. `Control`'s badge markup and its `aria-disabled`
 * routing are pinned by `tests/control-render.test.ts` through the #197
 * harness, and that file consumes a hint rather than restating one. What a
 * translator makes of the badge is still on-device surface, and #91 is
 * explicit that only real non-reader testing answers it.
 */

const CELLS = [false, true];

describe("the history gates are the shipped gates (#317, #91)", () => {
  it("undoReason is non-null exactly where heldByDrag disabled it", () => {
    for (const dragging of CELLS) {
      for (const idleEditable of CELLS) {
        for (const canUndo of CELLS) {
          const shipped = heldByDrag(dragging, !idleEditable || !canUndo);
          expect(
            undoReason({ dragging, idleEditable, canUndo }) !== null,
            `dragging=${dragging} idleEditable=${idleEditable} canUndo=${canUndo}`
          ).toBe(shipped);
        }
      }
    }
  });

  it("redoReason is non-null exactly where heldByDrag disabled it", () => {
    for (const dragging of CELLS) {
      for (const idleEditable of CELLS) {
        for (const canRedo of CELLS) {
          const shipped = heldByDrag(dragging, !idleEditable || !canRedo);
          expect(
            redoReason({ dragging, idleEditable, canRedo }) !== null,
            `dragging=${dragging} idleEditable=${idleEditable} canRedo=${canRedo}`
          ).toBe(shipped);
        }
      }
    }
  });

  // The loops above pin the BOUNDARY; they are satisfied by any ordering of the
  // three terms, because a disjunction does not care which disjunct answered.
  // Which reason wins decides what the translator is told, so it is pinned
  // separately — and it is not arbitrary: a finger on the stage blocks the
  // control whatever the history holds, so saying "no edits to undo yet" to
  // someone mid-pan with a full history would be false.
  it("a finger on the stage outranks a full history", () => {
    expect(
      undoReason({ dragging: true, idleEditable: true, canUndo: true })
    ).toBe("held-by-drag");
    expect(
      redoReason({ dragging: true, idleEditable: true, canRedo: true })
    ).toBe("held-by-drag");
  });

  it("a committing sheet outranks an empty history", () => {
    expect(
      undoReason({ dragging: false, idleEditable: false, canUndo: false })
    ).toBe("sheet-busy");
    expect(
      redoReason({ dragging: false, idleEditable: false, canRedo: false })
    ).toBe("sheet-busy");
  });

  it("is null only when the control is genuinely live", () => {
    expect(
      undoReason({ dragging: false, idleEditable: true, canUndo: true })
    ).toBeNull();
    expect(
      redoReason({ dragging: false, idleEditable: true, canRedo: true })
    ).toBeNull();
  });

  // The state every edit session opens in, and the whole reason #91 reaches
  // these two controls: nothing has been edited, so both arrows are grey before
  // the translator has done anything at all.
  it("an untouched edit session names its own emptiness on both arrows", () => {
    expect(
      undoReason({ dragging: false, idleEditable: true, canUndo: false })
    ).toBe("no-edits");
    expect(
      redoReason({ dragging: false, idleEditable: true, canRedo: false })
    ).toBe("nothing-undone");
  });
});

describe("the cue (#91, #135)", () => {
  it("speaks the two history reasons with the alert state mark", () => {
    expect(editControlHint("no-edits")).toEqual({
      icon: "alert",
      label: strings.nothingToUndo,
    });
    expect(editControlHint("nothing-undone")).toEqual({
      icon: "alert",
      label: strings.nothingUndone,
    });
  });

  // Undo and Redo must not say the same thing. They are two adjacent, mirrored
  // arrows a non-reader tells apart by nothing except direction, so a shared
  // cue would leave the pair exactly as ambiguous as no cue at all.
  it("gives the two arrows different words", () => {
    expect(strings.nothingToUndo).not.toBe(strings.nothingUndone);
  });

  it("stays silent on the two transient reasons, and on a live control", () => {
    // `held-by-drag` clears on the translator's own lift and would flicker on
    // every pan; `sheet-busy` is `isClosing`, a sheet already going away.
    expect(editControlHint("held-by-drag")).toBeNull();
    expect(editControlHint("sheet-busy")).toBeNull();
    expect(editControlHint(null)).toBeNull();
  });

  // The glyph must be a STATE mark, never a control glyph — round 1 of #135
  // shipped `back`, which named a control the overlay had made untappable.
  // Asserted over the whole reason union rather than the two cases above, so a
  // reason added later cannot quietly arrive wearing a control's glyph.
  it("no reason ever wears a control glyph", () => {
    const reasons: readonly (EditControlReason | null)[] = [
      "held-by-drag",
      "sheet-busy",
      "no-edits",
      "nothing-undone",
      null,
    ];
    for (const reason of reasons) {
      const icon = editControlHint(reason)?.icon;
      if (icon !== undefined) expect(icon).toBe("alert");
    }
  });

  // The other half of that rule, in the words rather than the glyph: these two
  // cues deliberately name no control, because each way out follows from the
  // state itself. `blockedByTake` is the counter-example that has to name two
  // (`menu-row-state.ts`), and naming one here would inherit its whole trap —
  // an icon-only control's accessible name is not a word anyone can see (#620),
  // so a cue that cites one owes a description of its glyph too.
  //
  // Checked as `blockedByTake` actually cites them — quoted, e.g. `Use "Close
  // menu", then "Close recorder"` — plus the imperatives that introduce one.
  // Deliberately NOT by scanning for the words "undo" and "redo": those are the
  // verbs these sentences are about as well as the controls' names, so a check
  // on the bare words would fail on honest copy and teach the next author to
  // weaken it until it caught nothing.
  it("neither cue points the translator at a control", () => {
    for (const copy of [strings.nothingToUndo, strings.nothingUndone]) {
      expect(copy).not.toContain(`"`);
      expect(copy.toLowerCase()).not.toMatch(/\b(tap|press|use) /);
    }
  });
});

/**
 * The wiring, read as source.
 *
 * The property this whole module exists for is that ONE value answers both
 * questions — whether the control is inert, and what it says about being inert.
 * Nothing at runtime can tell `disabled={undoBlocked !== null}` from an inline
 * `heldByDrag(...)` that happens to agree today, because agreeing today is
 * precisely what a drifting pair does. So the seam is read rather than
 * exercised, the way `tests/notice-nothing-failed.test.ts` reads its own.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not incidental: the two control
 * sites now NAME `undoReason` and `heldByDrag` in prose in order to explain
 * why the gate is unchanged, so a reader matching the bare identifier would
 * pass on the comment alone. This repo has already had a stylesheet comment
 * capture a test that searched its file whole (`share-progress.test.ts`, #529
 * round 3), and it surfaced only because that test carried a floor — so this
 * one carries a floor too.
 */
function recorderCode(): string {
  const raw = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  );
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  expect(stripped.length, "recorder.tsx stripped to nothing").toBeGreaterThan(
    10000
  );
  return stripped;
}

describe("the toolbar reads one value for both halves (#91)", () => {
  it("each history control's `disabled` IS its reason being non-null", () => {
    const source = recorderCode();
    for (const slot of ["undoBlocked", "redoBlocked"]) {
      expect(source).toContain(`disabled={${slot} !== null}`);
      expect(source).toContain(`hint={editControlHint(${slot})}`);
    }
  });

  it("neither control re-derives the gate beside the cue", () => {
    // The drift this file is named for: an inline `heldByDrag` restored at one
    // of the two sites while its `hint` still reads the derivation, so the
    // control goes grey for a reason the badge does not know about. `heldByDrag`
    // legitimately survives at Play and `playDisabled`, so this is scoped to the
    // history terms rather than banning the helper.
    const source = recorderCode();
    expect(source).not.toMatch(/heldByDrag\([^)]*canUndo/s);
    expect(source).not.toMatch(/heldByDrag\([^)]*canRedo/s);
  });
});
