import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BuildStamp } from "@/components/build-stamp";

import { render } from "./render";
import { cssRule, declarationValue } from "./support";

/**
 * #1276: a double-tap on an empty segment row started the system text
 * selection, and the handles ran down to the footer build stamp. #559 and
 * #563 opted individual roots out (recorder sheet, menu, `.row`, breadcrumb,
 * `.books-card`); the gaps between them, the list, and the stamp stayed
 * selectable. The opt-out now sits on `.app-shell` and the stamp, with an
 * opt-back-in for real text inputs.
 *
 * Reads go through `cssRule` / `declarationValue`, which strip comments and
 * throw on a missing, ambiguous or empty rule, so a comment cannot satisfy
 * them. The stamp's class is taken from a real render of `BuildStamp`, not
 * from a string in this file. What this cannot show: whether the rules win in
 * the built cascade, or whether a phone suppresses selection.
 */
const componentsCss = readFileSync(
  path.resolve(import.meta.dirname, "..", "src/app/styles/3-components.css"),
  "utf8"
);

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectOptOut(selector: string): void {
  const body = cssRule(componentsCss, selector);
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

const INPUT_SELECTOR = ".app-shell :is(input, textarea, [contenteditable])";

describe("selection opt-out on the app shell and the build stamp (#1276)", () => {
  it("puts the three opt-out declarations on the `.app-shell` rule", () => {
    expectOptOut(".app-shell");
  });

  it("opts the build stamp out, using the class the component really renders", () => {
    vi.stubGlobal("__APP_VERSION__", "0.0.0");
    vi.stubGlobal("__BUILD_SHA__", "abc1234");
    const stamp = render(createElement(BuildStamp)).querySelector("footer");
    expect(stamp?.className).toBe("build-stamp");
    expectOptOut(`.${stamp?.className}`);
  });

  it("opts text inputs back in, so a field stays selectable and editable", () => {
    const body = cssRule(componentsCss, INPUT_SELECTOR);
    expect(declarationValue(body, "-webkit-user-select")).toBe("text");
    expect(declarationValue(body, "user-select")).toBe("text");
    expect(declarationValue(body, "-webkit-touch-callout")).toBe("default");
  });

  it("keeps the rename field's own opt-back-in", () => {
    const body = cssRule(componentsCss, ".name-input");
    expect(declarationValue(body, "user-select")).toBe("text");
    expect(declarationValue(body, "-webkit-touch-callout")).toBe("default");
  });
});
