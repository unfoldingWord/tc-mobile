import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/en";
import { DEFAULT_LOCALE, LOCALE_META, type Locale } from "@/lib/i18n/locale";
import { plural } from "@/lib/i18n/plural";
import { strings } from "@/lib/i18n/strings";

/**
 * The seam that makes a second UI language a data change (#169).
 *
 * What is under test is not the English wording — that is the catalog's own
 * business and most of it is pinned by the screens' tests. It is the three
 * structural promises the seam makes: the active locale resolves to a catalog,
 * a counted phrase asks the locale's plural rules rather than an English
 * ternary, and no counted phrase is built by gluing a number onto a noun.
 */
describe("the locale seam (#169)", () => {
  it("resolves `strings` to the active locale's catalog", () => {
    expect(DEFAULT_LOCALE).toBe<Locale>("en");
    expect(strings).toBe(en);
  });

  it("gives every locale a BCP-47 tag and a direction", () => {
    for (const [locale, meta] of Object.entries(LOCALE_META)) {
      expect(meta.tag, locale).toMatch(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/);
      expect(["ltr", "rtl"], locale).toContain(meta.dir);
    }
  });
});

describe("plural (#169)", () => {
  it("picks the form the locale's own rules name, and fills {n}", () => {
    const forms = { one: "{n} chapter", other: "{n} chapters" };
    expect(plural("en", 1, forms)).toBe("1 chapter");
    expect(plural("en", 2, forms)).toBe("2 chapters");
    // English puts zero in `other`, which is exactly the kind of fact a
    // hand-written `=== 1` ternary gets right by accident and a `< 2` one does
    // not.
    expect(plural("en", 0, forms)).toBe("0 chapters");
  });

  it("falls back to `other` for a category the phrase has no form for", () => {
    // A catalog for a language with `few`/`many` will have phrases that spell
    // out only some of them. The fallback has to be a readable sentence, never
    // `undefined` painted onto a control.
    expect(plural("en", 3, { other: "{n} chapters" })).toBe("3 chapters");
  });

  it("replaces every {n} in a form, not only the first", () => {
    expect(plural("en", 2, { other: "{n} of {n}" })).toBe("2 of 2");
  });
});

describe("the catalog's counted phrases (#169)", () => {
  // Each of these used to be an `n === 1 ? … : …` written into the table. The
  // assertion is per phrase rather than over the table, because what could go
  // wrong is a form that forgets its `{n}` — which no structural check sees.
  it("counts chapters on a shelf row", () => {
    expect(strings.bookRow("Mark", 1, false)).toBe(
      "Mark, 1 chapter, collapsed"
    );
    expect(strings.bookRow("Mark", 3, true)).toBe("Mark, 3 chapters, expanded");
    expect(strings.bookRow("Mark", 0, false)).toBe(
      "Mark, 0 chapters, collapsed"
    );
  });

  it("counts the segments and chapters a share could not include", () => {
    expect(strings.shareMissing(1)).toBe("1 segment could not be included.");
    expect(strings.shareMissing(2)).toBe("2 segments could not be included.");
    expect(strings.shareBookMissing(1)).toBe(
      "1 chapter could not be included."
    );
    expect(strings.shareBookMissing(4)).toBe(
      "4 chapters could not be included."
    );
  });

  it("counts recorded problems, in the marker and in the menu's own name", () => {
    expect(strings.failuresMarker(1)).toBe("1 problem recorded");
    expect(strings.failuresMarker(2)).toBe("2 problems recorded");
    expect(strings.menuOpenWithFailures(1)).toBe(
      "Open menu. 1 problem recorded."
    );
    expect(strings.menuOpenWithFailures(5)).toBe(
      "Open menu. 5 problems recorded."
    );
  });

  it("renders a book's default name from its number, padded to three digits", () => {
    expect(strings.bookName(1)).toBe("Book 001");
    expect(strings.bookName(42)).toBe("Book 042");
    expect(strings.bookName(1000)).toBe("Book 1000");
    // The heading prefers the facilitator's own name, exactly as the chapter
    // twin does, and falls back to the rendered default.
    expect(strings.bookHeading("Mark", 1)).toBe("Mark");
    expect(strings.bookHeading(null, 7)).toBe("Book 007");
  });

  it("writes the recorder breadcrumb as one template, not three glued fragments", () => {
    // The separators and the order are the catalog's, not the component's —
    // which is the whole reason this stopped calling `chapterName` (#169).
    expect(strings.recorderBreadcrumb("Mark", 6, 2)).toBe(
      "Mark > Chapter 6 > 2"
    );
  });
});
