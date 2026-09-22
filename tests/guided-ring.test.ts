import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The guide's ONE visual, and the wiring that carries it (#604).
 *
 * The decision — which control is the next required action — is
 * `tests/guided-step.test.ts`. This is the other half: that the answer is
 * painted in a single accent reached through a layer-2 role, and that every
 * member of the chain actually arrives at a control. A resolver nothing reads
 * is a comment; a ring drawn from a colour primitive is a theme that cannot
 * switch (AGENTS.md's styling boundary).
 *
 * Source text, not a computed style: the cascade and the real build are the
 * Playwright suite's job (`e2e/theme-toggle.spec.ts` is the precedent), and
 * nothing here claims the ring has been SEEN.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const semantic = read("src/app/styles/2-semantic.css");
const components = read("src/app/styles/3-components.css");

/** The declaration block that follows `selector`, by its first `{`…`}` pair. */
function ruleBlock(css: string, selector: string): string {
  // Anchored on the selector at the start of a line so a selector NAMED in a
  // comment cannot capture the slice — the trap round 3 of #529 sprang on
  // `share-progress.test.ts`.
  const at = css.search(new RegExp(`^\\s*\\${selector}[^{]*\\{`, "m"));
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  if (close === -1) throw new Error(`unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

describe("the guide accent is one colour, reached through layer 2 (#604)", () => {
  it("declares --s-guide in BOTH themes, at the same value", () => {
    // The issue asks for one guidance colour that reads on the dark background
    // and in light mode alike. A role only the dark block declares would leave
    // the ring unpainted in light — the half-applied theme #171 exists to catch.
    const light = semantic.indexOf(':root[data-theme="light"] {');
    expect(light, "no light block").toBeGreaterThan(-1);
    const guide = /--s-guide:\s*([^;]+);/g;
    const dark = guide.exec(semantic.slice(0, light))?.[1]?.trim();
    const lit = /--s-guide:\s*([^;]+);/
      .exec(semantic.slice(light))?.[1]
      ?.trim();
    expect(dark, "--s-guide is not declared in the dark block").toBeTruthy();
    expect(lit, "--s-guide is not declared in the light block").toBeTruthy();
    expect(lit).toBe(dark);
  });

  it("draws the ring from the role and nothing lower", () => {
    for (const selector of [".is-guided", ".control--record.is-guided"]) {
      const block = ruleBlock(components, selector);
      const declarations = [...block.matchAll(/([a-z-]+):\s*([^;]+);/g)];
      // Vacuity floor: a slice that caught a comment instead of a rule has no
      // declarations, and every assertion below would pass over nothing.
      expect(
        declarations.length,
        `${selector} declares nothing`
      ).toBeGreaterThanOrEqual(1);
      for (const [, prop, value] of declarations)
        expect(value, `${selector}'s ${prop} reaches past layer 2`).not.toMatch(
          /--p-(amber|cool|green|red|warn|blue)/
        );
      expect(block, `${selector} does not paint the guide role`).toMatch(
        /var\(--s-guide\)/
      );
    }
  });

  it("keeps the record ring OUTSIDE the red, and every other ring inside", () => {
    // Not a taste call. The accent on `--s-live` is ~1.05:1 (see
    // `tests/contrast.test.ts`), so a ring drawn inside the red button is a
    // ring almost nobody can see; on the sheet's floor behind it, it clears
    // the non-text floor. Everywhere else the ring must stay inside its own
    // box, because a full-bleed row is flush with a scroll container that
    // clips anything drawn outside it.
    expect(ruleBlock(components, ".is-guided")).toMatch(/box-shadow:\s*inset/);
    expect(ruleBlock(components, ".control--record.is-guided")).toMatch(
      /box-shadow:\s*0/
    );
  });
});

describe("every step of the chain reaches a control (#604)", () => {
  const resolver = read("src/components/guided-step.ts");
  const screens = {
    "src/components/books-screen.tsx": [
      "new-book",
      "create-book",
      "add-chapter",
      "open-chapter",
    ],
    "src/components/segments-screen.tsx": ["add-segment"],
    "src/components/recorder.tsx": ["record"],
  } as const;

  it("claims every member of the union, so a new step cannot ship unwired", () => {
    const declared = new Set(
      [...resolver.matchAll(/kind:\s*"([a-z-]+)"/g)].map(([, k]) => k!)
    );
    expect(declared.size).toBeGreaterThanOrEqual(6);
    expect([...declared].sort()).toEqual(
      Object.values(screens).flat().slice().sort()
    );
  });

  for (const [file, kinds] of Object.entries(screens)) {
    it(`${path.basename(file)} asks the resolver and marks its own steps`, () => {
      const source = read(file);
      expect(source, "does not call guidedStep").toMatch(/guidedStep\(/);
      expect(source, "marks no control").toMatch(/guided=\{/);
      for (const kind of kinds)
        expect(source, `never reads the "${kind}" step`).toContain(`"${kind}"`);
    });
  }

  it("marks the chapter row, which is a plain button and not a Control", () => {
    // The row carries the class itself; every other target goes through
    // `Control`/`EmptyState`/`NameEdit`, whose prop is covered by the render
    // harness in `tests/control-render.test.ts`.
    expect(read("src/components/books-screen.tsx")).toContain("is-guided");
  });
});
