import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  liftOutcome,
  panAfterCutCollapse,
  panAfterRedo,
  redoCollapsesFrame,
  selectionReseed,
} from "@/components/recorder-stage";
import type { EditOp } from "@/lib/audio/edit-log";

import { stripComments } from "./support";

/**
 * #613: after a cut, the selection band collapses to the red centerline at the
 * cut point — the sample a paste will be inserted at — and the scissors leaves.
 *
 * The state the requirements owner saw on v0.2.9 was not `cut()` failing to
 * clear the frame: `useSegmentEditor.cut` has always ended in
 * `clearSelection()`. It was `recorder.tsx`'s render-time reseed, which opens a
 * fresh span around the insertion pan on ANY edit-mode render with no frame
 * open — so the band the cut had just dropped was re-drawn in the same commit,
 * with the scissors live over it and the centerline hidden underneath
 * (`centerlineOverlayShown` is false while a frame is open). That reseed is
 * what `selectionReseed`'s `collapsedByCut` term suspends.
 *
 * Both halves are pure or source-shape on purpose: `recorder.tsx` cannot be
 * rendered here (AGENTS.md — the #197 harness is one component, no effects),
 * so the truth table is a function and the wiring is read as text, the same
 * split `tests/recorder-centerline-overlay-gate.test.ts` uses.
 */

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const recorder = stripComments(read("src/components/recorder.tsx"));

describe("panAfterCutCollapse — the line lands on the cut point (#613)", () => {
  it("puts the line at the cut's start, wherever the pan was before it", () => {
    // The pan that #473's `panAfterCutRest` preserved: entirely before the
    // removed span, so the old rule left it at 2_000. The paste target is the
    // cut point, so the line moves there instead.
    expect(panAfterCutCollapse({ start: 5_000, end: 6_000 }, 10_000)).toBe(
      5_000
    );
  });

  it("rests — null, not the number newLength — when the cut ran to the end (#442/#473)", () => {
    // #473's own repro, and the invariant that survives the rule change: a cut
    // to the end leaves the cut point AT the new length, where an absolute
    // index goes stale the moment anything is pasted or appended and the next
    // Record punches into the new audio instead of following it.
    expect(
      panAfterCutCollapse({ start: 8_000, end: 10_000 }, 10_000)
    ).toBeNull();
  });

  it("truncates a fractional boundary the way `sliceRange` does, on BOTH terms", () => {
    // Selection edges are floats; `cut`/`sliceRange` truncate via
    // `Int16Array.slice`. The cut point is the truncated start, and the
    // post-cut length is derived from the truncated span — a raw
    // `10_000 - 8_000.4` would leave the rest clamp a fraction off.
    expect(
      panAfterCutCollapse({ start: 8_000.4, end: 10_000 }, 10_000)
    ).toBeNull();
    expect(panAfterCutCollapse({ start: 2_000.7, end: 4_000.2 }, 10_000)).toBe(
      2_000
    );
  });

  it("clamps a range that reaches outside the buffer (George R1 Low-1)", () => {
    // The title this replaces claimed a clamp its inputs never exercised —
    // both were in range, so a missing clamp would not have failed it. These
    // are the out-of-range cases: `wholeSampleRange` orders and truncates,
    // then `panOrRest` clamps into [0, length].
    // A negative start clamps to the head.
    expect(panAfterCutCollapse({ start: -500, end: 2_000 }, 10_000)).toBe(0);
    // A cut whose end runs past the buffer: the removed length is measured
    // from the truncated range, so the post-cut length can go negative and
    // the answer must still be the rest rather than a negative sample.
    expect(
      panAfterCutCollapse({ start: 9_000, end: 12_000 }, 10_000)
    ).toBeNull();
    // Reversed edges are ordered before either question is asked.
    expect(panAfterCutCollapse({ start: 6_000, end: 2_000 }, 10_000)).toBe(
      2_000
    );
  });

  it("cutting the whole buffer rests, and a one-sample cut at the head stays at 0", () => {
    expect(panAfterCutCollapse({ start: 0, end: 10_000 }, 10_000)).toBeNull();
    expect(panAfterCutCollapse({ start: 0, end: 1 }, 10_000)).toBe(0);
  });
});

