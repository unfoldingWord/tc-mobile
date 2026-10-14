import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cssRule,
  declarationValue,
  stripComments,
  stripCssComments,
  stripHtmlComments,
} from "./support";

/**
 * The two zoom/touch policies #164 found wrong, gated so they cannot drift
 * back: R-11 (pinch zoom must stay available) and R-10 (touch targets stay
 * control-sized).
 *
 * Three of these source checks tie to R-11 — the viewport does not forbid
 * pinch zoom, the per-surface touch-action rules that replaced the blanket
 * restriction, and the rename field's font-size floor, which is what now
 * keeps a focused input from auto-zooming in place of the removed viewport
 * lock. The fourth, the chapter screen's crumb row's target token and class
 * wiring, ties to R-10. None of them measure rendered hit areas or exercise gestures on a
 * device; the static render harness in tests/render.ts does not provide
 * layout or cascade.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
// Every source below is read with its comments stripped, so a commented-out
// rule, element or attribute cannot be the match an assertion reads (#822).
const html = stripHtmlComments(
  readFileSync(path.join(ROOT, "index.html"), "utf8")
);
const components = stripCssComments(
  readFileSync(
    path.join(ROOT, "src", "app", "styles", "3-components.css"),
    "utf8"
  )
);
const menusCss = readFileSync(
  path.join(ROOT, "src", "app", "styles", "o4", "menus.css"),
  "utf8"
);

describe("the viewport does not forbid pinch zoom (#164 R-11)", () => {
  const viewport = /<meta\s+name="viewport"[^>]*content="([^"]+)"/s.exec(html);

  it("still has a viewport meta to check", () => {
    expect(viewport?.[1], "no viewport meta found in index.html").toBeTruthy();
  });

  // `user-scalable=no` was here to protect the drag gestures and never did:
  // iOS has ignored it since iOS 10, so the only platform it restricted is
  // Android (#245), and the one whose testers report capture quiet enough to
  // squint at (#359). The gesture surfaces declare their own
  // `touch-action`, which is what actually protects them.
  it("does not set user-scalable=no", () => {
    expect(viewport?.[1] ?? "").not.toMatch(/user-scalable\s*=\s*no/i);
  });

  // The sibling that forbids zoom by a different spelling. Not present today;
  // pinned so "we removed user-scalable" cannot be satisfied by adding this.
  it("does not cap zoom with maximum-scale", () => {
    expect(viewport?.[1] ?? "").not.toMatch(/maximum-scale/i);
  });

  // The half that keeps this honest rather than one-directional: the gesture
  // surfaces must keep declaring the policy that replaced the blanket one.
  // Drop these and pinch-zoom is reachable but a drag scrolls the page.
  it("keeps the per-surface touch-action that replaced it", () => {
    expect(components).toMatch(/touch-action:\s*pan-y/);
    expect(components.match(/touch-action:\s*none/g)?.length ?? 0).toBe(2);
  });
});

describe("the rename field keeps its 16px floor (#164 R-11)", () => {
  // `::placeholder` has its own rule; `\s*\{` keeps this on the field itself.
  const rule = /\.name-input\s*\{([^}]*)\}/s.exec(components);

  it("has a .name-input rule in the component layer", () => {
    expect(rule?.[1], "no .name-input rule in 3-components.css").toBeTruthy();
  });

  // With `user-scalable=no` gone, this floor is the ONLY thing standing
  // between a focused rename field and a zoomed sheet (iOS auto-zooms a
  // focused input under 16px, and now Android can too). The rule's own
  // comment says "do not lower it" — and a comment is not a gate (George R1
  // P3 on #457). A literal, not a token: no token is 16px, and the rule says
  // why.
  it("sets font-size to exactly 16px", () => {
    expect(rule?.[1] ?? "").toMatch(/font-size:\s*16px\s*;/);
  });
});

describe("the chapter screen's crumb row is a control-sized target (#164 R-10)", () => {
  // The `.breadcrumb` button this gate was written for went with the old
  // look (#954); the row that took its place in the Segments header is
  // `.o4-crumbs-bar` (#1269), in the O4 menus stylesheet.
  const body = cssRule(menusCss, ":root .o4-crumbs-bar");

  // Reads the TOKEN, not a raw pixel value: the 44px floor is stated once in
  // 3-components.css's token block, and a rule that hard-codes 44 drifts
  // silently when that block changes. `--c-control-sm` (40px) is the named
  // exception scoped to `.control--quiet`'s toolbar row and #362 — it must
  // not spread here, which is the mistake a copy-paste from a neighbouring
  // quiet control would make.
  it("takes its height from --c-control-md, not a literal or the 40px exception", () => {
    expect(declarationValue(body, "min-height")).toBe("var(--c-control-md)");
    expect(body).not.toMatch(/--c-control-sm/);
  });

  it("--c-control-md is still at or above the 44px floor the tokens claim", () => {
    const md = /--c-control-md:\s*(\d+)px/.exec(components);
    expect(md?.[1], "no --c-control-md token found").toBeTruthy();
    expect(Number(md![1])).toBeGreaterThanOrEqual(44);
  });

  // The defect was `p-0`: geometry in an arbitrary utility on the element,
  // where the component layer could not see it. If the class comes off the
  // row, the rule above is dead and this gate would pass on nothing.
  it("is the class the Segments header actually uses", () => {
    // `stripComments` is string-blind: a `//` or `/*` inside a string literal
    // in segments-screen.tsx would cut real code from what this reads.
    const screen = stripComments(
      readFileSync(
        path.join(ROOT, "src", "components", "segments-screen.tsx"),
        "utf8"
      )
    );
    expect(screen).toMatch(/className="o4-crumbs-bar"/);
    expect(screen, "the p-0 hit area is back").not.toMatch(
      /truncate border-0 bg-transparent p-0/
    );
  });
});
