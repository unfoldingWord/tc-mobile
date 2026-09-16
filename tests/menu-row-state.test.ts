import { describe, expect, it } from "vitest";

import {
  editRowReason,
  eraseRowReason,
  heldTakeIsBusy,
  markRowReason,
  rowHint,
} from "@/components/menu-row-state";
import { strings } from "@/components/strings";

/**
 * #135 — a disabled recorder-menu row must carry its reason.
 *
 * The rows' `disabled` flags used to be inline boolean expressions in
 * `recorder.tsx`; the cue that explains a grey row has to be derived from the
 * SAME predicates, or the two drift and the row lies. These pin (1) the gate
 * each row carries — the Edit row's since #134 lets a live/paused take through
 * (commit-then-edit), so it no longer just reproduces the shipped idle-only
 * gate — (2) which reason wins when several hold, and (3) which reasons carry a
 * glyph cue.
 *
 * No renderer here (this repo has no jsdom); `Control`'s badge markup and the
 * menu's reachability — and the commit-then-edit wiring itself — are review +
 * on-device surface.
 */

const editOpen = {
  hasView: true,
  committing: false,
  hasTake: false,
  starting: false,
  denied: false,
  hasAudio: true,
  canPaste: false,
};

describe("editRowReason — the record-then-edit gate (#134)", () => {
  it("is enabled at idle with audio", () => {
    expect(editRowReason(editOpen)).toBeNull();
  });

  it("is enabled on an EMPTY segment when the clipboard is full (George #89 R2)", () => {
    expect(
      editRowReason({ ...editOpen, hasAudio: false, canPaste: true })
    ).toBeNull();
  });

  it("is disabled on an empty segment with an empty clipboard and no take", () => {
    expect(
      editRowReason({ ...editOpen, hasAudio: false, canPaste: false })
    ).toBe("no-audio");
  });

  // The #134 fix, red-first: this asserted "uncommitted-take" (disabled) before
  // the fix — the exact bug the requirements owner reported, Edit greyed after a
  // take. A live or paused take now ENABLES Edit; `onEnterEdit` commits it, then
  // edits. Reverting the `committing`/`hasTake` split (blocking on any non-idle
  // state again) turns this red.
  it("is ENABLED while a take is live or paused — entering Edit commits it, then edits (#134)", () => {
    expect(editRowReason({ ...editOpen, hasTake: true })).toBeNull();
  });

  // A FIRST take: nothing stored on disk, empty clipboard, but the paused take is
  // the thing to edit — so `hasTake` alone must carry it past the no-audio gate.
  it("is ENABLED on a first take with nothing stored yet (#134)", () => {
    expect(
      editRowReason({
        ...editOpen,
        hasTake: true,
        hasAudio: false,
        canPaste: false,
      })
    ).toBeNull();
  });

  // The one window that still blocks Edit: the take is actually committing (the
  // Back-tapped close, or a #59 interruption's `processing` freeze). Editing must
  // wait for that to settle, so the row keeps its reason there.
  it("is disabled ONLY while the take is committing — the close/processing window (#134)", () => {
    expect(editRowReason({ ...editOpen, committing: true })).toBe(
      "uncommitted-take"
    );
  });

  it("is disabled while the mic is denied (the permission panel owns the body)", () => {
    expect(editRowReason({ ...editOpen, denied: true })).toBe("denied");
  });

  it("is disabled with no segment loaded", () => {
    expect(editRowReason({ ...editOpen, hasView: false })).toBe("no-segment");
  });

  it("the committing window outranks every other reason — it is the actionable one", () => {
    expect(
      editRowReason({
        hasView: true,
        committing: true,
        hasTake: false,
        starting: false,
        denied: true,
        hasAudio: false,
        canPaste: false,
      })
    ).toBe("uncommitted-take");
  });

  it("denied outranks no-audio: the panel, not the row, explains that state", () => {
    expect(editRowReason({ ...editOpen, denied: true, hasAudio: false })).toBe(
      "denied"
    );
  });
});

const eraseOpen = {
  hasView: true,
  takeActive: false,
  starting: false,
  hasClip: true,
};

describe("eraseRowReason — reproduces the shipped gate", () => {
  it("is enabled at idle with a stored clip", () => {
    expect(eraseRowReason(eraseOpen)).toBeNull();
  });

  it("is disabled while a take is active, even over a stored clip (George R-B6)", () => {
    expect(eraseRowReason({ ...eraseOpen, takeActive: true })).toBe(
      "uncommitted-take"
    );
  });

  it("is disabled with nothing stored — a first, uncommitted take has no clip", () => {
    expect(eraseRowReason({ ...eraseOpen, hasClip: false })).toBe("no-clip");
  });

  it("is disabled with no segment loaded", () => {
    expect(eraseRowReason({ ...eraseOpen, hasView: false })).toBe("no-clip");
  });
});

