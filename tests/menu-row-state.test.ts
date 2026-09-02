import { describe, expect, it } from "vitest";

import {
  editRowReason,
  eraseRowReason,
  markRowReason,
  rowHint,
} from "@/components/menu-row-state";
import { strings } from "@/components/strings";

/**
 * #135 — a disabled recorder-menu row must carry its reason.
 *
 * The rows' `disabled` flags used to be inline boolean expressions in
 * `recorder.tsx`; the cue that explains a grey row has to be derived from the
 * SAME predicates, or the two drift and the row lies. These pin (1) that the
 * derived reason reproduces the exact gate each row shipped with, (2) which
 * reason wins when several hold, and (3) which reasons carry a glyph cue.
 *
 * No renderer here (this repo has no jsdom); `Control`'s badge markup and the
 * menu's reachability are review + on-device surface.
 */

const editOpen = {
  hasView: true,
  takeActive: false,
  starting: false,
  denied: false,
  hasAudio: true,
  canPaste: false,
};

describe("editRowReason — reproduces the shipped gate", () => {
  it("is enabled at idle with audio", () => {
    expect(editRowReason(editOpen)).toBeNull();
  });

  it("is enabled on an EMPTY segment when the clipboard is full (George #89 R2)", () => {
    expect(
      editRowReason({ ...editOpen, hasAudio: false, canPaste: true })
    ).toBeNull();
  });

  it("is disabled on an empty segment with an empty clipboard", () => {
    expect(
      editRowReason({ ...editOpen, hasAudio: false, canPaste: false })
    ).toBe("no-audio");
  });

  it("is disabled while a take is live, paused or committing (the #134 case)", () => {
    expect(editRowReason({ ...editOpen, takeActive: true })).toBe(
      "uncommitted-take"
    );
  });

  it("is disabled while the mic is denied (the permission panel owns the body)", () => {
    expect(editRowReason({ ...editOpen, denied: true })).toBe("denied");
  });

  it("is disabled with no segment loaded", () => {
    expect(editRowReason({ ...editOpen, hasView: false })).toBe("no-segment");
  });

  it("the uncommitted take outranks every other reason — it is the actionable one", () => {
    expect(
      editRowReason({
        hasView: true,
        takeActive: true,
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
    // While the ≡ menu is open the sheet is inert, so the menu must be closed
    // BEFORE the sheet's own control is reachable. Order is the whole content of
    // this cue; a string naming them the other way round is wrong, not just
    // clumsy (George, round 1).
    const said = strings.blockedByTake;
    expect(said.indexOf(strings.menuClose)).toBeGreaterThanOrEqual(0);
    expect(said.indexOf(strings.menuClose)).toBeLessThan(
      said.indexOf(strings.closeRecorder)
    );
  });

  // Every control a hint tells the translator to use must EXIST under that name.
  // An earlier draft said "tap Back"; nothing in the product is named Back — the
  // two chevrons are "Close menu" and "Close recorder" — so a screen-reader user
  // hunting for it found nothing (George, round 2). Both strings that name a
  // control are checked here, so a rename of either control fails the suite
  // instead of silently orphaning the words.
  it("hint copy names controls that actually exist", () => {
    for (const copy of [strings.blockedByTake, strings.previewUnavailable]) {
      expect(copy).toContain(strings.closeRecorder);
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
      editRowReason({ ...editOpen, takeActive: true, starting: true })
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
