import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The recorder sheet opts out of text selection and the platform's
 * long-press/double-tap callout (#556).
 *
 * What was wrong in source: nothing anywhere in `src/` set `user-select` or
 * `-webkit-touch-callout`, so WebKit's default selection fired over the
 * waveform and over the sheet's ordinary-text chrome — the breadcrumb in the
 * reported screenshot had been text-selected, and a Copy/Look Up/Translate
 * callout covered the canvas.
 *
 * Not assertable by rendering: this repo has no DOM runner (#197, and
 * `touch-policy.test.ts` concedes the same for its own subject), and whether
 * the platform raises a callout is a measurement on a phone. These tests
 * prove three things and only those three: the declarations exist, they sit
 * on a class the recorder really renders, and they stop at the recorder.
 * They do NOT prove the iOS symptom is gone. That is an on-device check and
 * it has not been run.
 *
 * The block is sliced and its declaration VALUES are matched — the shape
 * `share-progress.test.ts` uses — and comments are stripped from the slice
 * first. A test that regexes a stylesheet raw is captured by the file's own
 * prose: a comment naming the property it discusses reads as the property
 * (AGENTS.md; #529 round 3 turned a test red exactly that way).
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const components = read("src/app/styles/3-components.css");
const recorder = read("src/components/recorder.tsx");

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The declarations of one class's own rule block, as prop -> value.
 * `\s*\{` keeps this on the bare class, not on a `::placeholder` or `:focus`
 * sibling.
 */
const declarationsOf = (className: string) => {
  const block = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "s").exec(
    components
  )?.[1];
  const body = withoutComments(block ?? "");
  const declarations = new Map<string, string>();
  for (const [, prop, value] of body.matchAll(/(-?[a-z][a-z-]*):\s*([^;]+);/g))
    if (prop && value) declarations.set(prop, value.trim());
  return declarations;
};

describe("the recorder sheet opts out of selection and the callout (#556)", () => {
  const sheet = declarationsOf("recorder-sheet");

  // The floor. Without it every assertion below would pass vacuously over an
  // empty slice if the selector moved, was renamed, or was matched inside a
  // comment instead of a rule.
  it("has a .recorder-sheet rule with declarations in it", () => {
    expect(
      sheet.size,
      "no .recorder-sheet rule in 3-components.css"
    ).toBeGreaterThanOrEqual(6);
  });

  // Both spellings of `user-select` on purpose: Safari only supports the
  // unprefixed property from 17.0, and this repo records no minimum iOS
  // anywhere. esbuild cannot collapse the pair — they are different property
  // names, not a repeated declaration of one (the scar `dist-css.test.ts`
  // documents).
  it("suppresses selection in both spellings and suppresses the callout", () => {
    expect(sheet.get("-webkit-user-select")).toBe("none");
    expect(sheet.get("user-select")).toBe("none");
    expect(sheet.get("-webkit-touch-callout")).toBe("none");
  });

  // The `.breadcrumb`/`p-0` lesson from `touch-policy.test.ts`: if the class
  // comes off the element, the rule above styles nothing and the two
  // assertions before this one still pass. Both properties inherit, which is
  // why one rule on the sheet reaches the header, the breadcrumb span, the
  // canvas, the selection handles and the toolbar — none of which carries a
  // class of its own.
  it("is the class the recorder sheet actually renders", () => {
    expect(recorder).toMatch(/className="recorder-sheet/);
  });
});

describe("the opt-out stops at the recorder (#556)", () => {
  // The other half of the gate. A suppression that reached `#root` would also
  // reach BuildStamp's version and sha, DatabasePanel and FailureLogPanel —
  // the surfaces where selecting text is a legitimate act.
  it("did not go global: globals.css suppresses neither", () => {
    const globals = withoutComments(read("src/app/globals.css"));
    expect(globals).not.toMatch(/user-select/);
    expect(globals).not.toMatch(/touch-callout/);
  });

  // The rename field is the one surface in the app whose text MUST stay
  // selectable and editable. It is not opted out, and no exclusion rule was
  // shipped to protect it — it is out of the sheet's subtree entirely (the
  // menu that carries it portals to `document.body`), so a guard here would
  // be a stub for a condition that cannot occur.
  it("the rename field is not opted out", () => {
    const field = declarationsOf("name-input");
    expect(
      field.size,
      "no .name-input rule in 3-components.css"
    ).toBeGreaterThanOrEqual(6);
    expect(field.has("user-select")).toBe(false);
    expect(field.has("-webkit-user-select")).toBe(false);
    expect(field.has("-webkit-touch-callout")).toBe(false);
  });

  // Why that needs no exclusion rule, asserted rather than asserted-in-prose:
  // the recorder has no text-entry element of its own and does not render the
  // one component that has one. The day either changes, this fails and the
  // exclusion becomes real work instead of a silent regression.
  it("nothing inside the recorder can inherit it onto a text field", () => {
    expect(recorder).not.toMatch(/<input|<textarea|contentEditable/);
    expect(recorder).not.toMatch(/from "\.\/name-edit"/);
  });
});