/**
 * #722: a REDONE cut reproduces the cut's view as well as its buffer (DRI
 * decision on #722). Undo is unchanged, and so is a redone paste. Both inputs
 * are built inside each case, so this pins the pure rule's contract; the
 * wiring is the `onRedo` source-shape case below and the Redo step in
 * `e2e/recorder-selection.spec.ts`.
 */
describe("a redone cut collapses to the line, like a live cut (#722)", () => {
  const interiorCut: EditOp = {
    kind: "cut",
    range: { start: 5_000, end: 6_000 },
  };
  const preRedoLength = 10_000;

  it.each([
    ["before the cut", 2_000],
    ["inside the cut", 5_500],
    ["after the cut", 9_000],
    ["resting at the end", null],
  ] as const)(
    "maps a pan %s onto the cut point, the same answer the live cut writes",
    (_label, pan) => {
      expect(panAfterRedo(pan, interiorCut, preRedoLength)).toBe(5_000);
      expect(panAfterRedo(pan, interiorCut, preRedoLength)).toBe(
        panAfterCutCollapse(interiorCut.range, preRedoLength)
      );
    }
  );

  it("rests when the redone cut ran to the end, through the same #442/#473 rule", () => {
    const toEnd: EditOp = { kind: "cut", range: { start: 8_000, end: 10_000 } };
    expect(panAfterRedo(2_000, toEnd, preRedoLength)).toBeNull();
  });

  it("latches the collapse for a redone cut", () => {
    expect(redoCollapsesFrame(interiorCut)).toBe(true);
  });

  it("does not latch it for a redone paste, or when nothing was redone", () => {
    const paste: EditOp = {
      kind: "paste",
      at: 2_000,
      clip: new Int16Array(3_000),
    };
    expect(redoCollapsesFrame(paste)).toBe(false);
    expect(redoCollapsesFrame(null)).toBe(false);
  });

  it("leaves a redone paste's pan mapping as it was: shifted past the insert, the rest kept", () => {
    const paste: EditOp = {
      kind: "paste",
      at: 2_000,
      clip: new Int16Array(3_000),
    };
    expect(panAfterRedo(1_000, paste, 6_000)).toBe(1_000);
    expect(panAfterRedo(4_000, paste, 6_000)).toBe(7_000);
    expect(panAfterRedo(null, paste, 6_000)).toBeNull();
  });
});

