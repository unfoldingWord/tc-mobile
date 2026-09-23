import { describe, expect, it } from "vitest";

import { strings } from "@/components/strings";

/**
 * A segment's label rides beside its ordinal, never in place of it (#591): the
 * ordinal is the wordless identifier and the export position, so a reader who
 * cannot read the label still has the number.
 */
describe("segment heading (#591)", () => {
  it("is the ordinal alone while unlabelled", () => {
    expect(strings.segmentHeading(3, null)).toBe("3");
  });

  it("is the ordinal alone when a stored row has no label key", () => {
    // A segment whose upgrade backfill never ran reads back with `label`
    // absent; the type says `string | null`, the store can still hand back
    // `undefined`.
    const missing = undefined as unknown as string | null;
    expect(strings.segmentHeading(3, missing)).toBe("3");
    expect(strings.recorderBreadcrumb("Mark", 6, 3, missing)).toBe(
      "Mark > Chapter 6 > 3"
    );
  });

  it("puts the label after the ordinal", () => {
    expect(strings.segmentHeading(3, "verses 3–4")).toBe("3 · verses 3–4");
  });

  it("reaches the recorder breadcrumb after the ordinal", () => {
    expect(strings.recorderBreadcrumb("Mark", 6, 3, "verses 3–4")).toBe(
      "Mark > Chapter 6 > 3 · verses 3–4"
    );
    expect(strings.recorderBreadcrumb("Mark", 6, 3, null)).toBe(
      "Mark > Chapter 6 > 3"
    );
  });
});
