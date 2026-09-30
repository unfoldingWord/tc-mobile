import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { O4Crumbs, O4SheetHead } from "@/components/o4-crumbs";
import { strings } from "@/lib/strings";
import { render } from "./render";
import { cssRule, declarationValue } from "./support";

/**
 * #1230: the O4 chapter-screen and recorder headers show the chapter's NAME
 * in the chapter chip, elided with "…" when it is too long for the chip.
 * `tests/o4-header-crumbs.test.ts` proves the two headers pass the resolved
 * name; this file proves the chip renders whatever text it is given, and pins
 * the declarations that make a long name elide and share the row with the
 * book chip. Whether those declarations produce the intended boxes is a
 * layout question the static render cannot answer; the Playwright spec
 * `e2e/header-crumbs-fit.spec.ts` measures it against the shipped build.
 */

const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");
const O4 = '[data-design="o4"]';

describe("O4Crumbs' chapter chip (#1230)", () => {
  it("renders a chapter name as the chip's text", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Book Mine",
        chapter: "The sower and the seed",
      })
    );
    const chips = [...root.querySelectorAll(".o4-crumb > span")].map(
      (el) => el.textContent
    );
    expect(chips).toEqual(["Book Mine", "The sower and the seed"]);
  });

  it("still renders a bare number as the chip's text", () => {
    const root = render(createElement(O4Crumbs, { book: "B", chapter: 3 }));
    const chips = [...root.querySelectorAll(".o4-crumb > span")].map(
      (el) => el.textContent
    );
    expect(chips).toEqual(["B", "3"]);
  });
});

describe("O4SheetHead's spoken place (#1230, the DRI's 'Names in menus too')", () => {
  const places = (root: Element) =>
    [...root.querySelectorAll(".o4-sheet-place")].map((el) => ({
      text: el.textContent,
      hidden: el.closest('[aria-hidden="true"]') !== null,
      srOnly: el.classList.contains("sr-only"),
    }));

  it("names the book and the chapter's name for a chapter menu, outside the hidden chips", () => {
    const root = render(
      createElement(O4SheetHead, { book: "Ruth", chapter: "Naomi returns" })
    );
    expect(
      root.querySelector(".o4-sheet-head")!.getAttribute("aria-hidden")
    ).toBe("true");
    expect(places(root)).toEqual([
      {
        text: strings.chapterBreadcrumb("Ruth", "Naomi returns"),
        hidden: false,
        srOnly: true,
      },
    ]);
  });

  it("adds the segment for a segment or recorder menu", () => {
    const root = render(
      createElement(O4SheetHead, {
        book: "Ruth",
        chapter: "Chapter 2",
        segment: { ordinal: 3, state: "recorded" },
      })
    );
    expect(places(root).map((p) => p.text)).toEqual([
      strings.recorderBreadcrumb("Ruth", "Chapter 2", 3, null),
    ]);
  });

  it("draws no place line when the book or the chapter is missing", () => {
    expect(
      places(render(createElement(O4SheetHead, { chapter: "Chapter 2" })))
    ).toEqual([]);
    expect(
      places(render(createElement(O4SheetHead, { book: "Ruth" })))
    ).toEqual([]);
  });
});

describe("o4/menus.css, how the crumbs elide and share the row (#1230)", () => {
  const css = read("src/app/styles/o4/menus.css");

  it("elides each crumb's own text with an ellipsis, on one line", () => {
    const crumb = cssRule(css, `${O4} .o4-crumb`);
    expect(declarationValue(crumb, "white-space")).toBe("nowrap");
    expect(declarationValue(crumb, "min-width")).toBe("0");
    const text = cssRule(css, `${O4} .o4-crumb > span`);
    expect(declarationValue(text, "overflow")).toBe("hidden");
    expect(declarationValue(text, "text-overflow")).toBe("ellipsis");
  });

  it("splits the free width evenly between crumbs, each capped at its own text", () => {
    // Basis 0 and an equal grow: every crumb starts from its padding and
    // takes an equal share of the room left. The max-content cap freezes a
    // crumb whose text already fits, handing the rest of its share to the
    // others, so a short "Chapter 2" stays whole beside a long book name.
    const crumb = cssRule(css, `${O4} .o4-crumb`);
    expect(declarationValue(crumb, "flex")).toBe("1 1 0");
    expect(declarationValue(crumb, "max-width")).toBe("max-content");
  });

  it("never shrinks the segment crumb, a short number carrying the state tint", () => {
    const segment = cssRule(css, `${O4} .o4-crumb[data-state]`);
    expect(declarationValue(segment, "flex")).toBe("none");
  });
});
