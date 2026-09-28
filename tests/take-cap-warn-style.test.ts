import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue } from "./support";

/**
 * #1005's take-cap marker is a state-in-place tint, not new markup with its
 * own colour — the "marker" a translator actually sees is the recorder's own
 * elapsed-time cluster changing colour (`recorder.tsx`'s `data-near-limit`),
 * and `TakeCapMarker` (`take-cap-marker.tsx`) only supplies the word that
 * rides inside it. `tests/take-cap-marker.test.ts` proves the WORD renders
 * (or does not); the tint itself is a CSS declaration `render.ts`'s static
 * markup never resolves (no cascade, #197), so the tc-prepush checklist's
 * "visual property actually pinned" rule is answered here instead, the way
 * `tests/notice-bridge.test.ts` and `tests/share-progress.test.ts` pin their
 * own colour claims — a declared-value text read, not a computed style in a
 * browser.
 */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

describe("the take-cap tint (#1005)", () => {
  it("tints the recorder-status cluster to the warn role once near the limit", () => {
    const css = read("src/app/styles/3-components.css");
    const body = cssRule(css, '.recorder-status[data-near-limit="true"]');
    expect(declarationValue(body, "color")).toBe("var(--s-warn)");
  });

  it("never reaches a layer-1 colour primitive directly", () => {
    // The colour-boundary rule AGENTS.md states for this stylesheet: only
    // layer 2 (semantic) roles reach a component rule, never a `--p-*`
    // primitive — for COLOUR. `.recorder-take-warn`'s own rule is deliberately
    // NOT checked here: it sets type-size and weight, structural primitives
    // AGENTS.md says a component rule reads directly (the same way `.t-timer`
    // above it in this file reads `--p-text-xl` for its own size), so a
    // `--p-text-xs` there is not the leak this test exists to catch.
    const css = read("src/app/styles/3-components.css");
    const body = cssRule(css, '.recorder-status[data-near-limit="true"]');
    expect(body).not.toMatch(/--p-/);
  });

  it("is absent from the base rule — the tint only applies once near the limit", () => {
    const css = read("src/app/styles/3-components.css");
    const base = cssRule(css, ".recorder-status");
    expect(declarationValue(base, "color")).toBe("var(--s-ink)");
  });

  it("sizes the remaining-minutes word down from O4's larger timer", () => {
    const css = read("src/app/styles/o4/recorder.css");
    const body = cssRule(
      css,
      '[data-design="o4"] .recorder-status .recorder-take-warn'
    );
    // A structural primitive (type size), read directly per AGENTS.md's
    // architecture rule — not a colour, so this one is allowed to reach a
    // layer-1 token, unlike the two rules above.
    expect(declarationValue(body, "font-size")).toBe("15px");
  });
});
