import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Icon } from "../src/components/icon";

import { one, render } from "./render";
import {
  cssRule,
  declarationValue,
  stripComments,
  stripCssComments,
} from "./support";

/**
 * The right-to-left layout pass (#1552, part of #1458). `dir` is written on the
 * root at runtime and `ar` is `rtl`, so what is left is the stylesheet: a
 * physical `left` / `right` pins a control to one edge in every language.
 *
 * Two halves, both source reads (no cascade, no layout; the browser half is
 * `e2e/rtl-mirror.spec.ts`):
 *  1. each converted rule is read through `cssRule` / `declarationValue` and
 *     must carry the logical property, and no physical twin;
 *  2. a sweep over every stylesheet and TSX file in `src/` finds each remaining
 *     physical declaration and requires it on `KEPT_PHYSICAL` with a reason. An
 *     allowlist entry that no longer matches anything fails too, so the list
 *     cannot go stale.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const COMPONENTS = "src/app/styles/3-components.css";
const MENUS = "src/app/styles/o4/menus.css";
const RECORDER = "src/app/styles/o4/recorder.css";
const BOOKS = "src/app/styles/o4/books.css";

describe("converted rules read logically", () => {
  const cases: Array<{
    file: string;
    selector: string;
    logical: Record<string, string>;
    gone: string[];
  }> = [
    {
      file: MENUS,
      selector: ":root .o4-crumb",
      logical: {
        "margin-inline-start": "-6px",
        "padding-inline": "24px 20px",
      },
      gone: ["margin-left", "padding"],
    },
    {
      file: MENUS,
      selector: ":root .o4-crumb:first-child",
      logical: {
        "margin-inline-start": "0",
        "padding-inline-start": "12px",
        "border-start-start-radius": "10px",
        "border-end-start-radius": "10px",
      },
      gone: ["margin-left", "padding-left", "border-radius"],
    },
    {
      file: MENUS,
      selector: ":root .o4-menu-preview",
      logical: { "padding-inline": "10px 8px" },
      gone: ["padding"],
    },
    {
      file: RECORDER,
      selector: ":root .recorder-status",
      logical: { "inset-inline-start": "18px" },
      gone: ["left"],
    },
    {
      file: RECORDER,
      selector: ":root .recorder-stamp",
      logical: { "inset-inline-end": "18px" },
      gone: ["right"],
    },
    {
      file: RECORDER,
      selector: ":root .recorder-editing",
      logical: { "inset-inline-end": "18px" },
      gone: ["right"],
    },
    {
      file: COMPONENTS,
      selector: ".control-hint",
      logical: { "inset-inline-end": "-2px" },
      gone: ["right"],
    },
    {
      file: COMPONENTS,
      selector: ".menu-panel",
      logical: { "border-inline-start": "1px solid var(--s-edge)" },
      gone: ["border-left"],
    },
    {
      file: COMPONENTS,
      selector: ".recorder-status",
      logical: { "inset-inline-start": "var(--p-space-3)" },
      gone: ["left"],
    },
    {
      file: COMPONENTS,
      selector: ".recorder-editing",
      logical: { "inset-inline-end": "var(--p-space-3)" },
      gone: ["right"],
    },
    {
      file: BOOKS,
      selector: ":root .books-header",
      logical: { "padding-inline": "10px 12px" },
      gone: ["padding"],
    },
    {
      file: BOOKS,
      selector: ":root .books-card-hit",
      logical: { "text-align": "start" },
      gone: [],
    },
    {
      file: BOOKS,
      selector: ":root .books-chapter",
      logical: { "text-align": "start", "padding-inline": "12px 16px" },
      gone: ["padding"],
    },
    {
      file: BOOKS,
      selector: ":root .books-cover::before",
      logical: { "inset-inline-start": "0" },
      gone: ["inset"],
    },
    {
      file: "src/app/styles/o4/dialogs.css",
      selector: ":root .confirm-preview",
      logical: { "padding-inline": "14px 10px" },
      gone: ["padding"],
    },
    {
      file: "src/app/styles/o4/segments.css",
      selector: ":root .row",
      logical: { "padding-inline": "10px 6px" },
      gone: ["padding"],
    },
  ];

  for (const c of cases) {
    it(`${c.selector} (${path.basename(c.file)})`, () => {
      const body = cssRule(read(c.file), c.selector);
      for (const [prop, value] of Object.entries(c.logical)) {
        expect(declarationValue(body, prop)).toBe(value);
      }
      // The physical twin must not be declared beside the logical one.
      for (const prop of c.gone) {
        expect(() => declarationValue(body, prop)).toThrow();
      }
    });
  }

  it("mirrors the crumb chevron under dir=rtl", () => {
    const css = read(MENUS);
    const base = cssRule(css, ':root[dir="rtl"] .o4-crumb');
    const first = cssRule(css, ':root[dir="rtl"] .o4-crumb:first-child');
    // The tip points at the end edge in both directions: at rtl the polygon's
    // tip is on the left (x = 0).
    expect(declarationValue(base, "--o4-crumb-shape")).toMatch(/0 50%/);
    expect(declarationValue(first, "--o4-crumb-shape")).toMatch(/0 50%/);
  });

  it("flips a direction-bearing glyph only at rtl", () => {
    const rule = cssRule(
      read(COMPONENTS),
      ':root[dir="rtl"] svg[data-rtl-mirror]'
    );
    expect(declarationValue(rule, "transform")).toBe("scaleX(-1)");
  });

  it("marks the back arrow and the chapter chevron, and not the play triangle", () => {
    const mirrored = (name: Parameters<typeof Icon>[0]["name"]) =>
      one(render(createElement(Icon, { name })), "svg").hasAttribute(
        "data-rtl-mirror"
      );
    expect(mirrored("back")).toBe(true);
    expect(mirrored("chevron-right")).toBe(true);
    expect(mirrored("play")).toBe(false);
  });
});

/**
 * Physical declarations that stay, each with the reason. `needle` is a
 * substring of the declaration's text, scoped to one file. Time runs left to
 * right in every locale, so the waveform and its scrub position are LTR on
 * purpose.
 */
