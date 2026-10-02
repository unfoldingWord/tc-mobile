import { readFileSync } from "node:fs";

import { createElement, type RefObject } from "react";
import { describe, expect, it } from "vitest";

import {
  editControlHint,
  redoReason,
  undoReason,
  type EditControlReason,
} from "@/components/edit-control-state";
import { editRowReason } from "@/components/menu-row-state";
import { heldByDrag } from "@/components/recorder-stage";
import {
  RecorderToolbar,
  type RecorderToolbarProps,
} from "@/components/recorder-toolbars";
import { strings } from "@/lib/strings";

import { render } from "./render";
import { bodyAfter, stripComments } from "./support";

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
 * One group renders: the edit bar, to read which prop each history button's
 * gate and name come from (#822). `Control`'s own `aria-disabled` routing for
 * a hint with no glyph — the shape these two cues take since #924 — is pinned
 * by `tests/control-render.test.ts` through the #197 harness. What a translator makes of a
 * grey arrow that says nothing visibly is still on-device surface, and #91 is
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

describe("the cue (#91, #135, #924)", () => {
  // The words, and ONLY the words (#924). `toStrictEqual`, not `toEqual`: the
  // looser matcher treats `{ icon: undefined, label }` as equal to `{ label }`,
  // and an `icon` key that is present-but-undefined is the shape a half-done
  // revert of #924 would leave behind. The requirements owner read the badge on
  // a grey arrow as an error, so this pins its absence as hard as the earlier
  // round pinned its presence.
  it("speaks the two history reasons, with no visible badge", () => {
    expect(editControlHint("nothing-to-undo")).toStrictEqual({
      label: strings.nothingToUndo,
    });
    expect(editControlHint("nothing-to-redo")).toStrictEqual({
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

  // No reason wears a glyph at all (#924). #703 shipped the two history cues
  // wearing a ⚠ state mark, and the
  // requirements owner read it on a grey arrow as an error — the same reading
  // #610 recorded for the toolbar Edit control, which #624 answered the same
  // way: words in the accessible name, nothing painted. A grey Undo or Redo is
  // ordinary idle state, not a condition to look at. Asserted over the whole
  // reason union rather than the two cued cases, so a reason added later
  // cannot quietly arrive wearing a badge — the earlier form of this test
  // allowed `alert` through, and that allowance is what #924 removes.
  it("no reason ever wears a badge", () => {
    const reasons: readonly (EditControlReason | null)[] = [
      "held-by-drag",
      "sheet-busy",
      "nothing-to-undo",
      "nothing-to-redo",
      null,
    ];
    for (const reason of reasons) {
      const hint = editControlHint(reason);
      if (hint !== null) expect(hint, `${reason}`).not.toHaveProperty("icon");
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
 * The wiring, rendered (#822).
 *
 * The property this whole module exists for is that ONE value answers both
 * questions — whether the control is inert, and what it says about being inert.
 * `RecorderToolbar` is presentational (`recorder-toolbars.tsx`'s docblock), so
 * this renders the edit bar through `tests/render.ts` and reads the two history
 * buttons it emits, rather than reading the JSX as text. A comment in the
 * source cannot satisfy a rendered node, which is the hole #822 records in the
 * text pins that stood here.
 *
 * The bar receives the reason and the raw gate terms (`dragging`,
 * `idleEditable`) as separate props, so a render CAN tell
 * `disabled={undoBlocked !== null}` from an inline `heldByDrag(...)` that
 * agrees with it in the sheet: feed a null reason beside a live drag and a
 * closing sheet, and only the derived gate leaves the arrow live. That input
 * pair never reaches the bar from `recorder.tsx`; it is a probe, not a state.
 */
const noop = () => {};
const buttonRef = { current: null } as RefObject<HTMLButtonElement | null>;

function editBarProps(
  over: Partial<RecorderToolbarProps> = {}
): RecorderToolbarProps {
  return {
    mode: "edit",
    recording: false,
    recordRef: buttonRef,
    rerecordRef: buttonRef,
    rerecordDisabled: false,
    rerecordHint: null,
    recordInert: false,
    guidedRecord: false,
    isClosing: false,
    playingBuffer: false,
    dragging: false,
    idleEditable: true,
    playSource: null,
    playDisabled: false,
    editToolbarDisabled: false,
    editToolbarHint: null,
    undoBlocked: null,
    redoBlocked: null,
    zoom: 1,
    windowControlsInert: false,
    onRecordButton: noop,
    onPlayButton: noop,
    onEnterEdit: noop,
    onAuditionButton: noop,
    onToggleZoom: noop,
    onUndo: noop,
    onRedo: noop,
    onExitEdit: noop,
    onRerecord: noop,
    ...over,
  };
}

/**
 * The one button whose accessible name is `label`, bare or carrying a hint
 * (`Control` names a hinted one `${label}. ${hint}`). Throws on none or two,
 * so a renamed or duplicated control fails by name rather than by a null read.
 */
function historyButton(props: RecorderToolbarProps, label: string): Element {
  const container = render(createElement(RecorderToolbar, props));
  const found = [...container.querySelectorAll("button")].filter((b) => {
    const name = b.getAttribute("aria-label") ?? "";
    return name === label || name.startsWith(`${label}. `);
  });
  if (found.length !== 1) {
    throw new Error(
      `${found.length} buttons named ${label} in the edit bar, expected exactly one`
    );
  }
  return found[0]!;
}

/** Live: neither the native attribute nor the soft one. */
function expectLive(button: Element, what: string): void {
  expect(button.hasAttribute("disabled"), `${what}: native disabled`).toBe(
    false
  );
  expect(button.hasAttribute("aria-disabled"), `${what}: aria-disabled`).toBe(
    false
  );
}

const HISTORY = [
  {
    slot: "undoBlocked",
    label: strings.undo,
    reason: "nothing-to-undo",
    words: strings.nothingToUndo,
    other: { slot: "redoBlocked", label: strings.redo },
  },
  {
    slot: "redoBlocked",
    label: strings.redo,
    reason: "nothing-to-redo",
    words: strings.nothingToRedo,
    other: { slot: "undoBlocked", label: strings.undo },
  },
] as const;

describe("the toolbar reads one value for both halves (#91)", () => {
  it("the fixture renders both history controls live", () => {
    // The floor under every case below: with both reasons null, both arrows
    // exist and are live, so a case that finds a control inert is reading the
    // prop it set and not a fixture that greys everything.
    for (const { label } of HISTORY) {
      expectLive(historyButton(editBarProps(), label), label);
    }
  });

  for (const { slot, label, reason, words, other } of HISTORY) {
    it(`${label}: a history reason greys it softly and speaks through its own name`, () => {
      const props = editBarProps({ [slot]: reason });
      const button = historyButton(props, label);
      // `disabled` and `hint` both read THIS slot: a hint read from the other
      // slot would leave the name bare and the control natively disabled.
      expect(button.getAttribute("aria-label")).toBe(`${label}. ${words}`);
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(false);
      // And the other control does not read this slot either.
      expectLive(historyButton(props, other.label), `${other.label} beside it`);
    });

    it(`${label}: a reason with no cue greys it hard, with its bare name`, () => {
      // `held-by-drag` has no words (`editControlHint`), so `Control` falls
      // back to the native attribute — the #317 lock stays a hard disable.
      const button = historyButton(
        editBarProps({ [slot]: "held-by-drag" }),
        label
      );
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(button.hasAttribute("aria-disabled")).toBe(false);
    });

    it(`${label}: the bar does not re-derive the gate beside the reason`, () => {
      // The drift this file is named for: an inline `heldByDrag` restored at
      // one of the two sites while its `hint` still reads the derivation, so
      // the control goes grey for a reason the cue does not know about. A null
      // reason beside a live drag and a busy sheet must leave the arrow live.
      const props = editBarProps({
        [slot]: null,
        [other.slot]: null,
        dragging: true,
        idleEditable: false,
      });
      expectLive(historyButton(props, label), label);
    });
  }
});

/**
 * `recorder.tsx`, comment-stripped, for the two source-shape checks below.
 * Its own docblock at `idleEditable`'s call site is where the `sheet-busy`
 * ground actually lives — the module under test only asserts the claim,
 * `recorder.tsx` is what has to keep making it true.
 */
function recorderCode(): string {
  const raw = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  );
  const stripped = stripComments(raw);
  expect(stripped.length, "recorder.tsx stripped to nothing").toBeGreaterThan(
    50_000
  );
  return stripped;
}

/**
 * #719 item 3 — pinning `editControlHint`'s docblock claim that `"sheet-busy"`
 * is, in edit mode, `isClosing` and essentially nothing else, on two grounds
 * neither of which was pinned by a test: a null `view` shows `LoadErrorPanel`
 * instead of the toolbar, and edit mode is idle-only regardless.
 *
 * Both grounds are ENTRY conditions of `editRowReason` (`menu-row-state.ts`)
 * — the one gate both routes into edit mode share, the record-menu "Edit
 * recording" row and the toolbar Edit toggle (`recorder.tsx`'s docblock,
 * "Both entry points are greyed while a take is live"). Reading the call
 * site (`recorder.tsx`, `const editReason = editRowReason({...})`):
 * `hasView: view !== null` is ground 1 verbatim, and `committing: isClosing
 * || state === "processing"` together with `hasTake: recording` (`recording
 * = state === "recording"`) and `starting` (`state === "requesting"`) block
 * every `RecorderState` (`hooks/use-recorder.ts`) other than `"idle"` — so
 * `editRowReason` returns non-null unless `view !== null`, `state ===
 * "idle"` and `!isClosing` all hold. That is ground 2, `idleEditable`'s own
 * formula minus the label: neither route can land in edit mode with a null
 * view or a non-idle state, so the toolbar `undoReason`/`redoReason` feed is
 * never mounted with either false.
 *
 * The test below has two parts: the first re-derives that equivalence
 * against the REAL, imported `editRowReason`, over the whole
 * `{hasView, state, isClosing}` space; the second pins that `recorder.tsx`'s
 * actual call site maps `state`/`isClosing` the way the first part assumes,
 * so a remap at the call site that the first part's hand-written
 * reproduction would miss still fails here.
 *
 * **What this does NOT pin.** Both grounds argue ENTRY — the state at the
 * moment `onEnterEdit`/the toolbar toggle fires. Neither the issue nor this
 * test establishes that `state` cannot move away from `"idle"`, or `view`
 * become `null` again, WHILE mode stays `"edit"` and the toolbar is already
 * mounted — that holds only by inspection, because edit mode's own JSX
 * renders no Record-triggering control and no segment reload while it is
 * showing. No behaviour changes here; a design call on `sheet-busy` growing
 * its own cue is explicitly left to the DRI (issue #719, item 3).
 */
describe("the sheet-busy ground: edit mode is idle-only, and needs a view (#719)", () => {
  const RECORDER_STATES = [
    "idle",
    "requesting",
    "recording",
    "processing",
  ] as const;

  it("editRowReason opens edit mode only from a view, at idle, not mid-close", () => {
    for (const hasView of [false, true]) {
      for (const state of RECORDER_STATES) {
        for (const isClosing of [false, true]) {
          // recorder.tsx's `editRowReason({...})` call site, reproduced —
          // pinned against the real source by the test below.
          const reason = editRowReason({
            hasView,
            committing: isClosing || state === "processing",
            hasTake: state === "recording",
            starting: state === "requesting",
            denied: false,
            hasAudio: true,
            canPaste: false,
          });
          const shouldOpen = hasView && state === "idle" && !isClosing;
          expect(
            reason === null,
            `hasView=${hasView} state=${state} isClosing=${isClosing}`
          ).toBe(shouldOpen);
        }
      }
    }
  });

  it("recorder.tsx's editRowReason call site maps state the way the test above assumes", () => {
    const source = recorderCode();
    const call = bodyAfter(source, "const editReason = editRowReason({");
    expect(call).toContain("hasView: view !== null,");
    expect(call).toContain('committing: isClosing || state === "processing",');
    expect(call).toContain("hasTake: recording,");
    expect(call).toContain("starting,");
  });
});

/**
 * #719 item 4 (George round 8 on #703, `e497cf2`) — the call site's live
 * `dragging` flag is not pinned by anything.
 *
 * The two suites above already cover the pure function and the JSX, and
 * neither reaches this gap: `tests/edit-control-state.test.ts`'s own loops
 * (above) prove `undoReason`/`redoReason` reproduce `heldByDrag` over the
 * whole input space, and `the toolbar reads one value for both halves`
 * proves the JSX reads `undoBlocked`/`redoBlocked`. Both stay green if
 * `recorder.tsx` changed to `undoReason({ dragging: false, idleEditable,
 * canUndo: editor.canUndo })` — that call typechecks and silently drops the
 * #317 drag lock from Undo and Redo, because `dragging` is a compile-time
 * REQUIRED field (`HistoryControlInputs`), not a boolean that can be omitted;
 * the only way to defeat the lock is to keep the key and change what feeds
 * it, which is exactly the shape neither existing suite can see.
 *
 * So this reads the CALL LITERAL, scoped with `bodyAfter` the same way the
 * `editRowReason` call site above is, and requires the `dragging` KEY to be
 * shorthand — bound to the live identifier, not re-keyed to a literal or a
 * different expression. A bare substring search for "dragging" would NOT
 * catch the regression above: `{ dragging: false, ... }` still contains the
 * word "dragging" as its own key. Scoping to the sliced literal (not the
 * whole file, where "dragging" also names the drag-state variable used
 * elsewhere in `recorder.tsx`) is the George round-8 note this issue already
 * carries twice over — a whole-file grep passes on a call site that does not
 * pass the flag.
 */
describe("recorder.tsx's history call sites pass the live drag flag (#719 item 4)", () => {
  it("undoReason's and redoReason's call literals bind `dragging` as shorthand, not to a fixed value", () => {
    const source = recorderCode();
    for (const [marker, prop] of [
      ["undoReason({", "undoBlocked"],
      ["redoReason({", "redoBlocked"],
    ] as const) {
      const call = bodyAfter(source, marker);
      // Shorthand `dragging,` (or `dragging}`) reads the live binding.
      // `dragging: <anything>` re-keys it to a fixed or different value and
      // must fail this — the negative lookahead is the whole point, not the
      // bare `\bdragging\b` match a mutation of this test would weaken it to.
      expect(
        call,
        `${prop}'s call literal did not bind \`dragging\` as shorthand: ${call}`
      ).toMatch(/\bdragging\b(?!\s*:)/);
    }
  });
});
