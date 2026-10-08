import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { O4Crumbs, O4SheetHead } from "@/components/o4-crumbs";
import { strings } from "@/lib/strings";
import { render } from "./render";
import { cssRule, declarationValue } from "./support";

/**
 * #1269: the requirements owner's decision, "Yes, make the header crumbs
 * tappable for navigation". A crumb that names a place above the current
 * screen is a button named for where it goes; the crumb for the current
 * place is not a button and carries `aria-current`. The menu sheet heads
 * (`O4SheetHead`) stay decoration.
 *
 * This file is the props-to-markup half, through the static render harness.
 * Which handler each header hands a crumb, and that a tap runs the header's
 * own Back path, is `tests/o4-header-crumbs.test.ts`; the tap landing on the
 * right screen in the shipped build is `e2e/header-crumbs-fit.spec.ts`.
 */

const noop = () => {};
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");
const O4 = ":root";

describe("O4Crumbs with links (#1269)", () => {
  it("renders a linked book crumb as a button named for its destination", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Naomi returns",
        links: { book: { label: strings.goToBook("Ruth"), onClick: noop } },
        current: "chapter",
      })
    );
    const chips = [...root.querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["BUTTON", "SPAN"]);
    const book = chips[0]!;
    expect(book.getAttribute("type")).toBe("button");
    expect(book.getAttribute("aria-label")).toBe("Go to book Ruth");
    // The name the chip shows sits inside the spoken name (WCAG 2.5.3), and
    // keeps #1267's direction on its own text element.
    expect(book.textContent).toBe("Ruth");
    expect(book.querySelector(":scope > span")?.getAttribute("dir")).toBe(
      "auto"
    );
    expect(book.hasAttribute("disabled")).toBe(false);
  });

  it("marks the current crumb with aria-current and does not make it a button", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Naomi returns",
        links: { book: { label: strings.goToBook("Ruth"), onClick: noop } },
        current: "chapter",
      })
    );
    const chapter = root.querySelectorAll(".o4-crumb")[1]!;
    expect(chapter.tagName).toBe("SPAN");
    expect(chapter.getAttribute("aria-current")).toBe("page");
    expect(chapter.closest("button")).toBeNull();
    expect(root.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("links the chapter crumb and marks the segment crumb current, as the recorder does", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Chapter 2",
        segment: { ordinal: 3, state: "recorded" },
        links: {
          chapter: {
            label: strings.goToChapter("Chapter 2"),
            onClick: noop,
          },
        },
        current: "segment",
      })
    );
    const chips = [...root.querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["SPAN", "BUTTON", "SPAN"]);
    // "Go to {heading}" (DRI pick on #1274): the chip's own heading, with
    // no second "chapter" in front of a default "Chapter N".
    expect(chips[1]!.getAttribute("aria-label")).toBe("Go to Chapter 2");
    expect(chips[2]!.getAttribute("aria-current")).toBe("page");
    expect(chips[2]!.getAttribute("data-state")).toBe("recorded");
  });

  it("links both the book and the chapter crumb and keeps aria-current on the segment alone, as the recorder does (#1275)", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Chapter 2",
        segment: { ordinal: 3, state: "recorded" },
        links: {
          book: { label: strings.goToBook("Ruth"), onClick: noop },
          chapter: { label: strings.goToChapter("Chapter 2"), onClick: noop },
        },
        current: "segment",
      })
    );
    const chips = [...root.querySelectorAll(".o4-crumb")];
    expect(chips.map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "SPAN"]);
    expect(chips[0]!.getAttribute("aria-label")).toBe("Go to book Ruth");
    expect(chips[1]!.getAttribute("aria-label")).toBe("Go to Chapter 2");
    // #1278's note on #1274: a crumb that gets a link must not be the one
    // that was current. Here neither linked crumb is, and the current
    // marker stays on the one plain chip.
    expect(root.querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(chips[2]!.getAttribute("aria-current")).toBe("page");
    for (const b of chips.slice(0, 2)) {
      expect(b.hasAttribute("aria-current")).toBe(false);
      expect(b.hasAttribute("disabled")).toBe(false);
    }
  });

  it("disables every linked crumb when the header's Back is disabled", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Chapter 2",
        links: {
          book: { label: strings.goToBook("Ruth"), onClick: noop },
          chapter: { label: strings.goToChapter("Chapter 2"), onClick: noop },
        },
        disabled: true,
      })
    );
    const buttons = [...root.querySelectorAll("button.o4-crumb")];
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.hasAttribute("disabled")).toBe(true);
  });

  it("renders no button and no aria-current without links, as before", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: "Ruth",
        chapter: "Chapter 2",
        segment: { ordinal: 1, state: "empty" },
      })
    );
    expect(root.querySelectorAll("button")).toHaveLength(0);
    expect(root.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});

describe("O4SheetHead stays decoration (#1269)", () => {
  it("has no button and no aria-current in a menu's sheet head", () => {
    const root = render(
      createElement(O4SheetHead, {
        book: "Ruth",
        chapter: "Chapter 2",
        segment: { ordinal: 1, state: "finished" },
      })
    );
    expect(root.querySelectorAll("button")).toHaveLength(0);
    expect(root.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});

describe("o4/menus.css, a linked crumb's hit area (#1269)", () => {
  const css = read("src/app/styles/o4/menus.css");

  it("is a control-sized 44px target while the chip is still drawn 40px tall", () => {
    // The chip shape moves to a pseudo-element inset by 2px top and bottom,
    // because a clip-path on the button itself would clip its hit area too.
    const button = cssRule(css, `${O4} button.o4-crumb`);
    expect(declarationValue(button, "height")).toBe("var(--c-control-md)");
    expect(declarationValue(button, "clip-path")).toBe("none");
    expect(declarationValue(button, "background")).toBe("transparent");
    const chip = cssRule(css, `${O4} button.o4-crumb::before`);
    expect(declarationValue(chip, "inset")).toBe("2px 0");
    expect(declarationValue(chip, "background")).toBe("var(--s-well)");
    // The same chevron the plain chip draws: both read one shape property,
    // which the first chip overrides for its flat left end, so the
    // pseudo-element inherits whichever shape its button has.
    const shape = "var(--o4-crumb-shape)";
    expect(declarationValue(chip, "clip-path")).toBe(shape);
    expect(declarationValue(cssRule(css, `${O4} .o4-crumb`), "clip-path")).toBe(
      shape
    );
    const first = cssRule(css, `${O4} .o4-crumb:first-child`);
    expect(declarationValue(first, "--o4-crumb-shape")).toMatch(/^polygon\(/);
    expect(() => declarationValue(first, "clip-path")).toThrow();
  });
});
