import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { TakeCapMarker } from "@/components/take-cap-marker";
import { strings } from "@/lib/strings";
import { TAKE_CAP_MS, takeCapStatus } from "@/lib/audio/take-cap";

import { render } from "./render";

/**
 * #1005 residual (i): the 15:00 warning was never drawn, and the v0.2.13
 * tester notes told testers so. This is the render-harness half of closing
 * it — `tests/take-cap.test.ts` already proves `takeCapStatus`'s own
 * thresholds; this file proves the MARKER renders (or does not) for what that
 * status reports, the same split `tests/recorder-status.test.ts` draws
 * between `recorderStatusKind` and `RecorderStatus`.
 *
 * Each case drives `TakeCapMarker` through the real `takeCapStatus`, not a
 * hand-built `TakeCapStatus` object, so a drift in the pure module's own
 * thresholds shows up here too rather than only in its own test file.
 * `TakeCapMarker` takes only `takeCap` (see its docblock for why there is no
 * separate `recording` prop to pass) — `recording` here drives `takeCapStatus`
 * itself, which is where "is this a live take" is actually decided.
 */
function markerFor(elapsedMs: number, recording: boolean) {
  return render(
    createElement(TakeCapMarker, {
      takeCap: takeCapStatus(elapsedMs, recording),
    })
  );
}

function markerText(container: Element): string | null {
  return (
    container.querySelector("[data-testid='take-cap-marker']")?.textContent ??
    null
  );
}

describe("the take-cap marker", () => {
  it("is absent below 15:00 of a live take", () => {
    const container = markerFor(14 * 60_000 + 59_000, true);
    expect(markerText(container)).toBe(null);
  });

  it("is present from exactly 15:00, while recording", () => {
    // 5:00 left at exactly 15:00 in.
    expect(markerText(markerFor(15 * 60_000, true))).toBe(
      strings.takeCapWarning(5)
    );
  });

  it("rounds a mid-minute remainder UP, not down", () => {
    // 15:30 in: 4:30 left. Flooring would read "4 min left" — the wrong
    // direction for a warning, which should never claim MORE time is left
    // than there actually is.
    expect(markerText(markerFor(15 * 60_000 + 30_000, true))).toBe(
      strings.takeCapWarning(5)
    );
  });

  it("counts down past 15:00, up to just under the cap", () => {
    // 19:01 in: 0:59 left, which rounds up to 1, never down to 0 — "0 min
    // left" reads as already over.
    expect(markerText(markerFor(19 * 60_000 + 1000, true))).toBe(
      strings.takeCapWarning(1)
    );
  });

  it("clamps to 1 minute rather than 0 once the cap is reached", () => {
    // At the cap itself `takeCapStatus` reports `remainingMs: 0`; the label
    // still reads "1 min left" rather than "0 min left" for the same reason.
    expect(markerText(markerFor(TAKE_CAP_MS, true))).toBe(
      strings.takeCapWarning(1)
    );
  });

  it("is absent when not recording, even at an elapsed time past 15:00", () => {
    // `takeCapStatus` freezes `elapsedMs` at its last value once a take stops,
    // rather than resetting it — so this is the case a bare `elapsedMs >=
    // 15:00` check would get wrong on a stopped or idle recorder.
    expect(markerText(markerFor(18 * 60_000, false))).toBe(null);
  });
});
