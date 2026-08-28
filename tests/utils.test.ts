import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/utils";

/**
 * `formatDuration` is the recorder clock. The property under test is width
 * stability, not just correctness: the live `.t-timer` is `tabular-nums`, so a
 * change in the STRING LENGTH shifts the clock mid-record (#94). Every value
 * from the first minute up to 99:59 must render five characters.
 */
describe("formatDuration", () => {
  it("zero-pads both fields", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(5_000)).toBe("00:05");
    expect(formatDuration(65_000)).toBe("01:05");
  });

  it("holds five characters across the 10:00 rollover (the #94 regression)", () => {
    // 9:59 → 10:00 was 4 chars → 5 chars unpadded, which grew the clock.
    expect(formatDuration(9 * 60_000 + 59_000)).toBe("09:59");
    expect(formatDuration(10 * 60_000)).toBe("10:00");
    expect(formatDuration(9 * 60_000 + 59_000)).toHaveLength(5);
    expect(formatDuration(10 * 60_000)).toHaveLength(5);
  });

  it("floors to whole seconds and clamps negatives to zero", () => {
    expect(formatDuration(1_999)).toBe("00:01");
    expect(formatDuration(-5_000)).toBe("00:00");
  });

  it("rolls minutes past 99 rather than truncating (accepted width growth)", () => {
    // No oral-translation segment reaches this; asserted so the behaviour is
    // recorded rather than assumed.
    expect(formatDuration(100 * 60_000)).toBe("100:00");
  });
});
