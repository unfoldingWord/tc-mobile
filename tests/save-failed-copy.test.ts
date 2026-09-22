import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SaveFailed } from "@/components/save-failed";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * `SaveFailed` paints the sentences the table holds, on the path it is given.
 *
 * #169 moved this screen's remaining inline copy into `lib/strings.ts`. The
 * words did not change — `git log -p` is the record of that — but three of
 * them are now chosen by a call with two arguments (`saveHeld(editOnly,
 * ordinal)`, `saveDiscard(editOnly, armed)`, `saveFailedDialog(editOnly)`),
 * and an argument in the wrong place is a defect no type catches: both of
 * `saveHeld`'s sentences are strings, and a swapped `editOnly` would tell a
 * translator their edit is held when a whole recording is.
 *
 * So this asserts the SCREEN's output against the TABLE's functions rather
 * than against typed-out sentences — a test that re-typed the wording would
 * pass while the screen painted the other path's sentence. Which path the
 * arguments describe is then checked directly, by the two cases at the end
 * that read the words: those are the only assertions here that may name a
 * sentence, because "recording" vs "edited recording" is the whole claim.
 *
 * One render, no events (see `tests/render.ts`): the ARMED second tap of
 * Discard, and its hint line, are a state change this harness cannot reach,
 * so `saveDiscard(..., true)` and `saveDiscardHint` are covered by
 * construction here and not by a rendered assertion. Said plainly rather than
 * implied — a file named for this screen's copy should not read as if it
 * covered the destructive tap.
 */
const base = {
  state: "failed" as const,
  kind: "unknown" as const,
  editOnly: false,
  ordinal: 3,
  holdsCutAudio: false,
  attempts: 1,
  onRetry: vi.fn(),
  onDiscard: vi.fn(),
};

describe("SaveFailed paints the table's copy (#169)", () => {
  for (const editOnly of [false, true]) {
    for (const ordinal of [3, null]) {
      it(`names the held work for editOnly=${editOnly}, ordinal=${ordinal}`, () => {
        const container = render(
          createElement(SaveFailed, { ...base, editOnly, ordinal })
        );

        expect(container.textContent).toContain(
          strings.saveHeld(editOnly, ordinal)
        );
      });
    }
  }

  it("takes its own accessible name from the table, on each path", () => {
    for (const editOnly of [false, true]) {
      const container = render(
        createElement(SaveFailed, { ...base, editOnly })
      );

      expect(
        one(container, '[role="alertdialog"]').getAttribute("aria-label")
      ).toBe(strings.saveFailedDialog(editOnly));
    }
  });

  it("labels Retry and the un-armed Discard from the table, on each path", () => {
    for (const editOnly of [false, true]) {
      const container = render(
        createElement(SaveFailed, { ...base, editOnly })
      );
      const labels = [...container.querySelectorAll("[aria-label]")].map(
        (node) => node.getAttribute("aria-label")
      );

      expect(labels).toContain(strings.saveRetry);
      expect(labels).toContain(strings.saveDiscard(editOnly, false));
      // The armed wording must NOT be on screen before the first tap — two
      // taps mean two taps, and this is the half of that the harness can see.
      expect(labels).not.toContain(strings.saveDiscard(editOnly, true));
    }
  });

  it("shows the saving title, and no Retry, while an attempt is in flight", () => {
    const container = render(
      createElement(SaveFailed, { ...base, state: "saving" })
    );

    expect(container.textContent).toContain(strings.saveFailedSaving);
    expect(
      container.querySelector(`[aria-label="${strings.saveRetry}"]`)
    ).toBeNull();
  });

  // The two that read the words, because the words are the claim: the edit
  // path must never call the held work a recording the translator could lose,
  // and the record path must never call it an edit.
  it("says 'edited recording' on the edit path and not on the record path", () => {
    const edit = render(createElement(SaveFailed, { ...base, editOnly: true }));
    const record = render(
      createElement(SaveFailed, { ...base, editOnly: false })
    );

    expect(edit.textContent).toContain("edited recording");
    expect(record.textContent).not.toContain("edited recording");
  });

  it("names the segment only when the held take belongs to this chapter", () => {
    // The other half of `saveHeld`'s two arguments, and it needs its own words
    // for the reason the `editOnly` cases above do: every assertion that calls
    // `strings.saveHeld` compares the screen against the table, so inverting
    // the table's own `ordinal === null` branch moves both sides together and
    // passes. Proven by mutation — that inversion left all nine of the other
    // cases green.
    const numbered = render(createElement(SaveFailed, { ...base, ordinal: 3 }));
    const unnumbered = render(
      createElement(SaveFailed, { ...base, ordinal: null })
    );

    expect(numbered.textContent).toContain("of segment 3");
    expect(unnumbered.textContent).not.toContain("of segment");
  });

  it("offers 'Discard these changes' on the edit path, never 'Delete this recording'", () => {
    const edit = render(createElement(SaveFailed, { ...base, editOnly: true }));
    const labels = [...edit.querySelectorAll("[aria-label]")].map((node) =>
      node.getAttribute("aria-label")
    );

    expect(labels).toContain("Discard these changes");
    expect(labels).not.toContain("Delete this recording");
  });
});
