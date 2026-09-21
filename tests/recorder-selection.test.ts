import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The recorder opts out of text selection and the platform's
 * long-press/double-tap callout (#556).
 *
 * What was wrong in source: nothing anywhere in `src/` set `user-select` or
 * `-webkit-touch-callout`, so WebKit's default selection fired over the
 * waveform and over the sheet's ordinary-text chrome — the breadcrumb in the
 * reported screenshot had been text-selected, and a Copy/Look Up/Translate
 * callout covered the canvas.
 *
 * The opt-out has THREE roots, not one, because two of the recorder's own
 * surfaces are portalled out of the sheet's subtree: `.recorder-sheet` for the
 * inline sheet, `.menu-panel` for the ≡ drawer and `.confirm-panel` for the
 * erase confirm (both `createPortal(..., document.body)`). Inheritance carries
 * each root over its own chrome; nothing carries between them.
 *
 * Not assertable by rendering: this repo has no DOM runner (#197, and
 * `touch-policy.test.ts` concedes the same for its own subject), and whether
 * the platform raises a callout is a measurement on a phone. These tests
 * prove four things and only those four: the declarations exist on all three
 * roots, those roots are classes the recorder really renders, the roots are
 * portalled (which is WHY there are three), and the opt-out neither goes
 * global nor swallows the one field that must stay editable. They do NOT
 * prove the iOS symptom is gone. That is an on-device check and it has not
 * been run.
 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Source with its comments removed — block (`/* … *\/`, JSX `{/* … *\/}` with
 * it) and line (`//`) alike.
 *
 * Every read below goes through this, CSS and TSX. A test that regexes a file
 * raw is captured by that file's own prose: a comment naming the thing it
 * discusses reads as the thing (AGENTS.md; #529 round 3 turned a test red
 * exactly that way). Round 1 of this file applied the strip to the CSS slices
 * only and read `recorder.tsx` raw, which was defeated in BOTH directions at
 * `b906f38` — renaming the live class and adding one prose line naming the old
 * one left the suite 6/6 green with the fix dead, and a single added comment
 * line containing `<input>` turned the last test red on its own.
 *
 * The `//` strip is guarded against `:` so a `://` inside a string survives.
 * Over-stripping is the dangerous direction here — it would make the two
 * negative assertions below pass over nothing — so the recorder read carries
 * code landmarks as a floor, and the helper itself is exercised directly.
 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const read = (rel: string) =>
  withoutComments(readFileSync(path.join(ROOT, rel), "utf8"));

const components = read("src/app/styles/3-components.css");
const recorder = read("src/components/recorder.tsx");

/**
 * The declarations of one class's own rule block, as prop -> value.
 * `\s*\{` keeps this on the bare class, not on a `::placeholder` or `:focus`
 * sibling.
 */
const declarationsOf = (className: string) => {
  const body =
    new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "s").exec(components)?.[1] ??
    "";
  const declarations = new Map<string, string>();
  for (const [, prop, value] of body.matchAll(/(-?[a-z][a-z-]*):\s*([^;]+);/g))
    if (prop && value) declarations.set(prop, value.trim());
  return declarations;
};

/** The three roots, and the floor that keeps each slice non-empty. */
const ROOTS = ["recorder-sheet", "menu-panel", "confirm-panel"] as const;

/**
 * Every stylesheet under `src/` — discovered, not a hand-kept list that goes
 * stale the day a fifth one lands. The app loads four today (`globals.css`
 * imports `styles/index.css`, which imports the three layers).
 */
const STYLESHEETS = readdirSync(path.join(ROOT, "src"), { recursive: true })
  .map(String)
  .filter((name) => name.endsWith(".css"))
  .map((name) => path.join("src", name))
  .sort();

/**
 * The selector of every rule in one stylesheet that declares `user-select` or
 * `-webkit-touch-callout`, in either spelling.
 *
 * Walking back from the declaration to its own `{`, and from there to the
 * previous `{`, `}` or `;`, is what survives this repo's `@layer components {
 * … }` wrapper and any `@media` block without pulling in a CSS parser for one
 * question. Comments are already gone (`read` strips them), so the prose in
 * `3-components.css`'s header that names these properties in order to discuss
 * them is not counted as a rule.
 */
const selectorsDeclaringSelection = (css: string) =>
  [...css.matchAll(/(?:-webkit-)?(?:user-select|touch-callout)\s*:/g)].map(
    (match) => {
      const head = css.slice(0, match.index);
      const before = head.slice(0, head.lastIndexOf("{"));
      const start = Math.max(
        before.lastIndexOf("{"),
        before.lastIndexOf("}"),
        before.lastIndexOf(";")
      );
      return before.slice(start + 1).trim();
    }
  );

