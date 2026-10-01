import { describe, expect, it } from "vitest";

import {
  SHEET_CLOSE_DISTANCE_PX,
  SHEET_FLING_MIN_PX,
  SHEET_FLING_VELOCITY,
  SHEET_VELOCITY_STALE_MS,
  sheetCloseDistance,
  sheetDragOffset,
  sheetDragRelease,
  sheetDragVelocity,
} from "@/components/sheet-drag";

/**
 * The pure half of drag down to close (#1268): how far a sheet follows the
 * finger and what a release does. `menu.tsx` owns the pointer; the mounted
 * gesture is `tests/sheet-close-o4.test.ts`.
 */

/** A release with everything settled except what a case sets. */
const release = (over: Partial<Parameters<typeof sheetDragRelease>[0]>) =>
  sheetDragRelease({
    offset: 0,
    velocity: 0,
    lastMoveAt: 1000,
    releasedAt: 1010,
    sheetHeight: 400,
    ...over,
  });

describe("sheetDragOffset", () => {
  it("follows a downward drag", () => {
    expect(sheetDragOffset(100, 160)).toBe(60);
  });
  it("does not lift the sheet on an upward drag", () => {
    expect(sheetDragOffset(100, 40)).toBe(0);
  });
});

describe("sheetDragVelocity", () => {
  it("is distance over time, down positive", () => {
    expect(sheetDragVelocity({ y: 0, t: 0 }, { y: 50, t: 100 }, 0)).toBe(0.5);
    expect(sheetDragVelocity({ y: 50, t: 0 }, { y: 0, t: 100 }, 0)).toBe(-0.5);
  });
  it("keeps the known speed for two samples at the same time", () => {
    expect(sheetDragVelocity({ y: 0, t: 5 }, { y: 9, t: 5 }, 0.3)).toBe(0.3);
  });
});

describe("sheetCloseDistance", () => {
  it("is the fixed distance on a tall sheet", () => {
    expect(sheetCloseDistance(600)).toBe(SHEET_CLOSE_DISTANCE_PX);
  });
  it("is a share of a short sheet", () => {
    expect(sheetCloseDistance(100)).toBe(40);
  });
  it("falls back to the fixed distance when the height is unknown", () => {
    expect(sheetCloseDistance(0)).toBe(SHEET_CLOSE_DISTANCE_PX);
  });
});

describe("sheetDragRelease", () => {
  it("springs back from a short, slow drag", () => {
    expect(release({ offset: SHEET_CLOSE_DISTANCE_PX - 1 })).toBe("restore");
  });
  it("closes a slow drag at the distance", () => {
    expect(release({ offset: SHEET_CLOSE_DISTANCE_PX })).toBe("close");
  });
  it("springs back from an upward drag", () => {
    expect(release({ offset: 0, velocity: -0.2 })).toBe("restore");
  });
  it("closes on a downward flick past the minimum", () => {
    expect(
      release({ offset: SHEET_FLING_MIN_PX, velocity: SHEET_FLING_VELOCITY })
    ).toBe("close");
  });
  it("does not close on a flick that barely moved", () => {
    expect(
      release({
        offset: SHEET_FLING_MIN_PX - 1,
        velocity: SHEET_FLING_VELOCITY * 2,
      })
    ).toBe("restore");
  });
  it("springs back on a fast flick up, even past the distance", () => {
    expect(
      release({
        offset: SHEET_CLOSE_DISTANCE_PX + 50,
        velocity: -SHEET_FLING_VELOCITY,
      })
    ).toBe("restore");
  });
  it("treats a release after a pause as a stop, not a flick", () => {
    expect(
      release({
        offset: SHEET_FLING_MIN_PX,
        velocity: SHEET_FLING_VELOCITY * 2,
        lastMoveAt: 1000,
        releasedAt: 1000 + SHEET_VELOCITY_STALE_MS + 1,
      })
    ).toBe("restore");
  });
  it("uses the short sheet's own distance", () => {
    expect(release({ offset: 40, sheetHeight: 100 })).toBe("close");
    expect(release({ offset: 39, sheetHeight: 100 })).toBe("restore");
  });
});
