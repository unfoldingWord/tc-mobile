import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

/**
 * A segment's label rides beside its ordinal, never in place of it (#591): the
 * ordinal is the wordless identifier and the export position, so a reader who
 * cannot read the label still has the number.
 *
 * The chapter part is supplied through `chapterHeading` rather than as a bare
 * number, because `recorderBreadcrumb` stopped resolving it itself (#169) — the
 * caller does, so a renamed chapter reaches this trail. Every expectation below
 * is unchanged: `chapterHeading(null, 6)` IS the default name this test always
 * asserted, so what it pins about the segment half is exactly what it pinned.
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
    expect(
      strings.recorderBreadcrumb(
        "Mark",
        strings.chapterHeading(null, 6),
        3,
        missing
      )
    ).toBe("Mark > Chapter 6 > 3");
  });

  it("puts the label after the ordinal", () => {
    expect(strings.segmentHeading(3, "verses 3–4")).toBe("3 · verses 3–4");
  });

  it("reaches the recorder breadcrumb after the ordinal", () => {
    expect(
      strings.recorderBreadcrumb(
        "Mark",
        strings.chapterHeading(null, 6),
        3,
        "verses 3–4"
      )
    ).toBe("Mark > Chapter 6 > 3 · verses 3–4");
    expect(
      strings.recorderBreadcrumb(
        "Mark",
        strings.chapterHeading(null, 6),
        3,
        null
      )
    ).toBe("Mark > Chapter 6 > 3");
  });
});
