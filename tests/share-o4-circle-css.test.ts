import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHARE_SETTLED, type ShareSettled } from "@/hooks/share-progress";

/**
 * The O4 share circle's colours and rings (#947, D14 to D16), read from the
 * SOURCE stylesheet as declaration values per selector, never as a bare
 * token found anywhere in the file (AGENTS.md's share-progress vs
 * touch-policy trap): comments are stripped first, and every assertion names
 * the selector whose declaration it reads.
 *
 * What this cannot prove: the cascade. That the O4 rule wins in a browser is
 * the build's and the phone's to show (tests/o4-cascade.test.ts reads the
 * built bundle; the device check is #974).
 */

const CSS = readFileSync(
  path.join(process.cwd(), "src/app/styles/o4/share.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  readonly selectors: readonly string[];
  readonly decls: ReadonlyMap<string, string>;
}

/** Every innermost `selector { decls }` block, with the `@layer` wrapper skipped. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const decls = new Map<string, string>();
    for (const d of m[2]!.split(";")) {
      const at = d.indexOf(":");
      if (at > -1) decls.set(d.slice(0, at).trim(), d.slice(at + 1).trim());
    }
    out.push({ selectors, decls });
  }
  return out;
}

const RULES = rules(CSS);

/** The value `prop` gets from the rule naming exactly `selector`, if any. */
function valueFor(selector: string, prop: string): string | undefined {
  const hits = RULES.filter(
    (r) => r.selectors.includes(selector) && r.decls.has(prop)
  );
  expect(
    hits.length,
    `more than one rule sets ${prop} on ${selector}`
  ).toBeLessThanOrEqual(1);
  return hits[0]?.decls.get(prop);
}

const O4 = '[data-design="o4"]';
const outcome = (s: ShareSettled | "busy", part: string) =>
  `${O4} .share-scrim[data-outcome="${s}"] ${part}`;

/** D16's table, plus D14 (sent) and D15 (busy), as core / glyph ink. */
const CORE: Record<ShareSettled | "busy", readonly [string, string]> = {
  busy: ["--s-send", "--s-tile-ink"],
  sent: ["--s-send", "--s-tile-ink"],
  partial: ["--s-send", "--s-tile-ink"],
  nothing: ["--s-live", "--s-live-ink"],
  failed: ["--s-live", "--s-live-ink"],
  encoder: ["--s-live", "--s-live-ink"],
  dismissed: ["--s-well", "--s-ink-muted"],
  unproven: ["--s-well", "--s-ink-muted"],
};

describe("O4 share circle stylesheet (#947)", () => {
  it("has rules, and scopes every one of them under the O4 switch", () => {
    // A floor, so a parse that finds nothing cannot pass the loop below.
    expect(RULES.length).toBeGreaterThanOrEqual(10);
    for (const rule of RULES)
      for (const selector of rule.selectors)
        expect(selector, `unscoped selector: ${selector}`).toMatch(
          /^\[data-design="o4"\] /
        );
  });

  it("colours only through layer-2 roles", () => {
    let seen = 0;
    for (const rule of RULES)
      for (const value of rule.decls.values())
        for (const m of value.matchAll(/var\((--[\w-]+)\)/g)) {
          seen++;
          expect(m[1], `reaches past layer 2: ${value}`).toMatch(/^--s-/);
        }
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it("the resting core is the send core with white ink (D14, D15)", () => {
    expect(valueFor(`${O4} .share-o4-core`, "background")).toBe(
      "var(--s-send)"
    );
    expect(valueFor(`${O4} .share-o4-glyph`, "color")).toBe(
      "var(--s-tile-ink)"
    );
  });

  it("every outcome's core and glyph ink follow D16's table", () => {
    const [restCore, restInk] = CORE.busy;
    for (const s of [...SHARE_SETTLED, "busy" as const]) {
      const [core, ink] = CORE[s];
      const coreRule = valueFor(outcome(s, ".share-o4-core"), "background");
      const inkRule = valueFor(outcome(s, ".share-o4-glyph"), "color");
      // Outcomes that share the resting look carry no override at all, so
      // the resting rule is what they get.
      expect(coreRule ?? `var(${restCore})`, s).toBe(`var(${core})`);
      expect(inkRule ?? `var(${restInk})`, s).toBe(`var(${ink})`);
    }
  });

  it("handed over wears the full send ring (D14); partial the 3px warn ring (D16); nothing else a ring", () => {
    const ring = (s: ShareSettled | "busy") =>
      valueFor(outcome(s, ".share-o4-frame"), "box-shadow");
    expect(ring("sent")).toBe("inset 0 0 0 7px var(--s-send-ring)");
    expect(ring("partial")).toBe("inset 0 0 0 3px var(--s-warn)");
    for (const s of [...SHARE_SETTLED, "busy" as const])
      if (s !== "sent" && s !== "partial")
        expect(ring(s), `${s} should draw no ring`).toBeUndefined();
    expect(valueFor(`${O4} .share-o4-frame`, "box-shadow")).toBeUndefined();
  });

  it("keeps the workbench geometry: 140 core in a 176 frame, ring starting at twelve o'clock", () => {
    for (const prop of ["width", "height"]) {
      expect(valueFor(`${O4} .share-o4-frame`, prop), prop).toBe("176px");
      expect(valueFor(`${O4} .share-o4-core`, prop), prop).toBe("140px");
    }
    expect(valueFor(`${O4} .share-o4-ring`, "transform")).toBe(
      "rotate(-90deg)"
    );
  });

  it("the progress ring fills in the send-ring colour over a well track", () => {
    expect(valueFor(`${O4} .share-o4-track`, "stroke")).toBe("var(--s-well)");
    expect(valueFor(`${O4} .share-o4-fill`, "stroke")).toBe(
      "var(--s-send-ring)"
    );
  });

  it("chips: 38px circles in the workbench's wrapping row (D21)", () => {
    const chip = `${O4} .share-o4-chip`;
    expect(valueFor(chip, "width")).toBe("38px");
    expect(valueFor(chip, "height")).toBe("38px");
    expect(valueFor(chip, "border-radius")).toBe("50%");
    expect(valueFor(`${O4} .share-o4-chips`, "flex-wrap")).toBe("wrap");
    expect(valueFor(`${O4} .share-o4-chips`, "gap")).toBe("10px");
  });

  it("a waiting chip draws exactly as a chip that stays: no rule names either state (Q1, vShare)", () => {
    // The workbench's vShare gives a waiting go-out chip `cls = ''` while
    // packing, the same bare span as an item that stays. So no selector in
    // this sheet may single out either state, for ANY property: both get the
    // base chip rule and nothing else.
    const named = RULES.flatMap((r) => r.selectors).filter((s) =>
      /data-chip="(waiting|stays)"/.test(s)
    );
    expect(named).toEqual([]);
    // A floor, so a parse that finds no chip rule at all cannot pass above.
    expect(
      RULES.filter((r) => r.selectors.includes(`${O4} .share-o4-chip`))
    ).toHaveLength(1);
  });

  it("chips: grey with faint ink unless finished (send, white ink) or current (amber) (D21 as corrected)", () => {
    const chip = `${O4} .share-o4-chip`;
    // The base chip: an item that does not go out, and, while packing, a
    // go-out item still waiting (the workbench's vShare gives both no class).
    expect(valueFor(chip, "background")).toBe("var(--s-well)");
    expect(valueFor(chip, "color")).toBe("var(--s-ink-faint)");
    expect(valueFor(`${chip}[data-chip="finished"]`, "background")).toBe(
      "var(--s-send)"
    );
    expect(valueFor(`${chip}[data-chip="finished"]`, "color")).toBe(
      "var(--s-tile-ink)"
    );
    for (const state of ["waiting", "stays"]) {
      expect(
        valueFor(`${chip}[data-chip="${state}"]`, "background"),
        state
      ).toBeUndefined();
      expect(
        valueFor(`${chip}[data-chip="${state}"]`, "color"),
        state
      ).toBeUndefined();
    }
    expect(valueFor(`${chip}[data-chip="current"]`, "background")).toBe(
      "var(--s-voice)"
    );
    expect(valueFor(`${chip}[data-chip="current"]`, "color")).toBe(
      "var(--s-voice-ink)"
    );
  });
});

describe("a long book's chip row is bounded and scrolls (DRI pick (a) on #1023)", () => {
  const chips = `${O4} .share-o4-chips`;

  it("caps the row at three rows of chips and scrolls inside it", () => {
    // Three 38px rows and the two 10px gaps between them.
    expect(valueFor(chips, "max-height")).toBe("134px");
    expect(valueFor(chips, "overflow-y")).toBe("auto");
    // The offset parent of each chip, so the hook's offsetTop is row-relative.
    expect(valueFor(chips, "position")).toBe("relative");
  });

  it("gives up height before the circle or the status line does", () => {
    // The panel never grows past the scrim; inside it only the chip row
    // shrinks (min-height 0), while the frame and the text keep their size.
    expect(valueFor(`${O4} .share-progress`, "max-height")).toBe("100%");
    expect(valueFor(chips, "min-height")).toBe("0");
    expect(valueFor(chips, "flex")).toBe("0 1 auto");
    expect(valueFor(`${O4} .share-o4-frame`, "flex")).toBe("none");
    expect(valueFor(`${O4} .share-progress-text`, "flex")).toBe("none");
  });

  it("smooth-scrolls only when reduced motion is not asked for", () => {
    const smooth = RULES.filter(
      (r) => r.decls.get("scroll-behavior") === "smooth"
    );
    expect(smooth).toHaveLength(1);
    expect(smooth[0]!.selectors).toEqual([chips]);
    const media = CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{([^{}]*\{[^{}]*\})\s*\}/
    );
    expect(media, "no no-preference media block").not.toBeNull();
    expect(media![1]).toMatch(/scroll-behavior:\s*smooth/);
    // Outside that block, nothing sets a scroll behaviour at all. The
    // lookbehind keeps `overscroll-behavior` from matching.
    expect(CSS.replace(media![0], "")).not.toMatch(/(?<![\w-])scroll-behavior/);
  });
});
