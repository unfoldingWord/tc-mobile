import { describe, expect, it } from "vitest";

import {
  recoveryAttempts,
  recoverySafetyLine,
  recoveryTitle,
} from "@/components/recovery-copy";

/**
 * The recovery-screen wording, isolated from the component so it can be exercised
 * in plain Node. The line that matters most (#38) is the safety line: once the
 * commit write is one transaction, a failed save is RAM-only whatever the cause,
 * so the screen must never send the translator out of the app to free space —
 * and must warn on every failed save, not only a quota one.
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

describe("recoverySafetyLine", () => {
  it("never instructs the translator to leave the app (#38)", () => {
    // The take is RAM-only once the commit write is one transaction, so the
    // recovery screen must not send them off to free space — that trip is what
    // discards the only copy. It takes no `kind`, so it warns on every failure,
    // not only quota (George G3).
    for (const editOnly of [false, true]) {
      const line = recoverySafetyLine(editOnly).toLowerCase();
      expect(line).not.toMatch(/free (up )?space|make room|then try again/);
      expect(line).toContain("only copy");
      expect(line).toContain("close the app");
    }
  });

  it("words the warning for what is actually RAM-only (George G1)", () => {
    // A record-path splice into a segment with an existing take leaves the prior
    // take on disk (saveTake rolls back on failure); only the newly recorded
    // audio is unsaved. The line must not claim the whole recording is at risk.
    expect(recoverySafetyLine(false)).toContain("what you just recorded");
    expect(recoverySafetyLine(false)).not.toContain(
      "only copy of this recording"
    );
    // The edit path's subject is the edited buffer.
    expect(recoverySafetyLine(true)).toContain("changes");
  });
});

describe("recoveryAttempts", () => {
  it("shows a count only for a repeated unknown failure", () => {
    // A one-off unknown blip carries no extra copy; the count is an extra line
    // beside the safety line, never a replacement for it.
    expect(recoveryAttempts("unknown", 1)).toBeNull();
    expect(recoveryAttempts("unknown", 2)).toBe("Attempts: 2");
  });

  it("never shows a count for a quota failure — the title already names the cause", () => {
    expect(recoveryAttempts("quota", 2)).toBeNull();
    expect(recoveryAttempts("quota", 5)).toBeNull();
  });
});
