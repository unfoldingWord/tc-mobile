import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * One O4 area stylesheet (`src/app/styles/o4/<area>.css`), read as rules
 * rather than as a raw string.
 *
 * AGENTS.md names the trap a whole-file regex falls into: a comment that
 * names a selector or a primitive family captures the test. So comments are
 * stripped FIRST, and every assertion reads a rule's selector list and its
 * declarations — never the bare file text.
 *
 * Deliberately narrow: the area files hold one `@layer components { … }`
 * block of flat rules (no nesting, no `@media`). A nested block would not
 * parse here, and `rules.length` falling to zero is what every caller's
 * non-emptiness floor catches.
 */
export interface CssRule {
  readonly selectors: readonly string[];
  readonly decls: ReadonlyMap<string, string>;
}

export function areaRules(area: string): CssRule[] {
  const file = path.join(process.cwd(), "src/app/styles/o4", `${area}.css`);
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const open = text.indexOf("@layer components");
  const body = text.slice(text.indexOf("{", open) + 1, text.lastIndexOf("}"));
  return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, block]) => ({
    selectors: sel!.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    decls: new Map(
      block!
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return [
            d.slice(0, colon).trim(),
            d
              .slice(colon + 1)
              .trim()
              .replace(/\s+/g, " "),
          ] as const;
        })
    ),
  }));
}

/** The declarations of the one rule whose selector list contains `selector`. */
export function declsFor(
  rules: readonly CssRule[],
  selector: string
): ReadonlyMap<string, string> {
  const hits = rules.filter((r) => r.selectors.includes(selector));
  if (hits.length !== 1)
    throw new Error(
      `${hits.length} rules carry ${selector}, expected exactly one`
    );
  return hits[0]!.decls;
}
