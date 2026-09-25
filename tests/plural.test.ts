import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { plural } from "@/lib/plural";

/**
 * #169 — the six count-varying labels in `lib/strings.ts` branched on
 * `n === 1` inline. These cases exist to hold `plural` to being a *rule* rather
 * than that ternary with an indirection in front of it: the Polish and Russian
 * cases below both fail against an `n === 1 ? one : other` implementation, and
 * the fallback case fails against one that indexes the table directly.
 *
 * `Intl.PluralRules` for a non-English locale needs ICU data. Node ships
 * full-icu by default from v13, and this repo's floor is Node 22.12
 * (AGENTS.md) — the first case asserts the data is actually there, so a
 * runtime without it fails loudly here instead of silently reducing every
 * other case to the English rule.
 */
describe("plural", () => {
  it("has the ICU data the rest of these cases depend on", () => {
    // Polish is the discriminator used below: if ICU fell back to English
    // rules, `select(2)` would be "other" rather than "few".
    expect(new Intl.PluralRules("pl").select(2)).toBe("few");
  });

  it("picks English's one/other by the locale's rule, not by n === 1", () => {
    const forms = { one: "{n} chapter", other: "{n} chapters" };
    expect(plural(0, forms)).toBe("0 chapters");
    expect(plural(1, forms)).toBe("1 chapter");
    expect(plural(2, forms)).toBe("2 chapters");
    expect(plural(11, forms)).toBe("11 chapters");
  });

  it("picks a third form where the locale has one", () => {
    // Polish: 1 → one, 2–4 → few, 5+ → many. A two-branch English ternary
    // cannot produce "2 rozdziały" and "5 rozdziałów" from the same table.
    const forms = {
      one: "{n} rozdział",
      few: "{n} rozdziały",
      many: "{n} rozdziałów",
      other: "{n} rozdziału",
    };
    expect(plural(1, forms, "pl")).toBe("1 rozdział");
    expect(plural(2, forms, "pl")).toBe("2 rozdziały");
    expect(plural(5, forms, "pl")).toBe("5 rozdziałów");
  });

  it("falls back to `other` for a category the table does not carry", () => {
    // A partly-translated table: Russian selects "few" at 2, and this table
    // has no "few". The fallback is what keeps a real sentence on screen
    // instead of "undefined".
    const forms = { one: "{n} глава", other: "{n} глав" };
    expect(plural(2, forms, "ru")).toBe("2 глав");
    expect(plural(1, forms, "ru")).toBe("1 глава");
  });

  it("uses `other` for a locale with no count distinction at all", () => {
    const forms = { one: "{n} chapter", other: "{n} chapters" };
    // Japanese has the single category "other" for every count.
    expect(plural(1, forms, "ja")).toBe("1 chapters");
  });

  it("replaces every {n}, not only the first", () => {
    expect(plural(3, { other: "{n} of {n}" })).toBe("3 of 3");
  });

  it("renders the count in ASCII digits, never the locale's own", () => {
    // Deliberate, and the reason is in `plural`'s docblock: `formatDuration`
    // keeps the clock ASCII "because digits read across scripts", and a plural
    // fix is not the place to restyle every count in the app. `ar-EG` is the
    // locale that would otherwise produce Arabic-Indic digits.
    expect(plural(3, { one: "{n}", other: "{n}" }, "ar-EG")).toBe("3");
  });

  it("leaves a form with no {n} in it alone", () => {
    expect(plural(1, { one: "No chapters yet", other: "{n} chapters" })).toBe(
      "No chapters yet"
    );
  });
});

/**
 * The shipped locale is stated once, in `lib/locale.ts` (#697), and `plural`
 * takes its default from there rather than carrying an `"en"` of its own.
 *
 * Read as source with comments stripped, not by calling `plural`: a call can
 * only show that the default BEHAVES like English today, which an independent
 * `"en"` literal would satisfy just as well — the defect is a second place to
 * edit, and only the source shows that. Comments are stripped because this
 * module's prose has to be free to discuss the tag it must not hard-code, and
 * AGENTS.md records both directions of that trap: a whole-file regex that
 * false-hits on the prose banning what it searches for, and the repair of
 * weakening the pattern until it can no longer catch a real leak.
 */
describe("plural's default locale", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../src/lib/plural.ts"),
    "utf8"
  );
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("reads the shipped locale instead of naming a language itself", () => {
    expect(code).toMatch(/SHIPPED_LOCALE\.tag/);
    expect(code).toContain('from "./locale"');
  });

  it("hard-codes no language tag of its own", () => {
    // Guards the comment-stripping too: if it ever stops working, the
    // docblocks above (which name "en" in prose, legitimately) reappear here
    // and this fails loudly rather than the case silently passing on nothing.
    expect(code).not.toMatch(/["'][a-z]{2}(-[A-Za-z]+)*["']/);
  });

  it("selects by English rules at a count where other languages disagree", () => {
    const forms = { one: "{n} chapter", other: "{n} chapters" };
    expect(plural(1, forms)).toBe("1 chapter");
    // 21 is the discriminator, and the reason n=1 alone was not one (George
    // r2 Low 1). English cardinal selects `other` at 21; RUSSIAN selects
    // `one` there, as it does at 31 and 101. So a `ru` default passes the
    // n=1 line above and still renders "21 chapter" from the English `one`
    // form, which is what this line catches — where a case stopping at 1
    // asserted only that SOME locale maps 1 to `one`, which they all do.
    //
    // It does NOT catch every wrong default, and naming which is the point
    // (George r3). Polish at 21 is `many`, not `one` — the same rule line 37
    // states — so a `pl` default misses this two-key table, falls back to
    // `other`, and returns "21 chapters" untouched. An earlier version of
    // this comment claimed Polish selects `one` at 21, contradicting line 37
    // and overstating what the assertion proves. The source scans above are
    // what pin the tag itself; this line pins behaviour for the family of
    // defaults a scan alone would not reveal.
    expect(plural(21, forms)).toBe("21 chapters");
  });
});
