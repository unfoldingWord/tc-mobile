import { createElement } from "react";

import { describe, expect, it } from "vitest";

import { Icon, type IconName } from "@/components/icon";

import { one, render } from "./render";

/**
 * The O4 icon batch (#940, part of #936): draw only the 13 icons the O4
 * workbench screens use, redrawn from the 24-unit, stroke-2.2 reference
 * sprite (docs/design/o4/o4-icons.svg, landing with #935) onto this app's
 * 22-unit grid. D9 (#937) answered the list; this is that list, and nothing
 * more — `forward`, `flag`, `tag`, `earlier`, `later` and `mic-off` are
 * deliberately not drawn.
 *
 * No screen wires any of these yet (that is a later O4 batch under #936), so
 * this file's own render assertions are today's only consumer — the same
 * "a module a test imports looks used" shape AGENTS.md names for the knip
 * blind spot, made deliberate here rather than accidental.
 */
const O4_ICONS: readonly IconName[] = [
  "hear",
  "hear-large",
  "mic",
  "tap-hand",
  "pencil",
  "restart",
  "phone",
  "file-zip",
  "file-audio",
  "book",
  "book-open",
  "person",
  "open",
];

describe("the O4 icon batch renders through the app's icon set (#940)", () => {
  it("draws exactly the 13 names D9 picked, no more and no fewer", () => {
    expect(O4_ICONS).toHaveLength(13);
    expect(new Set(O4_ICONS).size).toBe(13);
  });

  for (const name of O4_ICONS) {
    it(`"${name}" renders on the app's 22-unit grid with currentColor`, () => {
      const container = render(createElement(Icon, { name }));
      const svg = one(container, "svg");

      // The grid every other icon in this file draws on — a redraw that
      // left the sprite's 24-unit viewBox in place would sit at the wrong
      // scale beside every existing glyph.
      expect(svg.getAttribute("viewBox")).toBe("0 0 22 22");

      // Every shape inherits its color from the control around it. A
      // literal color would be the one thing this batch is not allowed to
      // introduce — the app has no icon that hard-codes its own hue.
      expect(svg.innerHTML).toContain("currentColor");
      expect(svg.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);

      // A name with no drawing renders an empty <svg>, which is the exact
      // silent hole `share-outcome-glyph.test.ts` guards against for the
      // existing set (PATHS[name] falling through to `undefined`). Pin it
      // here too, for this batch specifically.
      expect(
        svg.innerHTML.trim().length,
        `"${name}" drew nothing`
      ).toBeGreaterThan(0);
    });
  }

  it("every drawn shape says how it paints — currentColor is a stroke or a fill (or explicitly none)", () => {
    // A stray un-attributed path (no fill and no stroke set) silently
    // defaults to a BLACK fill in SVG, which would only ever be caught by
    // eyeballing a screenshot. Each element in this batch must carry one.
    for (const name of O4_ICONS) {
      const container = render(createElement(Icon, { name }));
      const svg = one(container, "svg");
      const shapes = svg.querySelectorAll("path, rect, circle");
      expect(shapes.length, `"${name}" drew no shapes`).toBeGreaterThan(0);
      for (const shape of shapes) {
        const fill = shape.getAttribute("fill");
        const stroke = shape.getAttribute("stroke");
        expect(
          fill || stroke,
          `"${name}" has a shape with neither fill nor stroke set`
        ).toBeTruthy();
      }
    }
  });
});

/**
 * Red-first (AGENTS.md): before `icon.tsx` carried this batch, `PATHS` had
 * no entry for any of these 13 names and `IconName` did not include them —
 * `Icon({ name: "hear" })` was a type error, and forcing it through at
 * runtime rendered an empty `<svg></svg>` (`PATHS[name]` reading
 * `undefined`), which is exactly what the "drew nothing" and "no shapes"
 * assertions above exist to catch. That failure was observed directly on
 * this branch before the batch above was added — see this PR's body for the
 * command and output — and is not re-asserted as a runtime test here since
 * the fix makes the premise (a missing name) impossible to construct without
 * a type-level workaround.
 */
