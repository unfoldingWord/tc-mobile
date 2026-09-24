import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  editControlHint,
  redoReason,
  undoReason,
  type EditControlReason,
} from "@/components/edit-control-state";
import { heldByDrag } from "@/components/recorder-stage";
import { strings } from "@/lib/strings";

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
  // control whatever the history holds, so telling someone mid-pan with a full
  // stack that there is nothing to undo would be false.
  it("a finger on the stage outranks a full history", () => {
    expect(
      undoReason({ dragging: true, idleEditable: true, canUndo: true })
    ).toBe("held-by-drag");
    expect(
      redoReason({ dragging: true, idleEditable: true, canRedo: true })
    ).toBe("held-by-drag");
  });

  // …and outranks an EMPTY one, which is the cell that actually discriminates
  // (George, twice). With `canUndo: true` above, a `!canUndo` check moved ahead
  // of `dragging` returns `"held-by-drag"` anyway, so that case passes under
  // either ordering and pins nothing. This is the usual pan: a fresh session,
  // undone to the start, or Redo sitting at the tip.
  //
  // It is also the ordering #317 rests on. A reason that carries a cue makes
  // `Control` render `aria-disabled` INSTEAD of the native `disabled`
  // attribute, so swapping these lines takes the drag lock off the hard
  // route; `tests/control-render.test.ts` pins that cell. Activation stays
  // blocked either way by `Control`'s `onClick` guard, so what is lost is the
  // hard lock and its absence from the tab order, not click-safety.
  it("a finger on the stage outranks an EMPTY history — the #317 ordering", () => {
    expect(
      undoReason({ dragging: true, idleEditable: true, canUndo: false })
    ).toBe("held-by-drag");
    expect(
      redoReason({ dragging: true, idleEditable: true, canRedo: false })
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

  // The reason names a POSITION IN THE STACK, not a fact about the session.
  // Round 1 called these `no-edits`/`nothing-undone` and this case "an
  // untouched edit session names its own emptiness", which read `!canUndo` as
  // "nothing was ever edited" — the conflation George round 1 caught in the
  // copy. A fresh session is only ONE of the states that selects each reason;
  // the mid-stack ones below are the others.
  it("names the stack end when there is nothing on that side", () => {
    expect(
      undoReason({ dragging: false, idleEditable: true, canUndo: false })
    ).toBe("nothing-to-undo");
    expect(
      redoReason({ dragging: false, idleEditable: true, canRedo: false })
    ).toBe("nothing-to-redo");
  });
});

describe("the cue (#91, #135)", () => {
  it("speaks the two history reasons with the alert state mark", () => {
    expect(editControlHint("nothing-to-undo")).toEqual({
      icon: "alert",
      label: strings.nothingToUndo,
    });
    expect(editControlHint("nothing-to-redo")).toEqual({
      icon: "alert",
      label: strings.nothingToRedo,
    });
  });

  // Undo and Redo must not say the same thing. They are two adjacent, mirrored
  // arrows a non-reader tells apart by nothing except direction, so a shared
  // cue would leave the pair exactly as ambiguous as no cue at all.
  it("gives the two arrows different words", () => {
    expect(strings.nothingToUndo).not.toBe(strings.nothingToRedo);
  });

  // The literal sentences, in vitest (George r6). The tense ban below is a
  // backstop and he is right that it leaks: "No edits to undo." clears every
  // banned word and is still false once an edit has been made and undone to
  // cursor 0. `toEqual({ label: strings.nothingToUndo })` cannot catch that
  // either — it restates the constant. Only the literals do, and until now they
  // lived solely in the Playwright spec, which runs in one CI job rather than
  // everywhere `npm test` does.
  it("says exactly the two sentences that are true at both stack ends", () => {
    expect(strings.nothingToUndo).toBe("Nothing to undo.");
    expect(strings.nothingToRedo).toBe("Nothing to redo.");
  });

  // THE ROUND-1 DEFECT, pinned as a rule rather than as two fixed sentences
  // (George round 1, Medium / WRONG RESULT). The cue shipped as "No edits to
  // undo yet." and "Nothing has been undone." — claims about the session's
  // PAST, while `canUndo`/`canRedo` only read the log's CURSOR: `cursor > 0`
  // and `cursor < ops.length` (`lib/audio/edit-log.ts`). An edit undone back to
  // the start, or an undo redone to the tip, reaches the same cursor as a fresh
  // session, so three taps reach the lie — cut, undo (Undo greys: an edit WAS
  // made), redo (Redo greys: an undo DID happen).
  //
  // ONE test, merging this session's guard with the bench round-1 commit's
  // (`be67932`), which landed on this branch independently while this fix was
  // being written. Both banned the tense; the wider pattern is kept, because
  // the narrower `/\byet\b|\b(has|have) been\b/` goes green on "Nothing was
  // undone so far." — a reworded version of the very claim being banned. Two
  // tests asserting one property, one of them weaker, is the duplication the
  // repo's own bar rules out.
  it("neither cue claims a history the cursor cannot know", () => {
    for (const copy of [strings.nothingToUndo, strings.nothingToRedo]) {
      expect(copy.toLowerCase()).not.toMatch(
        /\b(yet|has been|have been|was|were|already|so far|ever)\b/
      );
    }
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
      "nothing-to-undo",
      "nothing-to-redo",
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
    for (const copy of [strings.nothingToUndo, strings.nothingToRedo]) {
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
