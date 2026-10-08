import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { ShareMenuSection } from "@/components/share-menu-section";
import type { ShareMenuSectionProps } from "@/components/share-menu-section";
import { cssRule, declarationValue } from "./support";
import { render } from "./render";

/**
 * The armed ring on the O4 Share now tile (#1087). The ring is derived from
 * the share's `status === "ready"`, not from a progress phase: the menu is on
 * screen while the file waits for its second tap. Render-only: no cascade, and
 * nothing here ran on a phone.
 */

const base: ShareMenuSectionProps = {
  status: "idle",
  sendUnconfirmed: false,
  error: null,
  scope: "chapter",
  controlRef: () => {},
  idleLabel: "Share chapter",
  preparingLabel: "Preparing",
  unconfirmedLabel: "Share chapter again",
  hasGap: false,
  gapText: "",
  onPrepare: () => {},
  onSend: () => {},
};

function armedCount(props: Partial<ShareMenuSectionProps>): number {
  const root = render(createElement(ShareMenuSection, { ...base, ...props }));
  return root.querySelectorAll(".is-armed").length;
}

describe("the Share now tile is armed only while the file is ready (#1087)", () => {
  it("wears the armed class on the ready tile under O4", () => {
    expect(armedCount({ status: "ready", tiles: {} })).toBe(1);
    expect(
      render(
        createElement(ShareMenuSection, { ...base, status: "ready", tiles: {} })
      ).querySelectorAll(".o4-tile--send.is-armed")
    ).toHaveLength(1);
  });
  it.each(["idle", "preparing"] as const)("not while %s", (status) => {
    expect(armedCount({ status, tiles: {} })).toBe(0);
  });
  it("not in the current look, even when ready", () => {
    expect(armedCount({ status: "ready" })).toBe(0);
  });
});

describe("the armed loop is slow and colours through a layer-2 role (#1087)", () => {
  const css = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/styles/o4/motion.css"),
    "utf8"
  );
  it("runs armedPulse on --p-ambient-armed", () => {
    const rule = cssRule(css, '[data-design="o4"] .o4-tile--send.is-armed');
    expect(declarationValue(rule, "animation")).toBe(
      "armedPulse var(--p-ambient-armed, 1.6s) ease-in-out infinite"
    );
  });
});
