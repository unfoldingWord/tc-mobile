import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/number-format";
import { plural } from "@/lib/plural";
import { formatDuration } from "@/lib/utils";

// Locales whose own convention is non-Latin digits.
const DIGIT_LOCALES = ["ar", "ar-EG", "hi", "bn", "fa", "mr", "ar-u-nu-arab"];

describe("formatNumber (R19: Arabic numerals everywhere)", () => {
  it.each(DIGIT_LOCALES)("prints 0-9 under %s", (locale) => {
    expect(formatNumber(1234567890, { locale })).toBe("1234567890");
    expect(formatNumber(7, { locale, minDigits: 3 })).toBe("007");
    expect(formatNumber(2.5, { locale, fractionDigits: 2 })).toMatch(
      /^2[.,]50$/
    );
  });

  it("is a stock integer in the default locale", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(1000)).toBe("1000");
    expect(formatNumber(7, { minDigits: 2 })).toBe("07");
    expect(formatNumber(1.5, { fractionDigits: 1 })).toBe("1.5");
  });
});

describe("call sites share the entry", () => {
  it("formatDuration is unchanged", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(9_999)).toBe("00:09");
    expect(formatDuration(600_000)).toBe("10:00");
    expect(formatDuration(6_000_000)).toBe("100:00");
  });

  it("plural writes Latin digits for a locale with its own digits", () => {
    expect(plural(1234, { other: "{n} x" }, "ar")).toBe("1234 x");
    expect(plural(3, { other: "{n} of {n}" }, "hi")).toBe("3 of 3");
  });
});