describe("rowHint — which reasons carry a cue", () => {
  // `toEqual` on a strings-table entry passed once with the entry MISSING —
  // `undefined` equalled `undefined` — so every spoken label is also pinned as
  // a real, non-empty string before it is compared.
  const spoken = (label: unknown): string => {
    expect(typeof label).toBe("string");
    expect((label as string).length).toBeGreaterThan(0);
    return label as string;
  };

  it("an uncommitted take speaks both steps, in the order the overlay allows", () => {
    expect(rowHint("uncommitted-take")).toEqual({
      icon: "alert",
      label: spoken(strings.blockedByTake),
    });
    // While the ≡ menu is open the sheet's control is behind the scrim, so the
    // menu must be closed BEFORE it is reachable. (The sheet is only `inert` at
    // idle since #75, but the header — and so header Back — stays inert under
    // any overlay regardless of `takeActive` (George R2 P2), so Back is not
    // reachable to AT while this menu is up, mid-take or not.) Order is the
    // whole content of this cue; a string naming them the other way round is
    // wrong, not just clumsy (George, round 1).
    const said = strings.blockedByTake;
    expect(said.indexOf(strings.menuClose)).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(strings.menuClose)).toBeLessThan(
      said.indexOf(strings.closeRecorder)
    );
  });

  // Every control a hint tells the translator to use must EXIST under that name.
  // An earlier draft said "tap Back"; nothing in the product is named Back — the
  // two chevrons are "Close menu" and "Close recorder" — so a screen-reader user
  // hunting for it found nothing (George, round 2). The two strings that must
  // NAME the control are checked directly, so a rename of the control fails the
  // suite instead of silently orphaning the words.
  it("hint copy names controls that actually exist", () => {
    for (const copy of [strings.blockedByTake, strings.previewUnavailable]) {
      expect(copy).toContain(strings.closeRecorder);
    }
  });

  // The "Back" ban is a PRODUCT-WIDE rule, so it is enforced over the whole
  // table rather than the two strings that happened to prompt it. Scanning two
  // named entries let a sibling PR add a third that says "Tap Back" with this
  // suite still green (QA review, `2a036b4`) — the two changes merge cleanly, so
  // nothing else would have caught the contradiction either. Red-first: adding
  // that string here fails this test.
  //
  // Limit, stated rather than implied: this scans the table's STRING entries.
  // The few function-valued entries build their copy at call time and are not
  // covered — widening to them means inventing arguments, which is a worse
  // trade than saying so here.
  it("no copy anywhere sends the translator to a control named Back", () => {
    // Widened to `unknown` first: `strings` is a literal-typed table, so a
    // `v is string` guard is not assignable to its own value union.
    const values: readonly unknown[] = Object.values(strings);
    const table = values.filter((v): v is string => typeof v === "string");
    expect(table.length).toBeGreaterThan(0);
    for (const copy of table) {
      expect(copy.toLowerCase()).not.toMatch(/\btap back\b/);
    }
  });

  it("an empty segment speaks its reason", () => {
    expect(rowHint("no-audio")).toEqual({
      icon: "alert",
      label: spoken(strings.nothingRecorded),
    });
    expect(rowHint("no-clip")).toEqual({
      icon: "alert",
      label: spoken(strings.nothingStored),
    });
  });

  // The glyph must be a STATE mark, never a control glyph. Round 1 shipped
  // `back`, which named a control the overlay makes untappable and pointed at the
  // menu's dismiss instead. `alert` says "blocked, look here" and names nothing.
  it("every visible cue uses the alert state mark, never a control glyph", () => {
    const reasons = [
      "uncommitted-take",
      "denied",
      "no-segment",
      "no-audio",
      "no-clip",
    ] as const;
    for (const r of reasons) {
      const hint = rowHint(r);
      if (hint === null) continue;
      expect(hint.icon).toBe("alert");
    }
  });

  // Neither reason gets a cue, but NOT for one shared reason — the previous
  // version of this test asserted "the row is unreachable there" for both, which
  // was false for `denied`: a disabled opener blocks opening, and `denied` can
  // turn on while the menu is ALREADY up (George, round 4). `recorder.tsx` now
  // dismisses the menu on that edge, which is what makes the claim true; here we
  // pin only what this module owns — that neither carries a cue.
  it("denied and no-segment carry no cue", () => {
    expect(rowHint("denied")).toBeNull();
    expect(rowHint("no-segment")).toBeNull();
  });

  it("an enabled row has no hint", () => {
    expect(rowHint(null)).toBeNull();
  });
});

