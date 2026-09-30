/**
 * Drag down to close a half-screen sheet (#1268), the pure half.
 *
 * The requirements owner's decision on #1268: "it should work as drag down
 * to close." `menu.tsx` owns the pointer and the panel; this file only
 * decides, from numbers the caller hands in, how far the sheet follows the
 * finger and whether a release closes it or springs it back. It holds no
 * DOM, so it runs in plain Node (`tests/sheet-drag.test.ts`).
 *
 * All positions are viewport `clientY` in CSS px (down is positive) and all
 * times are event timestamps in ms.
 */

/** How far down the sheet must be dragged for a slow release to close it. */
export const SHEET_CLOSE_DISTANCE_PX = 96;
/**
 * The share of the sheet's own height that also closes it, whichever of this
 * and {@link SHEET_CLOSE_DISTANCE_PX} is smaller — so a short sheet (a
 * one-row ask) closes at 40% of its own height.
 */
const SHEET_CLOSE_FRACTION = 0.4;
/** A downward flick at or above this speed closes, in px per ms. */
export const SHEET_FLING_VELOCITY = 0.5;
/** A flick must still have moved the sheet this far, so a jitter is not a close. */
export const SHEET_FLING_MIN_PX = 24;
/** A release this long after the last move is a stop, not a flick. */
export const SHEET_VELOCITY_STALE_MS = 100;

/**
 * How far the sheet follows the finger. Only down: an upward drag leaves the
 * sheet where it rests rather than lifting it off its docked edge.
 */
export function sheetDragOffset(startY: number, y: number): number {
  return Math.max(0, y - startY);
}

/** One pointer sample. */
export interface SheetDragSample {
  readonly y: number;
  readonly t: number;
}

/**
 * The speed between two samples, in px per ms (down is positive). Two
 * samples at the same time keep the speed already known rather than divide
 * by zero.
 */
export function sheetDragVelocity(
  prev: SheetDragSample,
  next: SheetDragSample,
  known: number
): number {
  const dt = next.t - prev.t;
  return dt > 0 ? (next.y - prev.y) / dt : known;
}

/** The distance that closes a sheet of this height on a slow release. */
export function sheetCloseDistance(sheetHeight: number): number {
  return sheetHeight > 0
    ? Math.min(SHEET_CLOSE_DISTANCE_PX, sheetHeight * SHEET_CLOSE_FRACTION)
    : SHEET_CLOSE_DISTANCE_PX;
}

export interface SheetRelease {
  /** {@link sheetDragOffset} at the release. */
  readonly offset: number;
  /** The last measured speed, px per ms. */
  readonly velocity: number;
  /** When the last move arrived. */
  readonly lastMoveAt: number;
  /** When the finger lifted. */
  readonly releasedAt: number;
  /** The sheet's height in px; 0 when it could not be measured. */
  readonly sheetHeight: number;
}

/**
 * What a release does: `"close"` goes through the sheet's own close path,
 * `"restore"` springs it back. A fast flick up restores even past the
 * distance (the finger changed its mind); a fast flick down closes once it
 * has moved {@link SHEET_FLING_MIN_PX}; otherwise the distance decides.
 */
export function sheetDragRelease(release: SheetRelease): "close" | "restore" {
  const velocity =
    release.releasedAt - release.lastMoveAt > SHEET_VELOCITY_STALE_MS
      ? 0
      : release.velocity;
  if (velocity <= -SHEET_FLING_VELOCITY) return "restore";
  if (velocity >= SHEET_FLING_VELOCITY && release.offset >= SHEET_FLING_MIN_PX)
    return "close";
  return release.offset >= sheetCloseDistance(release.sheetHeight)
    ? "close"
    : "restore";
}
