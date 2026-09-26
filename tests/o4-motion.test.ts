import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * O4 ambient motion (#950, epic #936): `src/app/styles/o4/motion.css`.
 *
 * Read as a tree of blocks rather than as a raw string, with block comments
 * stripped first, so prose that names a selector or a keyframe cannot be the
 * match (AGENTS.md, the #529 trap). `tests/o4-area-css.ts` is not reused: it
 * is flat by design and cannot see an `@keyframes` or an `@media` block, which
 * are exactly what this file is made of.
 *
 * The gate: every rule that sets an animation under the switch is matched,
 * selector for selector, by an `animation: none` rule inside the file's
 * `prefers-reduced-motion: reduce` block, and that rule comes later in the
 * same layer at equal specificity, so it wins. The app has no in-app
 * "Remove animations" setting to guard as well (see the stylesheet's header).
 *
 * What this cannot show: that a browser runs the loops, or stops them. That
 * is a cascade in a real engine, and nothing here renders one.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS = stripComments(
  readFileSync(path.join(ROOT, "src/app/styles/o4/motion.css"), "utf8")
);
const O4 = '[data-design="o4"]';
const REDUCE = "@media (prefers-reduced-motion: reduce)";

interface Block {
  /** The selector list or at-rule prelude, whitespace collapsed. */
  readonly prelude: string;
  /** Declarations, when the block holds any. */
  readonly decls: ReadonlyMap<string, string>;
  readonly children: readonly Block[];
  /** Source position of the block's opening brace, for ordering. */
  readonly at: number;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function parse(text: string, from = 0, to = text.length): Block[] {
  const out: Block[] = [];
  let i = from;
  while (i < to) {
    const open = text.indexOf("{", i);
    if (open === -1 || open >= to) break;
    let depth = 0;
    let close = open;
    for (; close < to; close++) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}" && --depth === 0) break;
    }
    const prelude = squash(text.slice(i, open).split(/[;}]/).pop() ?? "");
    const inner = text.slice(open + 1, close);
    const children = inner.includes("{") ? parse(text, open + 1, close) : [];
    const decls = new Map<string, string>();
    if (children.length === 0)
      for (const d of inner.split(";")) {
        const colon = d.indexOf(":");
        if (colon > 0)
          decls.set(d.slice(0, colon).trim(), squash(d.slice(colon + 1)));
      }
    out.push({ prelude, decls, children, at: open });
    i = close + 1;
  }
  return out;
}

const TREE = parse(CSS);
const LAYER = TREE.find((b) => b.prelude === "@layer components");
const TOP = LAYER?.children ?? [];

const keyframes = new Map(
  TOP.filter((b) => b.prelude.startsWith("@keyframes ")).map((b) => [
    b.prelude.slice("@keyframes ".length),
    b,
  ])
);
/** Style rules outside any at-rule. */
const styleRules = TOP.filter((b) => !b.prelude.startsWith("@"));
const selectorsOf = (b: Block) => b.prelude.split(",").map(squash);
/** The rules that start an animation (anything but `animation: none`). */
const animated = styleRules.filter((b) => {
  const a = b.decls.get("animation");
  return a !== undefined && a !== "none";
});
const guards = TOP.filter((b) => b.prelude === REDUCE);
const guardRules = guards.flatMap((g) => g.children);

/** The keyframe name an `animation` shorthand names. */
function animationName(value: string): string {
  return value.split(" ")[0] ?? "";
}

describe("o4/motion.css is read as a tree, not as a string (#950)", () => {
  it("parses one @layer components block with the loops and a guard inside", () => {
    expect(LAYER).toBeDefined();
    // Floors: a parse that finds nothing must fail here, not pass the loops
    // below by iterating over an empty list.
    expect(keyframes.size).toBeGreaterThanOrEqual(3);
    expect(animated.length).toBeGreaterThanOrEqual(3);
    expect(guards).toHaveLength(1);
    expect(guardRules.length).toBeGreaterThanOrEqual(1);
  });
});

describe("every O4 loop is scoped under the switch (#950)", () => {
  it("opens every style rule, guards included, with [data-design=o4]", () => {
    const all = [...styleRules, ...guardRules].flatMap(selectorsOf);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const sel of all) expect(sel.startsWith(`${O4} `)).toBe(true);
  });

  it("runs only keyframes this file defines, and defines none it does not run", () => {
    const used = new Set(
      animated.map((b) => animationName(b.decls.get("animation")!))
    );
    expect([...used].sort()).toEqual([...keyframes.keys()].sort());
  });

  it.each([
    [
      "guidePulse",
      [`${O4} .control--record.is-guided`, `${O4} .record-guide.is-guided`],
      "guidePulse var(--p-ambient-guide-pulse, 1.8s) ease-in-out infinite",
    ],
    [
      "liveEdge",
      [`${O4} .recorder-stage[data-o4-look="recording"]::after`],
      "liveEdge var(--p-ambient-live-edge, 1.2s) ease-in-out infinite",
    ],
    [
      "blink",
      [`${O4} .recorder-status .rec-dot`],
      "blink var(--p-ambient-blink, 1s) steps(2) infinite",
    ],
  ])("pins %s to its target and its #967 duration", (name, sels, value) => {
    const hits = animated.filter(
      (b) => animationName(b.decls.get("animation")!) === name
    );
    expect(hits).toHaveLength(1);
    expect(selectorsOf(hits[0]!)).toEqual(sels);
    expect(hits[0]!.decls.get("animation")).toBe(value);
  });

  it("colours every keyframe through layer-2 roles only", () => {
    for (const [, block] of keyframes) {
      expect(block.children.length).toBeGreaterThanOrEqual(2);
      for (const step of block.children)
        for (const [, v] of step.decls) {
          expect(v).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
          expect(v).not.toMatch(/var\(--(p|c)-/);
        }
    }
  });
});

describe("every O4 loop is off under reduced motion (#950)", () => {
  it("matches each animated selector with a later animation:none in the guard", () => {
    const guarded = new Map<string, number>();
    for (const r of guardRules)
      if (r.decls.get("animation") === "none")
        for (const sel of selectorsOf(r)) guarded.set(sel, r.at);
    for (const rule of animated)
      for (const sel of selectorsOf(rule)) {
        expect(guarded.has(sel), `${sel} is not in the guard`).toBe(true);
        expect(guarded.get(sel)!).toBeGreaterThan(rule.at);
      }
  });
});

describe("the guide pulse keeps the base ring's own exceptions (#950)", () => {
  // An animation outranks every normal declaration, so the base sheet's
  // `box-shadow: none` on an inert guided mark would lose to the pulse.
  it("stops the pulse on an inert guided mark, after the pulse rule", () => {
    const pulse = animated.find(
      (b) => animationName(b.decls.get("animation")!) === "guidePulse"
    )!;
    const stop = styleRules.find(
      (b) =>
        b.decls.get("animation") === "none" &&
        selectorsOf(b).includes(`${O4} [inert] .is-guided`)
    );
    expect(stop).toBeDefined();
    expect(selectorsOf(stop!)).toContain(`${O4} .is-guided[inert]`);
    expect(stop!.at).toBeGreaterThan(pulse.at);
  });

  // globals.css pushes focus out past the static 3px ring; the pulse's
  // 5px gap and up-to-14px ring would grow into that outline.
  it("stops the pulse while the guided record control has keyboard focus", () => {
    const pulse = animated.find(
      (b) => animationName(b.decls.get("animation")!) === "guidePulse"
    )!;
    const stop = styleRules.find(
      (b) =>
        b.decls.get("animation") === "none" &&
        selectorsOf(b).includes(
          `${O4} .control--record.is-guided:focus-visible`
        )
    );
    expect(stop).toBeDefined();
    expect(selectorsOf(stop!)).toContain(
      `${O4} .record-guide.is-guided:has(> .control:focus-visible)`
    );
    expect(stop!.at).toBeGreaterThan(pulse.at);
  });
});
