import { describe, expect, it } from "vitest";

import { storagePressureNotice } from "@/components/storage-pressure-notice";
import { strings } from "@/components/strings";

/**
 * What the Books shelf says for #247's storage-pressure marker.
 *
 * The whole gate is here, not just a tone lookup, for the same reason
 * `encoder-notice.test.ts` pins `encoderNotice` directly: this repo has no
 * DOM test runner, so a mount predicate left in JSX is pinned by nothing.
 * #540 is what this file exists to make impossible to repeat — the core PR's
 * (#537) own published example would have painted the band name on screen in
 * `Notice`'s default `alert` tone.
 */
describe("storagePressureNotice", () => {
  it("says nothing when there is no marker", () => {
    expect(storagePressureNotice(null)).toBeNull();
  });

  it("shows the low line", () => {
    expect(storagePressureNotice("low")).toEqual({
      tone: "info",
      text: strings.storageLow,
    });
  });

  it("shows the critical line", () => {
    expect(storagePressureNotice("critical")).toEqual({
      tone: "info",
      text: strings.storageCritical,
    });
  });

  it("is a heads-up, NOT a failure — never the alert tone", () => {
    // This is the exact defect #540 found in #537's published example: the
    // discriminant string type-checks as `Notice`'s children, and `Notice`
    // defaults `tone` to `"alert"` when a caller forgets to set one.
    expect(storagePressureNotice("low")?.tone).not.toBe("alert");
    expect(storagePressureNotice("critical")?.tone).not.toBe("alert");
  });

  it("never puts a raw byte count or percentage in front of a translator", () => {
    // pressure.ts's docblock: the estimate is coarse and per-origin, so
    // nothing may render the numbers it is computed from.
    const low = storagePressureNotice("low")?.text ?? "";
    const critical = storagePressureNotice("critical")?.text ?? "";
    expect(low).not.toMatch(/\d/);
    expect(critical).not.toMatch(/\d/);
  });
});