describe("selectionReseed — when the render-time frame is re-opened (#613)", () => {
  const base = {
    mode: "edit" as const,
    selectionActive: false,
    entrySettled: true,
    length: 10_000,
    collapsedByCut: false,
  };

  it("seeds a fresh span on an ordinary edit-mode render with no frame open", () => {
    expect(selectionReseed(base)).toBe("seed");
  });

  it("does NOT seed while a cut has collapsed the frame to the playhead", () => {
    // The #613 kill: with this term dropped the answer is "seed" and the band
    // comes straight back over the line the cut just left behind.
    expect(selectionReseed({ ...base, collapsedByCut: true })).toBe("clear");
  });

  it("recorder.tsx runs the entry-latch and zoom resets OUTSIDE the seed arm (George R1 Q1)", () => {
    // The assertion this replaces read `!== "none"` on a value the test above
    // already pins to "clear", so it could not fail on its own — and it never
    // read `recorder.tsx`, where the claim actually lives. The claim: a cut
    // made while zoomed must still drop `zoomPan`, or the paste marker stays
    // hidden (it is gated on `zoomPan === null`) on the very state this
    // change exists to make paste-ready. That requires the resets to sit in
    // the `reseed !== "none"` block and NOT inside `if (reseed === "seed")`.
    const at = recorder.indexOf("const reseed = selectionReseed({");
    expect(at).toBeGreaterThan(-1);
    const block = recorder.slice(at, at + 1_400);
    expect(block).toMatch(/if \(reseed === "seed"\)/);
    // Read by INDENTATION, which Prettier fixes, rather than by hunting the
    // seed arm's closing brace: a first attempt searched for `"      }"` and
    // matched the eight-space `});` of `openSelection` instead, so the
    // comparison held in both states — the same vacuous shape this test is
    // replacing. Inside the arm these two lines would be indented eight.
    expect(block).toMatch(
      /\n {6}if \(selectionEntry\) setSelectionEntry\(null\);/
    );
    expect(block).toMatch(/\n {6}if \(zoomPan !== null\) setZoomPan\(null\);/);
    expect(
      block,
      "the resets are inside the seed arm, so a cut made while zoomed hides Paste"
    ).not.toMatch(/\n {8}if \(zoomPan !== null\) setZoomPan\(null\);/);
    // The bench's round-1 rewrite of this same test states the claim
    // structurally rather than by indentation — the arm must CLOSE before the
    // two resets. Both are kept: this one says what the shape is, the
    // indentation assertion above is the one proven to die when the resets
    // move into the arm.
    expect(recorder).toMatch(
      /if \(reseed !== "none"\) \{\s*if \(reseed === "seed"\) \{[\s\S]*?editor\.openSelection\([\s\S]*?\);\s*\}\s*if \(selectionEntry\) setSelectionEntry\(null\);\s*if \(zoomPan !== null\) setZoomPan\(null\);\s*\}/
    );
  });

  it("is inert in record mode, with a frame already open, or before the committed buffer arrives", () => {
    expect(selectionReseed({ ...base, mode: "record" })).toBe("none");
    expect(selectionReseed({ ...base, selectionActive: true })).toBe("none");
    expect(selectionReseed({ ...base, entrySettled: false })).toBe("none");
  });

  it("clears rather than seeds on an empty buffer — there is no span to pick", () => {
    expect(selectionReseed({ ...base, length: 0 })).toBe("clear");
  });
});

