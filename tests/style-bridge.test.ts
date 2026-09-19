import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
 * Source text, not a computed style: there is no renderer here (#197).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const globals = readFileSync(
  path.join(ROOT, "src", "app", "globals.css"),
  "utf8"
);
const semantic = readFileSync(
  path.join(ROOT, "src", "app", "styles", "2-semantic.css"),
  "utf8"
);
const COMPONENTS = path.join(ROOT, "src", "components");

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