const KEPT_PHYSICAL: Array<{ file: string; needle: string; reason: string }> = [
  {
    file: "src/app/globals.css",
    needle: "env(safe-area-inset-right)",
    reason: "safe-area insets name physical device edges, so they pair 1:1",
  },
  {
    file: RECORDER,
    needle: "left: 0;",
    reason: "selection-handle knob sits on the trim handle: time axis, LTR",
  },
  {
    file: RECORDER,
    needle: "left: clamp(",
    reason: "cut anchor follows the selection midpoint on the time axis",
  },
  {
    file: COMPONENTS,
    needle: "margin-left: -6px;",
    reason: "scrub dot is centred on its left-to-right time offset",
  },
  {
    file: COMPONENTS,
    needle: "transform-origin: left center;",
    reason: "level meter fill grows from the low end of a gauge, not text",
  },
  {
    file: "src/app/styles/o4/segments.css",
    needle: "to right,",
    reason: "played-region mask follows playback time, left to right",
  },
  {
    file: "src/components/centerline-overlay.tsx",
    needle: "left: `",
    reason: "the centerline is a fraction of the time axis",
  },
  {
    file: "src/components/selection-overlay.tsx",
    needle: "left: ",
    reason: "trim handles and selection band are positions on the time axis",
  },
  {
    file: "src/components/segment-row.tsx",
    needle: "left: `",
    reason: "the row's scrub position is a fraction of the clip's time",
  },
];

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(
    (e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(rel);
      return /\.(css|tsx)$/.test(e.name) ? [rel] : [];
    }
  );
}

