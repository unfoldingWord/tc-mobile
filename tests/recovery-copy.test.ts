import { describe, expect, it } from "vitest";

import { recoveryHint, recoveryTitle } from "@/components/recovery-copy";

/**
 * The recovery-screen wording, isolated from the component so it can be exercised
 * in plain Node. The one line that matters most (#38) is the quota guidance: once
 * the commit write is one transaction, a failed save is RAM-only, so the screen
 * must never send the translator out of the app to free space.
 */
describe("recoveryTitle", () => {
  it("names the phone-full condition for a quota failure", () => {
    expect(recoveryTitle("quota", false)).toBe("No room left on this phone.");
    // The phone is full whether the held work is a recording or an edit.
    expect(recoveryTitle("quota", true)).toBe("No room left on this phone.");
  });

  it("names what could not be saved for an unknown failure", () => {
    expect(recoveryTitle("unknown", false)).toBe(
      "This recording could not be saved."
    );
    expect(recoveryTitle("unknown", true)).toBe(
      "Your changes could not be saved."
    );
  });
});

describe("recoveryHint", () => {
  it("never tells a quota-failed translator to leave the app (#38)", () => {
    // The recording is RAM-only once the commit write is one transaction, so the
    // recovery screen must not send them off to free space — that trip is what
    // discards the only copy. Guards every quota case, from the first failure on.
    for (const editOnly of [false, true]) {
      for (const attempts of [1, 2, 5]) {
        const hint = recoveryHint({ kind: "quota", editOnly, attempts });
        expect(hint).not.toBeNull();
        const lower = hint!.toLowerCase();
        expect(lower).not.toMatch(/free (up )?space|make room|then try again/);
        expect(lower).toContain("only copy");
        expect(lower).toContain("close the app");
      }
    }
  });

  it("warns from the first quota failure, not only after a retry", () => {
    expect(
      recoveryHint({ kind: "quota", editOnly: false, attempts: 1 })
    ).not.toBeNull();
  });

  it("words the quota warning for the held subject", () => {
    expect(
      recoveryHint({ kind: "quota", editOnly: false, attempts: 1 })
    ).toContain("recording");
    expect(
      recoveryHint({ kind: "quota", editOnly: true, attempts: 1 })
    ).toContain("changes");
  });

  it("shows an attempt count for a repeated unknown failure only", () => {
    // A one-off unknown blip carries no extra copy; a null kind (first attempt
    // still in flight has none) is treated the same.
    expect(
      recoveryHint({ kind: "unknown", editOnly: false, attempts: 1 })
    ).toBeNull();
    expect(
      recoveryHint({ kind: null, editOnly: false, attempts: 1 })
    ).toBeNull();
    expect(
      recoveryHint({ kind: "unknown", editOnly: false, attempts: 2 })
    ).toBe("Attempts: 2");
  });
});
