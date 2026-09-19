import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every dialog in the tree has an accessible name (#198, #164 R-19).
 *
 * `recorder.tsx`'s sheet was `role="dialog" aria-modal="true"` with neither
 * `aria-label` nor `aria-labelledby`, so the one surface a translator spends
 * the whole session inside announced as an unnamed dialog. Its five siblings
 * all carried a name, which is what made it read as an oversight rather than a
 * choice — and #155's round-1 triage had already recorded it as FIXED when what
 * shipped was a `role="alert"` on the recovery panel, a different thing.
 *
 * WHY THIS SHAPE. #197 records that this repo has no DOM/renderer runner, so
 * "the sheet announces as Recorder" is not assertable here and this test does
 * not claim it. What it asserts is the one thing source can carry: that no
 * `role="dialog"`/`role="alertdialog"` element is missing a naming attribute.
 * That makes it a gate on the DEFECT CLASS rather than on the one instance —
 * the next dialog added without a name fails here, which is the part a
 * one-off fix cannot do. Whether the name that reaches VoiceOver/TalkBack is
 * the right WORD is a device check, still owed, and named in #198.
 *
 * It reads JSX text, not an AST (#280 tracks that trade-off for the precache
 * guard). The `role=` and the naming attribute must therefore be within the
 * same JSX opening tag, which is where both belong anyway.
 */
const COMPONENTS = path.resolve(import.meta.dirname, "..", "src", "components");

/** Every opening JSX tag in `source` that sets a dialog role, with its line. */
function dialogTags(source: string): { line: number; tag: string }[] {
  const found: { line: number; tag: string }[] = [];
  // `<` then anything but another `<` up to the closing `>` of the opening tag
  // — so a tag's own attributes are captured but the next element never is.
  for (const match of source.matchAll(/<[A-Za-z][^<]*?>/gs)) {
    const tag = match[0];
    if (!/role=["'](?:alert)?dialog["']/.test(tag)) continue;
    // A comment mentioning `role="alertdialog"` in prose is not a tag; those
    // live in /* */ or // and never inside a JSX opening tag's attribute list,
    // but `error-boundary.tsx:66` proves they exist in this tree, so the match
    // is confirmed to be a real element by requiring at least one attribute.
    if (!/\s[a-zA-Z-]+=/.test(tag)) continue;
    found.push({
      line: source.slice(0, match.index).split("\n").length,
      tag,
    });
  }
  return found;
}

const files = readdirSync(COMPONENTS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({
    name,
    source: readFileSync(path.join(COMPONENTS, name), "utf8"),
  }));

describe("every dialog carries an accessible name (#198, #164 R-19)", () => {
  const tags = files.flatMap(({ name, source }) =>
    dialogTags(source).map((t) => ({ file: name, ...t }))
  );

  // If the sweep finds nothing it would pass vacuously, which is the failure
  // mode of a regex over source: rename the attribute and the gate goes quiet
  // instead of red. Pin the count's floor to the dialogs known to exist.
  it("finds the dialogs it is supposed to be checking", () => {
    expect(tags.length).toBeGreaterThanOrEqual(6);
    expect(tags.map((t) => t.file)).toContain("recorder.tsx");
  });

  for (const { file, line, tag } of tags) {
    it(`${file}:${line} names its dialog`, () => {
      const named = /\saria-label=/.test(tag) || /\saria-labelledby=/.test(tag);
      expect(
        named,
        `${file}:${line} is a dialog with neither aria-label nor aria-labelledby:\n${tag}`
      ).toBe(true);
    });
  }
});