describe("the comment strip every read here depends on", () => {
  // The gate's own mechanism, in both states: comments go, code stays.
  it("removes line and block comments and keeps the code around them", () => {
    const stripped = withoutComments(
      [
        'const a = "keep";',
        "// drop me",
        "/* drop\n me */",
        "const b = 1;",
      ].join("\n")
    );
    expect(stripped).toContain('const a = "keep";');
    expect(stripped).toContain("const b = 1;");
    expect(stripped).not.toContain("drop me");
    expect(stripped).not.toContain("drop\n me");
  });

  it("does not eat the rest of a line after a :// in a string", () => {
    expect(withoutComments('const u = "https://example.test/x";')).toContain(
      "https://example.test/x"
    );
  });

  // The floor for the two negative assertions at the bottom of this file: if
  // the strip ever ate real code, `not.toMatch` would pass over the wreckage.
  it("leaves recorder.tsx's real code standing", () => {
    expect(recorder).toMatch(/export const Recorder = forwardRef</);
    expect(recorder).toMatch(/className="recorder-canvas/);
  });
});

describe("the recorder opts out of selection and the callout (#556)", () => {
  // The floor. Without it every assertion below would pass vacuously over an
  // empty slice if a selector moved, was renamed, or was matched inside a
  // comment instead of a rule.
  it.each(ROOTS)("has a .%s rule with declarations in it", (className) => {
    expect(
      declarationsOf(className).size,
      `no .${className} rule in 3-components.css`
    ).toBeGreaterThanOrEqual(6);
  });

  // Both spellings of `user-select` on purpose: WebKit shipped the prefixed
  // name long before the unprefixed one and this repo records no minimum iOS
  // anywhere, so the prefixed declaration is the one certain to apply on an
  // old device.
  //
  // Round 1 of this file stated a specific first-unprefixed Safari version as
  // flat fact, here and in the stylesheet. That was unverified platform
  // recollection — no source for it was checked in this repo — and it is not
  // restated. Keeping the pair does not depend on which version it is.
  //
  // esbuild cannot collapse the pair either way: they are different property
  // names, not a repeated declaration of one (the scar `dist-css.test.ts`
  // documents).
  it.each(ROOTS)(
    ".%s suppresses selection in both spellings and suppresses the callout",
    (className) => {
      const rule = declarationsOf(className);
      expect(rule.get("-webkit-user-select")).toBe("none");
      expect(rule.get("user-select")).toBe("none");
      expect(rule.get("-webkit-touch-callout")).toBe("none");
    }
  );

  // The `.breadcrumb`/`p-0` lesson from `touch-policy.test.ts`: if a class
  // comes off its element, the rule styles nothing and the assertions above
  // still pass. Both properties inherit, which is why one rule per root
  // reaches the header, the breadcrumb span, the canvas, the selection
  // handles, the toolbar, the drawer title and the confirm's title — none of
  // which carries a class of its own.
  it("renders the sheet class, and raises the other two roots", () => {
    expect(recorder).toMatch(/className="recorder-sheet/);
    expect(recorder).toMatch(/<Menu\b/);
    expect(recorder).toMatch(/<EraseConfirm\b/);
    expect(read("src/components/menu.tsx")).toMatch(/className="menu-panel"/);
    expect(read("src/components/erase-confirm.tsx")).toMatch(
      /className="confirm-panel"/
    );
  });

  // WHY there are three roots rather than one rule on the sheet. The day
  // either component renders inline instead, its panel is inside the sheet's
  // subtree, the repeated declarations become redundant, and this test says
  // so out loud instead of leaving two copies with no stated reason.
  it.each(["menu", "erase-confirm"])(
    "%s.tsx portals out of the recorder's subtree, which is why it needs its own rule",
    (file) => {
      const source = read(`src/components/${file}.tsx`);
      expect(source).toMatch(/createPortal\(/);
      expect(source).toMatch(/document\.body/);
    }
  );
});

describe("the opt-out stops at those three roots (#556)", () => {
  // The other half of the gate. A suppression that reached `body` or `#root`
  // would also reach BuildStamp's version and sha and `DatabasePanel` — both
  // rendered at the top level of `App.tsx`, outside all three roots, and both
  // text a maintainer legitimately selects.
  //
  // Round 2 of this file asserted that over `globals.css` alone, which Frank
  // called correctly: the app loads four stylesheets, so `body { user-select:
  // none }` added to `3-components.css` or to either layer below it would have
  // left that assertion green while making the whole app unselectable — the
  // exact regression it claims to prevent. An allowlist over EVERY source
  // stylesheet replaces it. It subsumes the old one (a global rule in
  // `globals.css` is still caught) and adds what the old one could not see: a
  // fifth root anywhere in the tree fails here until someone decides it
  // belongs, whatever its selector.
  it("declares selection nowhere in src/ but on the four reviewed selectors", () => {
    const declaring = STYLESHEETS.flatMap((sheet) =>
      selectorsDeclaringSelection(read(sheet))
    );
    // Non-emptiness floor: an empty list would satisfy the set comparison
    // below just as well as the correct one, and every way this test could
    // break its own reads (a renamed file, an over-eager comment strip)
    // produces exactly that.
    expect(declaring.length).toBeGreaterThanOrEqual(12);
    expect([...new Set(declaring)].sort()).toEqual([
      ".confirm-panel",
      ".menu-panel",
      ".name-input",
      ".recorder-sheet",
    ]);
  });

  // The rename field is the one surface in the app whose text MUST stay
  // selectable and editable, and it is a descendant of `.menu-panel` —
  // `books-screen.tsx` and `segments-screen.tsx` both render `NameEdit` as a
  // `Menu` child. Round 1 asserted the opposite of this (that the field
  // carried no such declarations) and was right at the time, because the
  // suppression stopped at the sheet. Extending the opt-out to the drawer is
  // what turned that from a stub into a real exclusion.
  it("the rename field is opted back in", () => {
    const field = declarationsOf("name-input");
    expect(
      field.size,
      "no .name-input rule in 3-components.css"
    ).toBeGreaterThanOrEqual(6);
    expect(field.get("-webkit-user-select")).toBe("text");
    expect(field.get("user-select")).toBe("text");
    expect(field.get("-webkit-touch-callout")).toBe("default");
  });

  // The field above is the only text entry in `src/`. This says the recorder
  // still contributes none of its own — one that appeared inside the sheet
  // without `.name-input` on it would inherit the suppression with no escape
  // hatch. The day that changes, this fails and the exclusion becomes real
  // work instead of a silent regression.
  it("the recorder adds no text field of its own", () => {
    expect(recorder).not.toMatch(/<input|<textarea|contentEditable/);
    expect(recorder).not.toMatch(/from "\.\/name-edit"/);
  });
});
