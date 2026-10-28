import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import {
  MIC_RETRY_TAPPED,
  nextMicRetryPhase,
  showMicSettingsSteps,
} from "@/lib/audio/mic-retry";
import { strings } from "@/lib/strings";

import { areaRule, areaScope, areaSelector } from "./o4-area-css";
import { one, render } from "./render";
import { cssRule, declarationValue } from "./support";

/**
 * #1089: the mic-refused card shakes each time Retry comes back refused.
 * Props to attribute only (#197): the render shows which markup carries the
 * hook; the stylesheet reads show the rule and its reduced-motion off switch.
 * Nothing here runs an animation in a browser.
 */
const SELECTOR = areaSelector("motion", ".o4-err-body[data-refused]");
/** The delete ask's head shakes on the same rule (#1089 reused it). */
const DELETE_HEAD = areaSelector(
  "motion",
  ".books-delete-ask > .o4-sheet-head"
);
const REDUCED = "@media (prefers-reduced-motion: reduce)";

const panel = (settingsPlatform: "android-app" | "ios-app" | null) =>
  render(
    createElement(PermissionPanel, {
      message: null,
      onRetry: () => {},
      onBack: () => {},
      settingsPlatform,
    })
  );

describe("the shake hook is on the panel only while refused (#1089)", () => {
  it("is absent on the first refusal", () => {
    expect(one(panel(null), ".o4-err-body").hasAttribute("data-refused")).toBe(
      false
    );
  });

  it.each(["android-app", "ios-app"] as const)(
    "is present with the %s settings steps",
    (platform) => {
      expect(
        one(panel(platform), ".o4-err-body").getAttribute("data-refused")
      ).toBe("true");
    }
  );

  it("leaves and returns with each refusal, so the animation replays", () => {
    // What the recorder feeds the panel: platform set iff the steps show.
    const hook = (phase: Parameters<typeof showMicSettingsSteps>[0]) =>
      showMicSettingsSteps(phase, strings.micSiteBlocked);
    let phase = nextMicRetryPhase(MIC_RETRY_TAPPED, "requesting", false);
    phase = nextMicRetryPhase(phase, "idle", true);
    expect(hook(phase)).toBe(true);
    // Second Retry: the attribute is dropped at the tap...
    expect(hook(MIC_RETRY_TAPPED)).toBe(false);
    phase = nextMicRetryPhase(MIC_RETRY_TAPPED, "requesting", false);
    expect(hook(phase)).toBe(false);
    // ...and added again when it is refused again.
    phase = nextMicRetryPhase(phase, "idle", true);
    expect(hook(phase)).toBe(true);
  });
});

describe("the shake rule and its off switch (#1089)", () => {
  // Each rule read by its selector in its own block (`areaScope`), never as
  // the text between two anchors.
  const layer = areaScope("motion");

  it("plays the design-system shake on the refused card", () => {
    const rule = areaRule(layer, SELECTOR);
    expect(declarationValue(rule, "animation")).toBe(
      "shake var(--p-ambient-shake, 0.35s) ease-in-out 2"
    );
    // One rule serves both: the delete ask's head is the same rule.
    expect(areaRule(layer, DELETE_HEAD)).toBe(rule);
  });

  it("names a shake keyframes block that moves the card", () => {
    const shake = areaScope("motion", "@keyframes shake");
    expect(declarationValue(cssRule(shake, "25%"), "transform")).toBe(
      "translateX(-4px)"
    );
    expect(declarationValue(cssRule(shake, "75%"), "transform")).toBe(
      "translateX(4px)"
    );
  });

  it("is switched off inside the reduced-motion block", () => {
    const guard = areaScope("motion", REDUCED);
    expect(declarationValue(areaRule(guard, SELECTOR), "animation")).toBe(
      "none"
    );
  });
});
