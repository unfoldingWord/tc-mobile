import { describe, expect, it } from "vitest";

import { restartWideButtonClass } from "@/components/save-failed-armed";

/**
 * #1088 item 1 — the SaveFailed "S9" armed-Restart glyph, pure half.
 *
 * `restartArmed` is derived component state (`SaveFailed`'s own
 * `restartArmedAt === attempts`), set by a tap — unreachable through
 * `tests/render.ts`'s static markup, which brings no events
 * (`tests/save-failed.test.ts`'s own docblock says the same about this
 * screen's Send-log control). This table is where the fix is provable
 * without one.
 */
describe("restartWideButtonClass (#1088 S9)", () => {
  it("unarmed: the plain wide guide button, nothing else", () => {
    expect(restartWideButtonClass(false)).toBe("o4-err-wide");
  });

  it("armed: swaps to the armed variant — never the old red-on-blue text utility", () => {
    const className = restartWideButtonClass(true);
    expect(className).toBe("o4-err-wide o4-err-wide--armed");
    // The regression this table exists to close: a red TEXT utility layered
    // on top of the still-blue `.o4-err-wide` fill (S9). Also guards against
    // the fill class going missing on its own — an armed button with no base
    // `o4-err-wide` would drop the 280×84 wide-guide-button geometry too.
    expect(className).not.toMatch(/\btext-live\b/);
    expect(className).toMatch(/\bo4-err-wide\b/);
  });
});
