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

  it("the progress ring fills in the send-ring colour over a well track", () => {
    expect(valueFor(`${O4} .share-o4-track`, "stroke")).toBe("var(--s-well)");
    expect(valueFor(`${O4} .share-o4-fill`, "stroke")).toBe(
      "var(--s-send-ring)"
    );
  });

  it("dots: finished filled, skipped hollow in the ring's colour, waiting empty (D13)", () => {
    const dot = `${O4} .share-o4-dot`;
    expect(valueFor(dot, "background")).toBe("var(--s-mark-empty)");
    expect(valueFor(`${dot}[data-dot="filled"]`, "background")).toBe(
      "var(--s-send-ring)"
    );
    expect(valueFor(`${dot}[data-dot="hollow"]`, "background")).toBe(
      "transparent"
    );
    expect(valueFor(`${dot}[data-dot="hollow"]`, "border")).toBe(
      "2px solid var(--s-send-ring)"
    );
  });
});
