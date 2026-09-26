import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * D15 (#948) and the DRI's follow-up pick on PR #1033: in the O4 look the
 * mic-denied title is always `strings.micOffTitle`, and the recorder's refusal
 * sentence, when there is one, is a second line under it. The current look
 * keeps `message ?? strings.micNeededTitle`. Both looks are asserted here, so
 * a change that swaps the key or the layout in the wrong branch fails in this
 * file.
 *
 * Props-to-markup only, through `tests/render.ts`: no cascade, so whether the
 * second line LOOKS like a second line is not something this file can answer.
 * The design is set by mocking `useDesign()`, the same seam
 * `tests/o4-errors.test.ts` uses.
 */
let design: Design = "o4";

vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design, toggle: () => {} }),
}));

beforeEach(() => {
  design = "o4";
});

function alertOf(message: string | null): Element {
  const container = render(
    createElement(PermissionPanel, {
      message,
      onRetry: () => {},
      onBack: () => {},
    })
  );
  return one(container, '[role="alert"]');
}

/** The alert's own text, without the second line's. */
function titleText(alert: Element): string {
  return [...alert.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join("");
}

describe("mic-denied title, O4 (D15)", () => {
  it("is a key of its own, holding the DRI's wording", () => {
    // The wording D15 picked, from the O4 original; the current look's key
    // keeps its own wording until O4 becomes the default.
    expect(strings.micOffTitle).toBe("Microphone is off");
    expect(strings.micNeededTitle).toBe(
      "Microphone access is needed to record"
    );
  });

  it("reads the O4 key, with no second line, when there is no sentence", () => {
    const alert = alertOf(null);
    expect(alert.textContent).toBe(strings.micOffTitle);
    expect(alert.querySelector(".o4-err-sub")).toBeNull();
  });

  it("keeps the title fixed when a refusal sentence is passed", () => {
    const alert = alertOf(strings.micSiteBlocked);
    expect(titleText(alert)).toBe(strings.micOffTitle);
  });

  it("puts the refusal sentence on a second line inside the alert", () => {
    const alert = alertOf(strings.micSiteBlocked);
    const sub = one(alert, ".o4-err-sub");
    expect(sub.textContent).toBe(strings.micSiteBlocked);
    // Last, after the title, so it reads as the line under it.
    expect(alert.lastChild).toBe(sub);
    expect(alert.querySelectorAll(".o4-err-sub")).toHaveLength(1);
  });
});

describe("mic-denied title, current look", () => {
  beforeEach(() => {
    design = "current";
  });

  it("keeps the existing key when there is no sentence", () => {
    expect(alertOf(null).textContent).toBe(strings.micNeededTitle);
  });

  it("still lets the refusal sentence replace the title, with no second line", () => {
    const alert = alertOf(strings.micSiteBlocked);
    expect(alert.textContent).toBe(strings.micSiteBlocked);
    expect(alert.querySelector(".o4-err-sub")).toBeNull();
  });
});
