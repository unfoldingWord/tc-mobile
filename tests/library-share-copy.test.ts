import { createElement } from "react";
import { describe, expect, it } from "vitest";

import {
  libraryShareErrorText,
  libraryShareGapText,
  libraryShareProgressText,
} from "@/components/share-error-copy";
import { shareO4View } from "@/components/share-o4-view";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import type { ShareProgress, ShareSettled } from "@/hooks/share-progress";
import type { LibraryShareProgress } from "@/hooks/use-library-share";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The library scope's words and O4 look (#1045): what Share your work says
 * under the share overlay's glyph, phase by phase, and what the O4 circle
 * draws for it. Pure functions, plus one props-to-markup render of the panel
 * through `tests/render.ts`. The overlay's wiring into the Books screen is
 * `tests/library-share-progress.test.ts`'s.
 */

const busy = (work: "prepare" | "send"): LibraryShareProgress => ({
  phase: "busy",
  work,
  since: 0,
  pending: null,
});
const outcome = (
  settled: ShareSettled,
  gap?: {
    missingBooks: number;
    incompleteChapters: number;
    incompleteBooks: number;
  }
): LibraryShareProgress => ({
  phase: "outcome",
  settled,
  since: 0,
  ...(gap ? { gap } : {}),
});

describe("libraryShareProgressText", () => {
  it("says nothing when hidden", () => {
    expect(libraryShareProgressText({ phase: "hidden" }, null)).toBeNull();
  });

  it("uses the library's own preparing line while tap 1 works", () => {
    expect(libraryShareProgressText(busy("prepare"), null)).toBe(
      strings.shareAllPreparing
    );
  });

  it("says the sheet is opening while tap 2 works, as the other scopes do", () => {
    expect(libraryShareProgressText(busy("send"), null)).toBe(
      strings.shareHandingOver
    );
  });

  it.each([
    ["sent", strings.shareSent],
    ["dismissed", strings.shareDismissed],
    ["unproven", strings.shareUnproven],
    ["nothing", strings.shareAllNothing],
    ["failed", strings.shareAllFailed],
    ["encoder", strings.shareEncoderStopped],
  ] as const)("words the %s outcome", (settled, text) => {
    expect(libraryShareProgressText(outcome(settled), null)).toBe(text);
  });

  it("words a failed settle that was a space refusal as the banner does", () => {
    expect(libraryShareProgressText(outcome("failed"), "storage")).toBe(
      strings.shareAllStorage
    );
  });

  it("does not let a stale refinement reword any other outcome", () => {
    expect(libraryShareProgressText(outcome("nothing"), "storage")).toBe(
      strings.shareAllNothing
    );
    expect(libraryShareProgressText(outcome("sent"), "storage")).toBe(
      strings.shareSent
    );
  });

  it("partial is the handed-over line, then the banner's gap sentence in books and chapters", () => {
    const gap = { missingBooks: 2, incompleteChapters: 3, incompleteBooks: 1 };
    expect(libraryShareProgressText(outcome("partial", gap), null)).toBe(
      `${strings.shareSent} ${libraryShareGapText(2, 3)}`
    );
    expect(libraryShareGapText(2, 3)).toBe(
      `${strings.shareAllMissing(2)} ${strings.shareAllIncomplete(3)}`
    );
  });

  it("partial names only the grain that is non-zero", () => {
    expect(
      libraryShareProgressText(
        outcome("partial", {
          missingBooks: 1,
          incompleteChapters: 0,
          incompleteBooks: 0,
        }),
        null
      )
    ).toBe(`${strings.shareSent} ${strings.shareAllMissing(1)}`);
    expect(
      libraryShareProgressText(
        outcome("partial", {
          missingBooks: 0,
          incompleteChapters: 2,
          incompleteBooks: 1,
        }),
        null
      )
    ).toBe(`${strings.shareSent} ${strings.shareAllIncomplete(2)}`);
  });

  it("a partial with no gap to name reads as sent, never a dangling space", () => {
    expect(libraryShareProgressText(outcome("partial"), null)).toBe(
      strings.shareSent
    );
  });
});

describe("libraryShareErrorText", () => {
  it.each([
    [null, null],
    ["nothing", strings.shareAllNothing],
    ["failed", strings.shareAllFailed],
    ["storage", strings.shareAllStorage],
    ["encoder", strings.shareEncoderStopped],
  ] as const)("%s reads %s", (code, text) => {
    expect(libraryShareErrorText(code)).toBe(text);
  });
});

/** A library prepare as the O4 view receives it: busy, with no count. */
const PACKING: ShareProgress = {
  phase: "busy",
  work: "prepare",
  since: 0,
  pending: null,
};

describe("the O4 circle for the library scope", () => {
  it("while packing: the share glyph, an unvalued meter, no ring and no chips", () => {
    expect(shareO4View(PACKING, "library")).toEqual({
      icon: "share",
      ring: null,
      meter: { now: null },
      chips: [],
    });
  });

  it("handed over: the workbench's check at 100, and still no chips", () => {
    const view = shareO4View(
      { phase: "outcome", settled: "sent", since: 0 },
      "library"
    );
    expect(view.icon).toBe("check");
    expect(view.meter).toEqual({ now: 100 });
    expect(view.chips).toEqual([]);
  });

  it("renders the library's own line under the circle, with no chip row", () => {
    const container = render(
      createElement(ShareProgressPanel, {
        role: "status",
        icon: "share-busy",
        text: libraryShareProgressText(busy("prepare"), null),
        o4: shareO4View(PACKING, "library"),
      })
    );
    expect(one(container, ".share-progress-text").textContent).toBe(
      strings.shareAllPreparing
    );
    expect(container.querySelector(".share-o4-chips")).toBeNull();
    expect(
      one(container, ".share-o4-core").getAttribute("aria-valuenow")
    ).toBeNull();
  });
});