describe("recorder.tsx wires the collapse (#613)", () => {
  const onCutBody = (() => {
    const at = recorder.indexOf("const onCut = useCallback(");
    expect(at, "no onCut in recorder.tsx").toBeGreaterThan(-1);
    const end = recorder.indexOf("const onPaste = useCallback(", at);
    expect(end).toBeGreaterThan(at);
    return recorder.slice(at, end);
  })();

  it("onCut moves the pan to the cut point and latches the collapse", () => {
    expect(onCutBody).toMatch(/panAfterCutCollapse\(/);
    expect(onCutBody).toMatch(/setCutCollapsed\(true\)/);
  });

  it("onCut no longer keeps the line on the old audio (the rule #613 replaced)", () => {
    expect(recorder).not.toMatch(/panAfterCutRest/);
  });

  it("the Cut control is mounted only while a frame is open, the way the paste marker is", () => {
    // "Drop the scissors": with no frame there is nothing to cut, so the
    // control leaves rather than sitting dimmed over a collapsed line. The
    // row around it stays mounted (reserved height, below) so the waveform
    // does not jump.
    const at = recorder.indexOf('<div className="recorder-cut');
    expect(at).toBeGreaterThan(-1);
    const block = recorder.slice(at, recorder.indexOf("</div>", at));
    expect(block).toMatch(/editor\.selectionActive &&/);
    expect(block).toMatch(/label=\{strings\.cut\}/);
  });

  it("a lift that resumes playback leaves the frame collapsed (#671 Frank R1 P2)", () => {
    // After a cut, Play sounds the tail from the line (no span: `scroll`), a
    // touch interrupts it, and the lift resumes `soundRange(from, length)`.
    // Reopening the frame on that same lift seeded a ±15% span, and
    // `stageView` then drew an in-place audition of that span while the
    // TAIL was what sounded. Only a lift that does not resume may reopen.
    const at = recorder.indexOf("const onPointerUp = useCallback(");
    expect(at, "no onPointerUp in recorder.tsx").toBeGreaterThan(-1);
    const end = recorder.indexOf("[length, soundRange", at);
    expect(end).toBeGreaterThan(at);
    const body = recorder.slice(at, end);
    //
    // The bench's round-1 fix put this gate in the handler as
    // `wasOwner && !outcome.resume`. The rule kept instead is the fourth
    // answer from `liftOutcome` (`!held && !resume`), which also covers the
    // case a `wasOwner` gate gets wrong: the owner lifting first and a second
    // contact lifting last left the frame collapsed for good. Both halves of
    // the gate are asserted against the outcome, not against the pointer.
    expect(body).toMatch(/if \(outcome\.resume\) soundRange\(from, length\)/);
    expect(body).toMatch(/if \(outcome\.reopenFrame\) reopenFrame\(\)/);
    expect(body).not.toMatch(
      /if \(wasOwner(?: && !outcome\.resume)?\) reopenFrame\(\)/
    );
  });

  it("onRedo sets the latch from the redone op, not unconditionally open (#722)", () => {
    // Source shape only: the rule itself is `redoCollapsesFrame`, pinned
    // below. This reads that `onRedo` hands the latch that answer rather than
    // calling `reopenFrame()`, which was the pre-#722 wiring.
    const at = recorder.indexOf("const onRedo = useCallback(");
    expect(at, "no onRedo in recorder.tsx").toBeGreaterThan(-1);
    const body = recorder.slice(at, recorder.indexOf("}, [", at));
    expect(body).toMatch(/setCutCollapsed\(redoCollapsesFrame\(redoneOp\)\)/);
    expect(body).not.toMatch(/reopenFrame\(\)/);
  });

  it("everything that should bring the frame back clears the latch", () => {
    // Redo left this list with #722: it clears the latch for a redone paste
    // and sets it for a redone cut (the case above).
    for (const handler of [
      "const onPaste = useCallback(",
      "const onUndo = useCallback(",
      "const onExitEdit = useCallback(",
    ]) {
      const at = recorder.indexOf(handler);
      expect(at, `${handler} not found`).toBeGreaterThan(-1);
      const body = recorder.slice(at, at + 1_200);
      expect(body, `${handler} does not reopen the frame`).toMatch(
        /setCutCollapsed\(false\)|reopenFrame\(\)/
      );
    }
  });
});

describe("the Cut row reserves its height (#613)", () => {
  it(".recorder-cut holds the scissors' box whether or not the button is mounted", () => {
    // The paste row's lesson (#414 R3 P3): `.recorder-stage` is a centered
    // column, so a row that collapses when its child unmounts recenters the
    // group and the canvas jumps. `.recorder-paste` reserves its height for
    // exactly this reason; the Cut row now has a conditional child too.
    const css = read("src/app/styles/3-components.css");
    const start = css.indexOf("  .recorder-cut {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    const declarations = [...block.matchAll(/([a-z-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThanOrEqual(3);
    const minHeight = declarations.find(([, prop]) => prop === "min-height");
    expect(minHeight, ".recorder-cut reserves no height").toBeDefined();
    // Through the token, not a repeated `40px` — `--c-control-sm` is what
    // `.control--quiet` (the scissors) is sized by, and #362 is an open
    // question about changing it.
    expect(minHeight?.[2]).toMatch(/var\(--c-control-sm\)/);
    // ...and the row's own padding, which border-box counts INSIDE
    // `min-height`. Reserving the bare control box passed this assertion
    // while the canvas still moved 3px (jag3773 P3 on #671), which is why
    // the real gate is the canvas-bounds comparison in
    // `e2e/recorder-selection.spec.ts` and this only pins the declaration.
    expect(minHeight?.[2]).toMatch(/var\(--p-space-2\)/);
  });
});

describe("a lift that resumes playback does not seed a frame (#613, Frank R1 P2)", () => {
  const lift = {
    wasOwner: true,
    ownerActive: false,
    contactsRemaining: 0,
    interrupted: false,
    pan: 5_000,
    length: 10_000,
    takeActive: false,
    canPaste: false,
  };

  it("reopens the frame on an ordinary lift — the #613 gesture", () => {
    expect(liftOutcome(lift)).toMatchObject({
      resume: false,
      reopenFrame: true,
    });
  });

  it("does NOT reopen it when the same lift resumes an interrupted playback", () => {
    // The kill: `onPointerUp` resumes `soundRange(from, length)` — the TAIL —
    // and, with the frame seeded in the same commit, `stageView` reads
    // `playingBuffer && selectionActive` as an in-place audition and draws a
    // band over a span that is not what is sounding. The collapsed line is the
    // honest display while the tail plays. A touch during the play interrupts
    // it and that lift resumes, so the frame returns on the first lift that
    // does NOT resume, not on "the next touch".
    const resumed = liftOutcome({ ...lift, interrupted: true });
    expect(resumed.resume).toBe(true);
    expect(resumed.reopenFrame).toBe(false);
  });

  it("does not reopen it while a finger is still on the stage", () => {
    // The gesture has not ended, so a band would be drawn under the finger.
    expect(liftOutcome({ ...lift, contactsRemaining: 1 }).reopenFrame).toBe(
      false
    );
    expect(
      liftOutcome({ ...lift, wasOwner: false, ownerActive: true }).reopenFrame
    ).toBe(false);
  });

  it("reopens it on the LAST contact's lift even when that pointer never owned the drag", () => {
    // `dragging` and `resume` are about fingers, not about which pointer owned
    // the gesture (`liftOutcome`'s own docblock). Gating the reseed on
    // `wasOwner` — what the first draft of this PR did — left the frame
    // collapsed forever when the owner lifted first and a second finger last.
    expect(
      liftOutcome({ ...lift, wasOwner: false, ownerActive: false }).reopenFrame
    ).toBe(true);
  });

  it("does not reopen on a resuming lift even when that contact never owned the drag", () => {
    // The row `wasOwner: false, interrupted: true` is the one combination the
    // three rows above never assert together (#747): the last contact lifts,
    // it never owned the drag, and that lift also resumes playback. `resume`
    // does not take `wasOwner`, and `reopenFrame` is a conjunction of `!held`
    // and `!resume` — both already covered individually — so this falls out
    // by inspection rather than pinning a second defect. Pin it anyway.
    const resumed = liftOutcome({
      ...lift,
      wasOwner: false,
      interrupted: true,
    });
    expect(resumed.resume).toBe(true);
    expect(resumed.reopenFrame).toBe(false);
  });

  it("recorder.tsx reads the rule from the outcome, not from `wasOwner`", () => {
    const at = recorder.indexOf("const onPointerUp = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const body = recorder.slice(at, recorder.indexOf("}, [", at));
    expect(body).toMatch(/if \(outcome\.reopenFrame\) reopenFrame\(\)/);
    expect(body).not.toMatch(/if \(wasOwner\) reopenFrame\(\)/);
  });

  it("does not reopen it on an otherwise-reopening lift while the clipboard holds a cut (#835)", () => {
    // The reported bug: after a cut, dragging the waveform to find a paste
    // point restored the selection window on lift. `lift` here is the same
    // ordinary #613 gesture the first test in this block reopens on — the
    // only change is `canPaste: true`, the clipboard still holding the cut.
    expect(liftOutcome({ ...lift, canPaste: true }).reopenFrame).toBe(false);
  });

  it("recorder.tsx passes the clipboard's fullness into liftOutcome (#835)", () => {
    // Source-shape only, alongside the pure rule pinned above: this is what
    // keeps `onPointerUp`'s call wired to the live clipboard rather than a
    // stale or hardcoded value.
    const at = recorder.indexOf("const outcome = liftOutcome({");
    expect(at).toBeGreaterThan(-1);
    const body = recorder.slice(at, recorder.indexOf("});", at));
    expect(body).toMatch(/canPaste:\s*editor\.canPaste/);
  });
});
