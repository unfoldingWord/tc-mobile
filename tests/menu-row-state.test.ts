import { describe, expect, it } from "vitest";

import {
  editRowReason,
  eraseRowReason,
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

const eraseOpen = { hasView: true, takeActive: false, hasClip: true };

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

  // No reason carries a glyph. The uncommitted-take row is only ever seen
  // inside the ≡ menu, where the sheet is inert and the sole live back-chevron
  // is the menu's own Close — so a Back badge marked the DISMISS control as the
  // way out (George, round 1). The words carry it instead, and must name closing
  // the menu BEFORE Back, which is the only order the overlay allows.
  it("an uncommitted take speaks both steps, in the order the overlay allows", () => {
    expect(rowHint("uncommitted-take")).toEqual({
      label: spoken(strings.blockedByTake),
    });
    const said = strings.blockedByTake.toLowerCase();
    expect(said).toContain("menu");
    expect(said.indexOf("menu")).toBeLessThan(said.indexOf("back"));
  });

  it("an empty segment speaks its reason", () => {
    expect(rowHint("no-audio")).toEqual({
      label: spoken(strings.nothingRecorded),
    });
    expect(rowHint("no-clip")).toEqual({
      label: spoken(strings.nothingStored),
    });
  });

  it("no reason carries a glyph — RowHint is words only", () => {
    const reasons = [
      "uncommitted-take",
      "denied",
      "no-segment",
      "no-audio",
      "no-clip",
    ] as const;
    for (const r of reasons) {
      const hint = rowHint(r);
      // `denied`/`no-segment` return null (no cue at all); the rest must be a
      // label and nothing else. Asserting the exact key set is what fails if a
      // glyph is ever reintroduced here.
      if (hint === null) continue;
      expect(Object.keys(hint)).toEqual(["label"]);
    }
  });

  it("denied and no-segment carry nothing — the row is unreachable there", () => {
    expect(rowHint("denied")).toBeNull();
    expect(rowHint("no-segment")).toBeNull();
  });

  it("an enabled row has no hint", () => {
    expect(rowHint(null)).toBeNull();
  });
});
