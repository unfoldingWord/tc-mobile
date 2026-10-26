import { createElement } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SelectionOverlay } from "@/components/selection-overlay";
import {
  CANONICAL_SAMPLE_RATE,
  framesToSpokenSeconds,
} from "@/lib/audio/format";
import { strings } from "@/lib/strings";

import { render } from "./render";
import { stripComments } from "./support";

/**
 * The selection handles' spoken position (#1344). One render, no effects, no
 * events: `aria-valuetext` is a pure function of the sample, so an arrow nudge
 * (which only moves the sample) is covered by rendering two positions. That a
 * screen reader says it was not run.
 */

const SR = CANONICAL_SAMPLE_RATE;
const win = {
  start: 0,
  end: SR * 10,
  visibleSamples: SR * 10,
  centerlineSample: SR * 5,
};
const text = (s: number) =>
  strings.selectionHandleTime(framesToSpokenSeconds(s));

function handles(start: number, end: number, withText = true) {
  const root = render(
    createElement(SelectionOverlay, {
      win,
      selection: { start, end },
      workingLength: SR * 10,
      onChange: () => {},
      startLabel: "Selection start",
      endLabel: "Selection end",
      ...(withText ? { valueText: text } : {}),
    })
  );
  return Array.from(root.querySelectorAll('[role="slider"]'));
}

describe("selection handle aria-valuetext", () => {
  it("speaks each handle as seconds and leaves aria-valuenow a raw sample count", () => {
    const [a, b] = handles(Math.round(SR * 1.2), SR * 4);
    expect(a!.getAttribute("aria-valuetext")).toBe("1.2 seconds");
    expect(a!.getAttribute("aria-valuenow")).toBe(String(Math.round(SR * 1.2)));
    expect(b!.getAttribute("aria-valuetext")).toBe("4 seconds");
    expect(b!.getAttribute("aria-valuenow")).toBe(String(SR * 4));
  });

  it("uses the singular for exactly one second and changes when the handle moves", () => {
    const [a] = handles(SR, SR * 4);
    expect(a!.getAttribute("aria-valuetext")).toBe("1 second");
    const [moved] = handles(SR * 2, SR * 4);
    expect(moved!.getAttribute("aria-valuetext")).toBe("2 seconds");
  });

  it("sets no aria-valuetext without the prop", () => {
    for (const h of handles(0, 100, false)) {
      expect(h.hasAttribute("aria-valuetext")).toBe(false);
    }
  });
});

describe("the recorder's call site", () => {
  // Source read, comments stripped (a comment cannot satisfy it). It pins the
  // wiring only; the text itself is the render above.
  it("passes valueText to the SelectionOverlay it mounts", () => {
    const src = stripComments(
      readFileSync("src/components/recorder.tsx", "utf8")
    );
    const open = src.indexOf("<SelectionOverlay");
    expect(open).toBeGreaterThan(-1);
    const call = src.slice(open, src.indexOf("/>", open));
    expect(call).toContain("valueText={selectionHandleText}");
  });
});
