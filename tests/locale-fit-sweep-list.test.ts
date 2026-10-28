import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PENDING } from "@/lib/i18n/pending";

import { stripComments } from "./support";

/**
 * The 360 px locale-fit sweep (`e2e/locale-fit-sweep.spec.ts`, #1458) states
 * that it visits English and every language whose table is complete. Nothing
 * held that sentence: `zh-Hans` became complete (#1667) and was never added.
 * This reads the sweep's `LOCALES` list from the spec's text, comments
 * stripped, and compares it with `en` plus every language whose pending list
 * is empty in `src/lib/i18n/pending.ts`, so the next language cannot be
 * skipped the same way.
 *
 * It reads source; it does not run the sweep, and says nothing about whether
 * any screen fits.
 */
const SPEC = "e2e/locale-fit-sweep.spec.ts";

/** The tags in `const LOCALES = [...]`, in file order. */
function sweptLocales(specText: string): string[] {
  const code = stripComments(specText);
  const match = /const LOCALES = \[([^\]]*)\] as const;/.exec(code);
  if (match === null) throw new Error(`no LOCALES list found in ${SPEC}`);
  const tags = [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (tags.length === 0) throw new Error(`LOCALES in ${SPEC} is empty`);
  return tags;
}

/** `en` plus every language that has no key still pending. */
function completeLocales(
  pending: Readonly<Record<string, readonly string[] | "all">>
): string[] {
  return [
    "en",
    ...Object.entries(pending)
      .filter(([, keys]) => Array.isArray(keys) && keys.length === 0)
      .map(([tag]) => tag),
  ];
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/** Whether the spec text's list is exactly the complete languages. */
function listMatches(specText: string, complete: readonly string[]): boolean {
  return (
    JSON.stringify(sorted(sweptLocales(specText))) ===
    JSON.stringify(sorted(complete))
  );
}

describe("the locale-fit sweep's language list", () => {
  it("is English plus every complete language, no more and no fewer", () => {
    expect(
      listMatches(readFileSync(SPEC, "utf8"), completeLocales(PENDING))
    ).toBe(true);
  });

  it("is red when a complete language has no sweep entry", () => {
    const without = completeLocales(PENDING).filter((t) => t !== "zh-Hans");
    const text = `const LOCALES = [${without.map((t) => `"${t}"`).join(", ")}] as const;`;
    expect(listMatches(text, completeLocales(PENDING))).toBe(false);
  });

  it("is red when a language is added to pending.ts as complete", () => {
    const next = { ...PENDING, xx: [] as readonly string[] };
    expect(listMatches(readFileSync(SPEC, "utf8"), completeLocales(next))).toBe(
      false
    );
  });

  it("does not count a language that is still pending", () => {
    expect(completeLocales(PENDING)).not.toContain("ar");
    expect(completeLocales({ ar: "all", de: ["k"] })).toEqual(["en"]);
  });

  it("ignores a tag that only a comment names", () => {
    const text = `// "zz"\nconst LOCALES = ["en"] as const;`;
    expect(sweptLocales(text)).toEqual(["en"]);
  });

  it("throws when the list cannot be found", () => {
    expect(() => sweptLocales("const OTHER = [];")).toThrow(/no LOCALES/);
  });
});
