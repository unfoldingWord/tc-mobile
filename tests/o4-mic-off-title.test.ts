import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * D15 (#948): in the O4 look the mic-denied panel's generic title is its own
 * key, `strings.micOffTitle`; the current look keeps `strings.micNeededTitle`.
 * Both looks are asserted here, so a change that swaps the key in the wrong
 * branch, or in both, fails in this file.
 *
 * Props-to-markup only, through `tests/render.ts`. The design is set by
 * mocking `useDesign()`, the same seam `tests/o4-errors.test.ts` uses.
 */
let design: Design = "o4";

vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design, toggle: () => {} }),
}));

beforeEach(() => {
  design = "o4";
});

function alertText(message: string | null): string | null {
  const container = render(
    createElement(PermissionPanel, {
      message,
      onRetry: () => {},
      onBack: () => {},
    })
  );
  return one(container, '[role="alert"]').textContent;
}

describe("mic-denied title (D15)", () => {
  it("is a key of its own, holding the DRI's wording", () => {
    // The wording D15 picked, from the O4 original; the current look's key
    // keeps its own wording until O4 becomes the default.
    expect(strings.micOffTitle).toBe("Microphone is off");
    expect(strings.micNeededTitle).toBe(
      "Microphone access is needed to record"
    );
  });

  it("reads the O4 key in the O4 look", () => {
    expect(alertText(null)).toBe(strings.micOffTitle);
  });

  it("keeps the existing key in the current look", () => {
    design = "current";
    expect(alertText(null)).toBe(strings.micNeededTitle);
  });

  it("still gives way to the actual refusal sentence in both looks", () => {
    expect(alertText(strings.micSiteBlocked)).toBe(strings.micSiteBlocked);
    design = "current";
    expect(alertText(strings.micSiteBlocked)).toBe(strings.micSiteBlocked);
  });
});