describe("markRowReason — the third row in the same menu (round 3)", () => {
  const markOpen = {
    hasView: true,
    takeCommitting: false,
    starting: false,
    canFinish: true,
  };

  it("is enabled once a take will exist on close", () => {
    expect(markRowReason(markOpen)).toBeNull();
  });

  // The gate that separates this row from Edit/Erase: Mark rides the take
  // through `addTake`, so it stays live while recording or paused — only the
  // commit window (isClosing / requesting / processing) freezes it. A copy of
  // the Edit row's `takeActive` here would break record-and-mark-in-one-sheet.
  it("stays enabled through a live or paused take — only the commit window freezes it", () => {
    expect(markRowReason({ ...markOpen, takeCommitting: false })).toBeNull();
    expect(markRowReason({ ...markOpen, takeCommitting: true })).toBe(
      "uncommitted-take"
    );
  });

  it("is disabled on a segment that has never been recorded", () => {
    expect(markRowReason({ ...markOpen, canFinish: false })).toBe("no-audio");
  });

  it("is disabled with no segment loaded", () => {
    expect(markRowReason({ ...markOpen, hasView: false })).toBe("no-audio");
  });

  it("the commit window outranks the never-recorded reason", () => {
    expect(
      markRowReason({
        hasView: true,
        takeCommitting: true,
        starting: false,
        canFinish: false,
      })
    ).toBe("uncommitted-take");
  });
});

/**
 * The `requesting` race (round 3): Record tapped, ≡ opened before
 * `getUserMedia` resolves. No audio exists yet, so the uncommitted-take words
 * ("…to save the recording") would promise a save that cannot happen — and
 * `close()` does not treat `requesting` as an attempted capture, so following
 * them abandons the in-flight start. Every row that can be seen in that window
 * must say something else.
 */
describe("the starting race — all three rows, distinct words", () => {
  it("outranks the uncommitted-take reason on every row", () => {
    expect(
      editRowReason({
        ...editOpen,
        committing: true,
        hasTake: true,
        starting: true,
      })
    ).toBe("starting");
    expect(
      eraseRowReason({ ...eraseOpen, takeActive: true, starting: true })
    ).toBe("starting");
    expect(
      markRowReason({
        hasView: true,
        takeCommitting: true,
        starting: true,
        canFinish: true,
      })
    ).toBe("starting");
  });

  it("says something other than the save-the-recording copy", () => {
    const starting = rowHint("starting");
    expect(starting).toEqual({ icon: "alert", label: strings.micStarting });
    expect(starting?.label).not.toBe(strings.blockedByTake);
    // The whole point: it must not send anyone to a control that would abandon
    // the in-flight start, so it names no control at all.
    expect(starting?.label).not.toContain(strings.closeRecorder);
    expect(starting?.label).not.toContain(strings.menuClose);
  });
});

/**
 * #165 / #336 — the held-take panel's Discard destroys the ONLY copy of a take
 * whose decode failed, so every operation holding that take has to block it.
 * `sharing` joined `retrying` when the native share route landed: there the
 * chooser does NOT open in the tap — the file is written to the app cache first,
 * in 768 KB chunks, each returning to the event loop with the panel mounted and
 * clickable (George R5 P1).
 *
 * The predicate is shared by the control's `disabled`, by the armed-confirm
 * display, and by `leaveHeldTake`'s guard, for the reason at the top of
 * `menu-row-state.ts`: a second switch elsewhere is one that falls out of step.
 */
describe("heldTakeIsBusy", () => {
  it("lets the take be dropped when nothing is holding it", () => {
    expect(heldTakeIsBusy({ retrying: false, sharing: false })).toBe(false);
  });

  it("holds it during a re-decode", () => {
    expect(heldTakeIsBusy({ retrying: true, sharing: false })).toBe(true);
  });

  it("holds it during a share — the native write runs before the chooser", () => {
    // The regression this exists for: two taps during the cache write used to
    // delete the recording out from under a share that had not reached the OS.
    expect(heldTakeIsBusy({ retrying: false, sharing: true })).toBe(true);
  });

  it("holds it while both are somehow true", () => {
    expect(heldTakeIsBusy({ retrying: true, sharing: true })).toBe(true);
  });
});
