import { describe, expect, it } from "vitest";

import { encoderNotice } from "@/components/encoder-notice";
import { strings } from "@/lib/i18n/strings";

/**
 * What the Books shelf says when the encoder has stopped working (#166).
 *
 * The WHOLE gate is here, not just a tone lookup — the same call
 * `processing-status.ts` makes, and for the same reason: this repo has no DOM
 * test runner, so a mount predicate left in JSX is pinned by nothing. Three
 * claims, each of which a wrong line in `books-screen.tsx` would break silently:
 * a healthy encoder shows NOTHING, a failing one shows exactly one line, and
 * that line wears the `info` mark rather than the red `alert` one.
 */
describe("encoderNotice", () => {
  it("says nothing while the encoder is healthy", () => {
    expect(encoderNotice("ok")).toBeNull();
  });

  it("shows the shelf line once the encoder has stopped working", () => {
    expect(encoderNotice("failing")).toEqual({
      tone: "info",
      text: strings.encoderFailing,
    });
  });

  it("is a heads-up, NOT a failure and NOT a wait", () => {
    // `alert` is reserved for something the translator just did going wrong, and
    // `busy` for work they are waiting on. Neither is true here: every recording
    // is safe, nothing is in flight, and a red line on the home screen for a
    // background condition teaches people to ignore red (notice-tone.ts).
    const notice = encoderNotice("failing");
    expect(notice?.tone).not.toBe("alert");
    expect(notice?.tone).not.toBe("busy");
  });

  it("never puts a cause or an error string in front of a translator", () => {
    // #172's rule, and #167's: raw browser text goes to the sink, never to the
    // shelf. The line names the condition and one thing that may help.
    const text = encoderNotice("failing")?.text ?? "";
    expect(text).not.toMatch(/error|Error|undefined|\bMP3\b|encoder/);
    expect(text.length).toBeGreaterThan(0);
  });
});
