import { describe, expect, it } from "vitest";

import { TAKE_CAP_MS, takeCapStatus } from "@/lib/audio/take-cap";

const MINUTE = 60_000;

/**
 * The pure half of the take-length cap (#1005). The DRI's values ("Warn at 15,
 * seal at 20") are written as literals here on purpose, so moving a constant
 * is a visible change to this file as well.
 */
describe("takeCapStatus", () => {
  it("the cap is 20 minutes", () => {
    expect(TAKE_CAP_MS).toBe(20 * MINUTE);
  });

  it("a live take under 15:00 is neither near the limit nor at it", () => {
    expect(takeCapStatus(0, true)).toEqual({
      nearLimit: false,
      remainingMs: 20 * MINUTE,
      reached: false,
    });
    expect(takeCapStatus(15 * MINUTE - 1, true).nearLimit).toBe(false);
  });

  it("is near the limit from exactly 15:00, with the remaining time counting down", () => {
    expect(takeCapStatus(15 * MINUTE, true)).toEqual({
      nearLimit: true,
      remainingMs: 5 * MINUTE,
      reached: false,
    });
    expect(takeCapStatus(20 * MINUTE - 1, true).reached).toBe(false);
  });

  it("reaches the cap at exactly 20:00 and stays there past it, never going negative", () => {
    expect(takeCapStatus(20 * MINUTE, true)).toEqual({
      nearLimit: true,
      remainingMs: 0,
      reached: true,
    });
    expect(takeCapStatus(25 * MINUTE, true)).toEqual({
      nearLimit: true,
      remainingMs: 0,
      reached: true,
    });
  });

  it("a take that is not recording is never near or at the limit, whatever the clock says", () => {
    expect(takeCapStatus(25 * MINUTE, false)).toEqual({
      nearLimit: false,
      remainingMs: 20 * MINUTE,
      reached: false,
    });
  });
});
