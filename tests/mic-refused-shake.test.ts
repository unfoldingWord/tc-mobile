import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import {
  MIC_RETRY_TAPPED,
  nextMicRetryPhase,
  showMicSettingsSteps,
} from "@/lib/audio/mic-retry";
import { strings } from "@/lib/strings";

import { one, render } from "./render";
import { cssRule, declarationValue, region, stripCssComments } from "./support";

/**
 * #1089: the mic-refused card shakes each time Retry comes back refused.
 * Props to attribute only (#197): the render shows which markup carries the
 * hook; the stylesheet reads show the rule and its reduced-motion off switch.
 * Nothing here runs an animation in a browser.
 */
const SELECTOR = ":root .o4-err-body[data-refused]";
const CSS = stripCssComments(
  readFileSync(
    path.resolve(import.meta.dirname, "../src/app/styles/o4/motion.css"),
    "utf8"
  )
);

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
  it("plays the design-system shake on the refused card", () => {
    const rule = cssRule(
      region(CSS, {
        from: CSS.indexOf(":root .books-delete-ask > .o4-sheet-head"),
        to: CSS.indexOf("@keyframes shake"),
      }),
      SELECTOR
    );
    expect(declarationValue(rule, "animation")).toBe(
      "shake var(--p-ambient-shake, 0.35s) ease-in-out 2"
    );
  });

  it("is switched off inside the reduced-motion block", () => {
    const guard = region(CSS, {
      from: CSS.indexOf("@media (prefers-reduced-motion: reduce)"),
      to: CSS.length,
    });
    expect(declarationValue(cssRule(guard, SELECTOR), "animation")).toBe(
      "none"
    );
  });
});
