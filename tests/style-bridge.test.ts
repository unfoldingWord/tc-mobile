import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * The one colour bridge, kept honest (#164 L-14).
 *
 * #164 found two bridges and neither finished: twelve semantic Tailwind aliases
 * in `globals.css` used ZERO times, against 33 inline
 * `style={{ color: "var(--s-…)" }}` declarations and four `text-[var(--s-…)]`
 * arbitrary utilities. It asked for one to be picked and the other deleted.
 * The inline half lost, and not on taste: an inline `style` outranks every
 * `@layer`, so a component that paints itself cannot have a rule in layer 3 at
 * all.
 *
 * Two things can rot afterwards, and neither is visible to any other check —
 * AGENTS.md: "Nothing in this repo reads CSS at all… an orphaned custom
 * property or component token is invisible to every check."
 *
 *   1. An alias pointing at a role layer 2 no longer defines. It resolves to
 *      nothing, paints nothing, and fails nothing.
 *   2. The deleted bridge creeping back, one component at a time.
 *
 * These assertions read source text, not computed styles.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
// Both stylesheets are read with their comments stripped, so a commented-out
// alias or role declaration cannot satisfy the checks below (#822).
const globals = stripCssComments(
  readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8")
);
const semantic = stripCssComments(
  readFileSync(
    path.join(ROOT, "src", "app", "styles", "2-semantic.css"),
    "utf8"
  )
);
const COMPONENTS = path.join(ROOT, "src", "components");
const primitives = stripCssComments(
  readFileSync(
    path.join(ROOT, "src", "app", "styles", "1-primitives.css"),
    "utf8"
  )
);
const componentTokens = stripCssComments(
  readFileSync(
    path.join(ROOT, "src", "app", "styles", "3-components.css"),
    "utf8"
  )
);

/**
 * A primitive's raw declared value, read directly rather than through
 * `cssRule` — `1-primitives.css` has a second, unrelated `:root` block
 * (the reduced-motion override), which makes `cssRule(primitives, ":root")`
 * throw as ambiguous. Each primitive name below is declared exactly once.
 */
function primitiveValue(css: string, name: string): string {
  const declaration = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!declaration) throw new Error(`primitiveValue: missing ${name}`);
  return declaration[1]!.trim();
}

describe("every Tailwind colour alias maps to a live layer-2 role (#164 L-14)", () => {
  const block = /@theme inline\s*\{([\s\S]*?)\n\}/.exec(globals);

  it("has an @theme block to check", () => {
    expect(block?.[1], "no @theme inline block in globals.css").toBeTruthy();
  });

  const aliases = [
    ...(block?.[1] ?? "").matchAll(
      /--color-([a-z0-9-]+):\s*var\((--s-[a-z0-9-]+)\)/g
    ),
  ].map(([, name, role]) => ({ name: name!, role: role! }));

  it("finds the aliases it is supposed to be checking", () => {
    // Vacuity guard: rename the declaration shape and this sweep goes quiet
    // rather than red, which is the standing failure mode of a regex over CSS.
    expect(aliases.length).toBeGreaterThanOrEqual(12);
  });

  it("bridges --s-voice-text, the accent-as-INK role (#457 George R1 P3)", () => {
    // Layer 2 splits the accent as a FILL (`--s-voice`) from the accent as
    // 12px TEXT on a wash of itself (`--s-voice-text`), because on light the
    // fill value is 3.0:1 there. `.modepill` reads the text role in layer 3;
    // without an alias a JSX caller has only `text-voice`, which is the fill —
    // the sub-AA value the split exists to keep off small text.
    expect(aliases.map((a) => a.name)).toContain("voice-text");
  });

  for (const { name, role } of aliases) {
    it(`--color-${name} -> ${role}, which layer 2 still defines`, () => {
      // Both theme blocks: a role only the dark block declares would leave the
      // utility unpainted in light, which is the half-applied theme #171's
      // browser spec exists to catch from the other side.
      const dark = semantic.indexOf(':root[data-theme="dark"] {');
      const light = semantic.indexOf(':root[data-theme="light"] {');
      expect(dark, "no dark block").toBeGreaterThan(-1);
      expect(light, "no light block").toBeGreaterThan(-1);
      const declaration = new RegExp(`${role}:\\s*[^;]+;`);
      expect(
        declaration.test(semantic.slice(0, light)),
        `${role} is not declared in the dark block`
      ).toBe(true);
      expect(
        declaration.test(semantic.slice(light)),
        `${role} is not declared in the light block`
      ).toBe(true);
    });
  }
});

