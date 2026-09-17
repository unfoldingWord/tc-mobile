import { describe, expect, it } from "vitest";

import { resolveProbedPx } from "@/components/recorder-layout";

describe("resolveProbedPx (George R4 P3, #414 round 5)", () => {
  it("returns the resolved pixel value for a normal computed height", () => {
    expect(resolveProbedPx("50px", 50)).toBe(50);
    expect(resolveProbedPx("1px", 50)).toBe(1);
  });

  it("falls back when the probe could not resolve the token", () => {
    // An unresolved custom property's used height computes to "0px" — an
    // empty, absolutely-positioned div's content-based height under CSS's
    // `auto` fallback for a `var()`/`calc()` chain that could not be
    // resolved — not to `NaN`. This is the exact case the fallback exists
    // to catch: a bare `Number.isFinite` guard reads "0px" as a successful
    // measurement of zero and never falls back at all.
    expect(resolveProbedPx("0px", 50)).toBe(50);
  });

  it("falls back on a non-numeric or empty computed value", () => {
    expect(resolveProbedPx("auto", 50)).toBe(50);
    expect(resolveProbedPx("", 50)).toBe(50);
  });
});