/** Declarations (CSS) or style/class fragments (TSX) that pin one physical side. */
const PHYSICAL_CSS = [
  /(?<=^|[;{\s])(left|right)\s*:[^;]*;?/g,
  /(margin|padding)-(left|right)\s*:[^;]*;?/g,
  /border-(left|right)(-\w+)?\s*:[^;]*;?/g,
  /text-align\s*:\s*(left|right)\s*;?/g,
  /transform-origin\s*:\s*(left|right)[^;]*;?/g,
  /\bto (left|right),?/g,
  // 4-value shorthands with a left that differs from the right.
  /(?<=^|[;{\s])(padding|margin)[ \t]*:[ \t]*([^\s;]+)[ \t]+([^\s;]+)[ \t]+([^\s;]+)[ \t]+([^\s;]+)[ \t]*;/g,
  /(?<=^|[;{\s])inset[ \t]*:[ \t]*[^\s;]+[ \t]+[^\s;]+[ \t]+[^\s;]+[ \t]+[^\s;]+[ \t]*;/g,
  /(?<=^|[;{\s])border-radius[ \t]*:[ \t]*[^\s;]+[ \t]+[^\s;]+[ \t]+[^\s;]+([ \t]+[^\s;]+)?[ \t]*;/g,
];
const PHYSICAL_TSX = [
  /(?<![\w-])(left|right)\s*:\s*[^,}\n]*/g,
  /\b(text-left|text-right|float-left|float-right)\b/g,
  /(?<![\w:-])-?(ml|mr|pl|pr|left|right)-(\d|\[)/g,
  /\b(rounded-[lr]|rounded-[tb][lr]|border-[lr])(-|\b)/g,
];

function physicalHits(file: string): string[] {
  const src = read(file);
  const isCss = file.endsWith(".css");
  // One line per file: prettier wraps a long shorthand across lines, and a
  // wrapped declaration must not slip past a line-bound pattern.
  const text = (isCss ? stripCssComments(src) : stripComments(src)).replace(
    /\s+/g,
    " "
  );
  const out: string[] = [];
  for (const re of isCss ? PHYSICAL_CSS : PHYSICAL_TSX) {
    for (const m of text.matchAll(re)) {
      const hit = m[0].trim();
      if (isCss && /^(padding|margin)\s*:/.test(hit)) {
        // Only an asymmetric 4-value shorthand pins a side.
        const [, , , , l] = m;
        const parts = hit.replace(/;$/, "").split(":")[1]!.trim().split(/\s+/);
        if (parts[1] === parts[3] || l === undefined) continue;
      }
      if (isCss && /^border-radius\s*:/.test(hit)) {
        const parts = hit.replace(/;$/, "").split(":")[1]!.trim().split(/\s+/);
        // 3 values: top-left, top-right+bottom-left, bottom-right; 4: all four.
        const [tl, tr, br, bl = tr] = parts;
        if (tl === tr && tr === br && br === bl) continue;
      }
      out.push(hit);
    }
  }
  return out;
}

describe("every remaining physical left/right is on the allowlist", () => {
  const files = [...walk("src/app"), ...walk("src/components")];

  it("has a non-empty sweep", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => f.endsWith(".css")).length).toBeGreaterThan(5);
  });

  it("finds nothing outside KEPT_PHYSICAL", () => {
    const unlisted: string[] = [];
    for (const file of files) {
      for (const hit of physicalHits(file)) {
        const listed = KEPT_PHYSICAL.some(
          (k) => k.file === file && hit.includes(k.needle)
        );
        if (!listed) unlisted.push(`${file}: ${hit}`);
      }
    }
    expect(unlisted).toEqual([]);
  });

  it("has no allowlist entry that matches nothing", () => {
    for (const k of KEPT_PHYSICAL) {
      expect(k.reason.length).toBeGreaterThan(10);
      const hits = physicalHits(k.file);
      expect(
        hits.some((h) => h.includes(k.needle)),
        `${k.file}: ${k.needle}`
      ).toBe(true);
    }
  });
});