describe("the deleted bridge stays deleted (#164 L-14)", () => {
  const files = readdirSync(COMPONENTS)
    .filter((n) => n.endsWith(".tsx"))
    .map((n) => ({
      name: n,
      source: readFileSync(path.join(COMPONENTS, n), "utf8"),
    }));

  it("sees every component, so it cannot pass on an empty sweep", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  for (const { name, source } of files) {
    it(`${name} paints no semantic colour inline`, () => {
      // Strip comments first: several files legitimately NAME a token in prose
      // to explain which role a component token remaps (`waveform.tsx`), and
      // the record of what this lane changed is worth keeping.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // The two spellings of the bridge that lost: an inline `style` carrying a
      // semantic role, and an arbitrary utility wrapping one. `left`/`transform`
      // computed from a module constant are data, not colour, and stay.
      expect(code, "an inline style carries a semantic colour").not.toMatch(
        /style=\{\{[^}]*var\(--s-/s
      );
      expect(code, "an arbitrary utility wraps a semantic role").not.toMatch(
        /\[var\(--s-[a-z0-9-]+\)\]/
      );
    });
  }
});

/**
 * The pixel half of the arbitrary-value bridge, batch one (#460).
 *
 * #460 is the pixel sibling of the colour bridge above: 69 `gap-[Npx]` /
 * `px-[Npx]` / `text-[Npx]` arbitrary utilities across nine components, none
 * of them load-bearing the way the colour bridge was — an arbitrary pixel
 * does not outrank a layer-3 rule, it just names a number that should have
 * been a token. The issue's rule is narrower than the colour sweep's total
 * ban: swap a literal for a token ONLY where the two are numerically
 * identical, so the rendered O4 UI does not move; a value with no exact
 * token stays put.
 *
 * This batch covers three of #460's nine files — `database-panel.tsx`,
 * `save-failed.tsx`, `empty-state.tsx` — chosen because none of them
 * appears in an open PR's diff. The other six are still open scope.
 * Three exact matches existed in this batch: `gap-[14px]` (`--c-gap-items`),
 * `text-[13px]` (`--p-text-md`) and `text-[12px]` (`--p-text-sm`); every
 * other arbitrary-pixel utility in these three files — `gap-[18px]`,
 * `gap-[8px]`, `px-[22px]`, `px-[24px]`, `mt-[10px]` — had no exact token
 * and was left as-is (see the PR body for the full list).
 *
 * Two things can rot, mirroring the colour sweep above: the literal creeping
 * back into one of these three files, and the primitive scale moving so the
 * token the swap assumed no longer equals the pixel value it replaced.
 */
describe("the batch-one pixel bridge stays mapped (#460)", () => {
  const SWEPT_FILES = [
    "database-panel.tsx",
    "save-failed.tsx",
    "empty-state.tsx",
  ];
  const swept = SWEPT_FILES.map((name) => ({
    name,
    code: stripCssComments(readFileSync(path.join(COMPONENTS, name), "utf8")),
  }));

  it("sees all three swept files", () => {
    // Vacuity guard: a renamed or moved file would otherwise go quiet here
    // rather than red.
    expect(swept.length).toBe(3);
  });

  const MAPPINGS = [
    {
      literal: "gap-[14px]",
      token: "gap-[var(--c-gap-items)]",
      literalPattern: /gap-\[14px\]/,
      tokenPattern: /gap-\[var\(--c-gap-items\)\]/,
    },
    {
      literal: "text-[13px]",
      token: "text-[length:var(--p-text-md)]",
      literalPattern: /text-\[13px\]/,
      tokenPattern: /text-\[length:var\(--p-text-md\)\]/,
    },
    {
      literal: "text-[12px]",
      token: "text-[length:var(--p-text-sm)]",
      literalPattern: /text-\[12px\]/,
      tokenPattern: /text-\[length:var\(--p-text-sm\)\]/,
    },
  ];

  for (const { name, code } of swept) {
    for (const { literal, literalPattern } of MAPPINGS) {
      it(`${name} does not carry the bare ${literal} this batch replaced`, () => {
        expect(code).not.toMatch(literalPattern);
      });
    }
  }

  for (const { token, tokenPattern } of MAPPINGS) {
    it(`${token} is still used at least once across the swept files`, () => {
      // Floor, not a per-file requirement: a value can legitimately move
      // between the three files without breaking this sweep, but the swap
      // itself must not have been silently reverted or deleted everywhere.
      const uses = swept.filter(({ code }) => tokenPattern.test(code)).length;
      expect(uses).toBeGreaterThanOrEqual(1);
    });
  }

  it("--c-gap-items still resolves to the 14px gap-[14px] used to mean", () => {
    const body = cssRule(componentTokens, ":root");
    const alias = declarationValue(body, "--c-gap-items");
    expect(alias).toBe("var(--p-space-4)");
    expect(primitiveValue(primitives, "--p-space-4")).toBe("14px");
  });

  it("--p-text-md still resolves to the 13px text-[13px] used to mean", () => {
    expect(primitiveValue(primitives, "--p-text-md")).toBe("13px");
  });

  it("--p-text-sm still resolves to the 12px text-[12px] used to mean", () => {
    expect(primitiveValue(primitives, "--p-text-sm")).toBe("12px");
  });
});

/**
 * The pixel half of the arbitrary-value bridge, batch two (#460).
 *
 * Batch two covers `error-boundary.tsx`, unlocked now that #1160 (which held
 * its own test file, `tests/error-boundary.test.ts`) has merged.
 * `playhead-overlay.tsx` — unlocked by #1158 — was checked too: it carries
 * exactly one arbitrary-pixel utility, `w-[2px]`, and no declared primitive
 * resolves to 2px (`--p-space-1`, the smallest spacing step, is 4px), so
 * nothing in that file changed — there is no swap for this sweep to guard,
 * and it is not part of `SWEPT_FILES` below. See the PR body for the full
 * accounting of both files.
 *
 * One exact match existed in `error-boundary.tsx`: `text-[13px]`, the same
 * `--p-text-md` mapping batch one used (2 occurrences, one per design
 * branch). `gap-[18px]` and `px-[22px]` — both already shown to have no
 * exact token in batch one's sibling files — recur here for the same
 * reason and are left as-is.
 */
describe("the batch-two pixel bridge stays mapped (#460)", () => {
  const name = "error-boundary.tsx";
  const code = stripCssComments(
    readFileSync(path.join(COMPONENTS, name), "utf8")
  );

  it("sees the swept file", () => {
    // Vacuity guard: an empty read (renamed or moved file) would otherwise
    // make every assertion below pass on nothing.
    expect(code.length).toBeGreaterThan(0);
  });

  it(`${name} does not carry the bare text-[13px] this batch replaced`, () => {
    expect(code).not.toMatch(/text-\[13px\]/);
  });

  it("text-[length:var(--p-text-md)] is used at least twice in the swept file", () => {
    // Both design branches (current look and O4) carry the teach line this
    // batch converted, so the floor is 2, not 1.
    const uses = (code.match(/text-\[length:var\(--p-text-md\)\]/g) ?? [])
      .length;
    expect(uses).toBeGreaterThanOrEqual(2);
  });

  it("--p-text-md still resolves to the 13px text-[13px] used to mean", () => {
    expect(primitiveValue(primitives, "--p-text-md")).toBe("13px");
  });
});
