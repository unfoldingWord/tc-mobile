import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The structural primitives O4 adds to layer 1 (#939; decisions D4, D5 and D6
 * on #937): type sizes and weights, radii, and the ambient-motion group.
 *
 * No component reads these yet; the O4 screen lanes swap their literal px
 * values onto them. What this pins is that the decided values exist under the
 * names those lanes will read, and that the ambient group is off under
 * `prefers-reduced-motion` for every member, including one added later.
 *
 * Reads source text with comments stripped first, so prose in the file's
 * header that names a token cannot satisfy or capture an assertion.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const source = readFileSync(
  path.join(ROOT, "src", "app", "styles", "1-primitives.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

const REDUCE = "@media (prefers-reduced-motion: reduce)";

/** Every `--p-…: value;` declaration in a slice of CSS text. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of css.matchAll(
    /(--p-[a-z0-9-]+)\s*:\s*([^;]+);/g
  ))
    if (name !== undefined && value !== undefined) out.set(name, value.trim());
  return out;
}

const reduceAt = source.indexOf(REDUCE);
/** The always-on declarations: everything before the reduced-motion block. */
const base = declarations(reduceAt === -1 ? source : source.slice(0, reduceAt));
/** What the reduced-motion block redefines. */
const reduced = declarations(reduceAt === -1 ? "" : source.slice(reduceAt));

describe("O4 type primitives (#939, D4)", () => {
  // 12 and 21 are already `--p-text-sm` and `--p-text-lg`; O4 reads those
  // rather than a second name for the same value.
  it("keeps the two existing sizes O4 reuses", () => {
    expect(base.get("--p-text-sm")).toBe("12px");
    expect(base.get("--p-text-lg")).toBe("21px");
  });

  for (const px of [14, 15, 16, 17, 18, 19, 20, 22, 32]) {
    it(`--p-text-${px} is ${px}px`, () => {
      expect(base.get(`--p-text-${px}`)).toBe(`${px}px`);
    });
  }

  it("adds the 700 and 800 weights", () => {
    expect(base.get("--p-weight-bold")).toBe("700");
    expect(base.get("--p-weight-heavy")).toBe("800");
  });
});

describe("O4 radius primitives (#939, D5)", () => {
  for (const px of [12, 16, 20, 22, 26]) {
    it(`--p-radius-${px} is ${px}px`, () => {
      expect(base.get(`--p-radius-${px}`)).toBe(`${px}px`);
    });
  }
});

describe("O4 ambient motion is its own group, off under reduced motion (#939, D6)", () => {
  const ambient = [...base].filter(([name]) => name.startsWith("--p-ambient-"));

  it("has the design reference's seven animation durations", () => {
    // docs/design/o4-design-system.md §4. The reorder shift is a transition
    // on a gesture, not an ambient animation, so it is not in this group.
    expect(Object.fromEntries(ambient)).toEqual({
      "--p-ambient-mic-pulse": "1.3s",
      "--p-ambient-live-edge": "1.2s",
      "--p-ambient-blink": "1s",
      "--p-ambient-armed": "1.6s",
      "--p-ambient-guide-pulse": "1.8s",
      "--p-ambient-audible": "0.9s",
      "--p-ambient-shake": "0.35s",
    });
  });

  it("does not widen the two transition durations", () => {
    // The ambient loops are a separate rule, not new `--p-dur-*` steps.
    const durations = [...base.keys()].filter((n) => n.startsWith("--p-dur-"));
    expect(durations.sort()).toEqual(["--p-dur-base", "--p-dur-fast"]);
  });

  it("has a reduced-motion block to check", () => {
    expect(reduceAt, `no ${REDUCE} block in 1-primitives.css`).toBeGreaterThan(
      -1
    );
  });

  it("zeroes every ambient duration under reduced motion", () => {
    // Floor, so a renamed group cannot pass this by looping over nothing.
    expect(ambient.length).toBeGreaterThanOrEqual(7);
    for (const [name] of ambient)
      expect(reduced.get(name), `${name} under reduced motion`).toBe("0s");
  });

  it("redefines nothing but the ambient group under reduced motion", () => {
    for (const name of reduced.keys())
      expect(name, "a non-ambient primitive in the reduce block").toMatch(
        /^--p-ambient-/
      );
  });
});
