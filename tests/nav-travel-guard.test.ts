import { describe, expect, it } from "vitest";

import {
  beginBack,
  initialTravelGuardState,
  settleBack,
  type TravelGuardState,
} from "@/lib/nav/travel-guard";

/**
 * Amendment A's exhaustive 2x2 outstanding-issuer matrix
 * (docs/design/back-navigation.md). Four rows, checked completely rather than
 * reasoned about — the same rigor the design says Model 3's own attack found
 * missing from a three-issuer arbitration scheme. This is the regression test
 * for R2-G-P2-1 / R2-G-P2-2 / R3-G-P2-1's class from the parked #430 review.
 */
describe("beginBack — Amendment A's travel-guard matrix", () => {
  it("row 1: neither outstanding — a request proceeds and sets its own flag", () => {
    const goBack = beginBack(initialTravelGuardState, "go-back");
    expect(goBack.ok).toBe(true);
    expect(goBack.next).toEqual({
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    });

    const commitClose = beginBack(initialTravelGuardState, "commit-close");
    expect(commitClose.ok).toBe(true);
    expect(commitClose.next).toEqual({
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    });
  });

  it("row 2: goBack outstanding, commitClose not — another goBack is refused, a commit-close proceeds independently", () => {
    const state: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    };

    const anotherGoBack = beginBack(state, "go-back");
    expect(anotherGoBack.ok).toBe(false);
    // Refused: state is unchanged, never mutated toward "proceeded".
    expect(anotherGoBack.next).toEqual(state);

    const commitClose = beginBack(state, "commit-close");
    expect(commitClose.ok).toBe(true);
    expect(commitClose.next).toEqual({
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    });
  });

  it("row 3: commitClose outstanding, goBack not — mirror of row 2", () => {
    const state: TravelGuardState = {
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    };

    const anotherCommitClose = beginBack(state, "commit-close");
    expect(anotherCommitClose.ok).toBe(false);
    expect(anotherCommitClose.next).toEqual(state);

    const goBack = beginBack(state, "go-back");
    expect(goBack.ok).toBe(true);
    expect(goBack.next).toEqual({
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    });
  });

  it("row 4: both outstanding — a third request is refused entirely, either issuer", () => {
    const state: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    };

    const goBack = beginBack(state, "go-back");
    expect(goBack.ok).toBe(false);
    expect(goBack.next).toEqual(state);

    const commitClose = beginBack(state, "commit-close");
    expect(commitClose.ok).toBe(false);
    expect(commitClose.next).toEqual(state);
  });
});

describe("settleBack", () => {
  it("clears only the settled issuer's flag, leaving the other untouched", () => {
    const both: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    };
    expect(settleBack(both, "go-back")).toEqual({
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    });
    expect(settleBack(both, "commit-close")).toEqual({
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    });
  });

  it("is idempotent — settling an already-clear flag is a no-op", () => {
    expect(settleBack(initialTravelGuardState, "go-back")).toEqual(
      initialTravelGuardState
    );
  });

  it("round-trips: begin then settle returns to the initial state", () => {
    const begun = beginBack(initialTravelGuardState, "commit-close");
    expect(begun.ok).toBe(true);
    expect(settleBack(begun.next, "commit-close")).toEqual(
      initialTravelGuardState
    );
  });
});
