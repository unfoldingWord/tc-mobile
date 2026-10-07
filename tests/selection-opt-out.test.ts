import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * Extends #559's selection opt-out (#563, the DRI's "Extend it with the same
 * CSS" pick, 2026-09-28): the same three declarations #559 put on
 * `.recorder-sheet`, `.menu-panel` and `.confirm-panel` now also sit on the
 * Segments rows (`.row`), the Segments header/breadcrumb (`.breadcrumb`), the
 * Books rows (`.books-card`, which reaches its chapter rows by inheritance —
 * `.books-chapters` is a DOM child of `.books-card`) and the ShareProgress
 * portal root (`.share-scrim`). No new class, same three declarations, same
 * reasoning #559 gave: these are control-only surfaces, and inheritance
 * carries the opt-out to their text without a second rule per descendant.
 *
 * HOW THIS READS THE SOURCE. `cssRule` (tests/support.ts) strips comments
 * first, then finds the ONE rule matching the exact selector text and
 * returns its body — so a comment naming a selector cannot satisfy this the
 * way #529's round 3 trap did, and an ambiguous or empty match throws rather
 * than silently passing (the AGENTS.md non-emptiness floor: this is the
 * `share-progress.test.ts` shape, not `touch-policy.test.ts`'s whole-file
 * regex). `declarationValue` then anchors each property on a declaration
 * boundary and throws if it is absent or repeated, so `toBe("none")` is a
 * real assertion on a real value, not a substring match a stray comment
 * could also satisfy.
 *
 * WHAT THIS DOES NOT COVER. #559's own four targets (`.recorder-sheet`,
 * `.menu-panel`, `.confirm-panel`, `.name-input`) have no dedicated pinning
 * test anywhere in this repo as of this PR — a pre-existing gap, not
 * introduced or widened here, and out of #563's scope to backfill. Nor does
 * this run a cascade: whether these rules win in the built bundle and
 * whether the platform actually suppresses selection are phone checks
 * (#564's shape), not a source read — no phone has run this PR (#245).
 */
const COMPONENTS_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "src/app/styles/3-components.css"
);
const BOOKS_O4_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "src/app/styles/o4/books.css"
);

const componentsCss = readFileSync(COMPONENTS_PATH, "utf8");
const booksO4Css = readFileSync(BOOKS_O4_PATH, "utf8");

/**
 * `.row`'s own real ambiguity, worked around rather than hidden: the
 * reduced-motion query (3-components.css) declares
 * `.control, .paste-marker, .row { transition: none; }`, and `.row` as the
 * last item of that comma list sits alone on its own line — line-anchored
 * `cssRule` cannot tell that from a standalone `.row {` rule, so it throws
 * "ambiguous". The reduced-motion block only ever declares `transition`, so
 * filtering candidates by CONTENT, not by position, keeps this from
 * silently picking the wrong match if the file is reordered — an empty or
 * misdeclared block still fails the length check below rather than being
 * skipped quietly.
 */
function rowRuleBody(css: string): string {
  const stripped = stripCssComments(css);
  const matches = [...stripped.matchAll(/^\s*\.row\s*\{([^{}]*)\}/gm)];
  const real = matches.filter(
    (m) => (m[1] ?? "").trim() !== "transition: none;"
  );
  if (real.length !== 1) {
    throw new Error(
      `rowRuleBody: expected exactly one non-reduced-motion .row rule, found ${real.length}`
    );
  }
  const body = (real[0]?.[1] ?? "").trim();
  if (!body) throw new Error("rowRuleBody: empty rule");
  return body;
}

/** Asserts the three opt-out declarations are on the rule for `selector`,
 *  with their exact values, in `css`. `.row` goes through `rowRuleBody`
 *  above instead of `cssRule`, for the reason documented there. */
function expectOptOut(css: string, selector: string): void {
  const body = selector === ".row" ? rowRuleBody(css) : cssRule(css, selector);
  expect(
    declarationValue(body, "-webkit-user-select"),
    `${selector}: -webkit-user-select`
  ).toBe("none");
  expect(
    declarationValue(body, "user-select"),
    `${selector}: user-select`
  ).toBe("none");
  expect(
    declarationValue(body, "-webkit-touch-callout"),
    `${selector}: -webkit-touch-callout`
  ).toBe("none");
}

describe("selection opt-out extended to the Segments and Books rows, the header, and ShareProgress (#563)", () => {
  it("opts the Segments rows out (.row, 3-components.css — shared by both looks)", () => {
    expectOptOut(componentsCss, ".row");
  });

  it("opts the Segments header/breadcrumb out (.breadcrumb, 3-components.css)", () => {
    expectOptOut(componentsCss, ".breadcrumb");
  });

  it("opts the ShareProgress portal root out (.share-scrim, 3-components.css)", () => {
    expectOptOut(componentsCss, ".share-scrim");
  });

  it("opts the Books rows out (.books-card, o4/books.css — reaches .books-chapter by inheritance)", () => {
    expectOptOut(booksO4Css, '[data-design="o4"] .books-card');
  });

  it("does not opt the rename field back in inside any of these roots", () => {
    // Unlike .menu-panel, none of the four roots above contains a
    // .name-input — both book/chapter/segment rename fields render inside
    // the portalled Menu, never inline in a row, a breadcrumb or the share
    // portal — so there is no opt-back-in rule to pin here. This asserts the
    // premise rather than a text-input UX claim: a `.name-input` rule inside
    // any of these four selectors' source blocks would mean a rename field
    // moved somewhere this opt-out would now silently swallow.
    for (const [css, selector] of [
      [componentsCss, ".row"],
      [componentsCss, ".breadcrumb"],
      [componentsCss, ".share-scrim"],
      [booksO4Css, '[data-design="o4"] .books-card'],
    ] as const) {
      const body =
        selector === ".row" ? rowRuleBody(css) : cssRule(css, selector);
      expect(body, `${selector} unexpectedly declares .name-input`).not.toMatch(
        /name-input/
      );
    }
  });
});
