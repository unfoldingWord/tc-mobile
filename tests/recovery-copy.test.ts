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

  it("names what is NEEDED for a downgrade, not what went wrong", () => {
    // The one failure a Retry can never clear: a newer copy has moved the data
    // past this build. "could not be saved" reads as a blip that might go the
    // other way next time, which is the implication this line exists to avoid
    // (George R1 P2-1).
    expect(recoveryTitle("downgrade", false)).toBe(
      "This recording needs the new version of the app."
    );
    expect(recoveryTitle("downgrade", true)).toBe(
      "Your changes need the new version of the app."
    );
    for (const editOnly of [false, true]) {
      expect(recoveryTitle("downgrade", editOnly)).not.toMatch(
        /try again|could not be saved/i
      );
    }
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

  it("does NOT forbid the restart on a downgrade — the one case where staying cannot help", () => {
    // Every other failure keeps the translator in the app because the take is
    // RAM-only and leaving risks the OS discarding it. Here the premise fails:
    // this build cannot open the store at all, so "Don't close the app" forbids
    // the only thing that helps, while the title asks for exactly that
    // (George R2 P2-1).
    for (const editOnly of [false, true]) {
      const line = recoverySafetyLine(editOnly, "downgrade");
      expect(line).not.toMatch(/don't close|do not close/i);
      expect(line.toLowerCase()).toContain("restart");
    }
    // The retryable kinds keep the warning, including when the kind is unknown
    // at the call site.
    for (const kind of ["quota", "unknown", null] as const) {
      expect(recoverySafetyLine(false, kind).toLowerCase()).toContain(
        "close the app"
      );
    }
  });

  it("words the warning for everything RAM-only, not just the new fragment (George G1, G5)", () => {
    // A record-path save rolls back on failure, so the prior take survives on
    // disk — but the working buffer being saved can also carry in-session cuts
    // (Model A), which Discard drops. "your unsaved work" covers the new
    // recording AND those edits; it must not narrow to just the recording.
    expect(recoverySafetyLine(false)).toContain("unsaved work");
    expect(recoverySafetyLine(false)).not.toContain(
      "only copy of this recording"
    );
    expect(recoverySafetyLine(false)).not.toContain("what you just recorded");
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

  it("never shows a count for a downgrade — the count would be a nudge to retry", () => {
    // Stronger than the quota case: there the next attempt might land once space
    // is freed, here it cannot land at all, so a rising count is an invitation
    // to keep trying something that is already decided.
    expect(recoveryAttempts("downgrade", 2)).toBeNull();
    expect(recoveryAttempts("downgrade", 9)).toBeNull();
  });
});
