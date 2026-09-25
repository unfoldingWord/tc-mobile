import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule } from "./support";

/**
 * A Finished segment's waveform and Play button turn green in the recorder,
 * not only in its menu check (#926, extending #81 from the row). The
 * requirements owner's #81 wording: "the whole waveform and everything shifts
 * to a green hue".
 *
 * Two halves, each read from source because the recorder cannot mount under
 * the render harness (#197: one render, no effects): the stylesheet rule that
 * does the painting, and the recorder's wiring of that rule to the same
 * resolved `finishedState` the menu's green check reads. The contrast of the
 * green on the stage is `tests/contrast.test.ts`'s.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const components = readFileSync(
  path.join(ROOT, "src", "app", "styles", "3-components.css"),
  "utf8"
);
const recorder = readFileSync(
  path.join(ROOT, "src", "components", "recorder.tsx"),
  "utf8"
);

describe("the recorder's Finished paint (#926)", () => {
  it("remaps the waveform stroke to the done role under the finished sheet", () => {
    const body = cssRule(components, ".recorder-sheet--finished");
    expect(body).toMatch(/--c-wave-stroke:\s*var\(--s-done\);/);
  });

  it("paints the record toolbar's Play in the done role, through layer 2 only", () => {
    const body = cssRule(
      components,
      ".recorder-sheet--finished .recorder-toolbar.pair .control--play"
    );
    expect(body).toMatch(/background:\s*var\(--s-done\);/);
    expect(body).toMatch(/color:\s*var\(--s-done-ink\);/);
    // The colour boundary (AGENTS.md): no colour primitive in a component rule.
    expect(body).not.toMatch(/var\(--p-/);
  });

  it("keys the sheet's class on the same resolved finishedState the menu reads", () => {
    // The menu paints its check green on `finishedState === "finished"`
    // (recorder-menu.tsx `marked`). A different key — the stored
    // `view.finished`, say — would leave the stage green through an edit that
    // has already demoted the segment to draft.
    expect(recorder).toMatch(
      /finishedState === "finished" && "recorder-sheet--finished"/
    );
  });

  it("tells the canvas to redraw when the mark toggles", () => {
    // A painted canvas cannot observe a CSS-variable change on its own; the
    // `finished` prop is what re-runs Waveform's draw (waveform.tsx).
    const at = recorder.indexOf("<Waveform\n");
    expect(at, "the recorder's <Waveform is still where it was").not.toBe(-1);
    const close = recorder.indexOf("/>", at);
    expect(close).toBeGreaterThan(at);
    expect(recorder.slice(at, close)).toMatch(
      /finished=\{finishedState === "finished"\}/
    );
  });
});
