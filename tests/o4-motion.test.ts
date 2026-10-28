import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { areaSelector, readAreaCss } from "./o4-area-css";
import { stripCssComments } from "./support";

/**
 * O4 ambient motion (#950, epic #936): `src/app/styles/o4/motion.css`.
 *
 * Read as a tree of blocks (PostCSS) rather than as a raw string, with block
 * comments stripped first, so prose that names a selector or a keyframe cannot
 * be the match (AGENTS.md, the #529 trap). The tree, not one `areaScope`
 * block, because the gate below compares positions ACROSS blocks: each loop's
 * `animation: none` must come later than the rule that starts it.
 *
 * The gate: every rule that sets an animation is matched,
 * selector for selector, by an `animation: none` rule inside the file's
 * `prefers-reduced-motion: reduce` block, and that rule comes later in the
 * same layer at equal specificity, so it wins. The app has no in-app
 * "Remove animations" setting to guard as well (see the stylesheet's header).
 *
 * What this cannot show: that a browser runs the loops, or stops them. That
 * is a cascade in a real engine, and nothing here renders one.
 */

const sel = (selector: string) => areaSelector("motion", selector);
const REDUCE = "@media (prefers-reduced-motion: reduce)";

interface Block {
  /** The selector list or at-rule prelude, whitespace collapsed. */
  readonly prelude: string;
  /** Declarations, when the block holds any. */
  readonly decls: ReadonlyMap<string, string>;
  readonly children: readonly Block[];
  /** Source position of the block's start, for ordering. */
  readonly at: number;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function toBlock(node: postcss.Rule | postcss.AtRule): Block {
  const prelude =
    node.type === "rule"
      ? squash(node.selector)
      : squash(`@${node.name} ${node.params}`);
  const decls = new Map<string, string>();
  const children: Block[] = [];
  for (const child of node.nodes ?? []) {
    if (child.type === "decl") decls.set(child.prop, squash(child.value));
    else if (child.type === "rule" || child.type === "atrule")
      children.push(toBlock(child));
  }
  return { prelude, decls, children, at: node.source!.start!.offset };
}

const TREE = postcss
  .parse(stripCssComments(readAreaCss("motion")))
  .nodes.filter(
    (n): n is postcss.Rule | postcss.AtRule =>
      n.type === "rule" || n.type === "atrule"
  )
  .map(toBlock);
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

describe("every O4 loop (#950)", () => {
  it("runs only keyframes this file defines, and defines none it does not run", () => {
    const used = new Set(
      animated.map((b) => animationName(b.decls.get("animation")!))
    );
    expect([...used].sort()).toEqual([...keyframes.keys()].sort());
  });

  it.each([
    [
      "guidePulse",
      [
        sel(".control--record.is-guided"),
        sel(".control--mic.is-guided"),
        sel(".record-guide.is-guided"),
      ],
      "guidePulse var(--p-ambient-guide-pulse, 1.8s) ease-in-out infinite",
    ],
    [
      "liveEdge",
      [sel('.recorder-stage[data-o4-look="recording"]::after')],
      "liveEdge var(--p-ambient-live-edge, 1.2s) ease-in-out infinite",
    ],
    [
      "armedPulse",
      [sel(".o4-tile--send.is-armed")],
      "armedPulse var(--p-ambient-armed, 1.6s) ease-in-out infinite",
    ],
    [
      "blink",
      [sel(".recorder-status .rec-dot")],
      "blink var(--p-ambient-blink, 1s) steps(2) infinite",
    ],
    [
      "shake",
      [
        sel(".books-delete-ask > .o4-sheet-head"),
        sel(".o4-err-body[data-refused]"),
      ],
      "shake var(--p-ambient-shake, 0.35s) ease-in-out 2",
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
        selectorsOf(b).includes(sel("[inert] .is-guided"))
    );
    expect(stop).toBeDefined();
    expect(selectorsOf(stop!)).toContain(sel(".is-guided[inert]"));
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
        selectorsOf(b).includes(sel(".control--record.is-guided:focus-visible"))
    );
    expect(stop).toBeDefined();
    expect(selectorsOf(stop!)).toContain(
      sel(".record-guide.is-guided:has(> .control:focus-visible)")
    );
    expect(stop!.at).toBeGreaterThan(pulse.at);
  });

  // An unrecorded row's mic (#1217) pulses too, and its focus outline is
  // pushed out the same way, so the same stop has to cover it (#1233 item 19).
  it("stops the pulse while the guided row mic has keyboard focus", () => {
    const pulse = animated.find(
      (b) => animationName(b.decls.get("animation")!) === "guidePulse"
    )!;
    expect(selectorsOf(pulse)).toContain(sel(".control--mic.is-guided"));
    const stop = styleRules.find(
      (b) =>
        b.decls.get("animation") === "none" &&
        selectorsOf(b).includes(sel(".control--mic.is-guided:focus-visible"))
    );
    expect(stop).toBeDefined();
    expect(stop!.at).toBeGreaterThan(pulse.at);
  });
});
