import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue } from "./support";

/**
 * The new-look (O4) chapter row with more dots than the room under its title
 * holds (#1229). Every row draws the title line since #1219, so the dots get
 * 19px, which holds three rows at the smallest step (`dotFit` in
 * `books-screen.tsx`). With a fixed-height row and a shrinkable title, a
 * longer chapter squashed the title and clipped dots, so the green share the
 * row showed was wrong.
 *
 * What stops that is three declarations, pinned here as declared values: the
 * title never shrinks, and the row and its middle column have a floor, not a
 * fixed height, so extra dot rows grow the row. Whether the cascade lays that
 * out is `e2e/books-chapter-dots-fit.spec.ts`'s job, against the built app.
 */
const O4 = ":root";
const css = readFileSync(
  path.resolve(import.meta.dirname, "..", "src/app/styles/o4/books.css"),
  "utf8"
);

/** The declaration, or null when the rule does not declare it at all. */
function declared(selector: string, property: string): string | null {
  try {
    return declarationValue(cssRule(css, selector), property);
  } catch (error) {
    if (String(error).includes(`no ${property} declaration`)) return null;
    throw error;
  }
}

describe("the O4 chapter row's room for its dots (#1229)", () => {
  it("never lets the dots shrink the title line", () => {
    expect(declared(`${O4} .books-chapter-title`, "flex")).toBe("none");
    expect(declared(`${O4} .books-chapter-title`, "height")).toBe("20px");
  });

  it("gives the middle column a 44px floor, not a fixed height", () => {
    expect(declared(`${O4} .books-chapter-mid`, "min-height")).toBe("44px");
    expect(declared(`${O4} .books-chapter-mid`, "height")).toBeNull();
    expect(declared(`${O4} .books-chapter-mid`, "max-height")).toBeNull();
  });

  it("gives the row the design's 68px as a floor, 12 + 44 + 12, and lets it grow", () => {
    const row = `${O4} .books-chapter`;
    expect(declared(row, "min-height")).toBe("68px");
    expect(declared(row, "height")).toBeNull();
    expect(declared(row, "max-height")).toBeNull();
    const [top, , bottom] = declared(row, "padding")!.split(" ");
    expect(parseFloat(top!) + 44 + parseFloat(bottom!)).toBe(68);
  });
});
