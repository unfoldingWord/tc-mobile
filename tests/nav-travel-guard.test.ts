import { describe, expect, it } from "vitest";

import {
  beginBack,
  initialTravelGuardState,
  settleBack,
  type TravelGuardState,
} from "@/lib/nav/travel-guard";

/**
 * Amendment A's any-outstanding travel-guard rule (docs/design/back-navigation.md,
 * superseded 2026-09-18 — PR #492 round 4, answers #493). Replaces the
 * original per-issuer 2x2 matrix: a request is refused whenever EITHER
 * `goBackOutstanding` or `commitCloseOutstanding` is already true, regardless
 * of which issuer is asking. This is the regression test for
 * R2-G-P2-1 / R2-G-P2-2 / R3-G-P2-1's class (the per-issuer version already
 * closed) AND for #493's cross-issuer `history.back()` coalescing question
 * (closed here by removing the possibility of two outstanding calls at once,
 * rather than reasoning about which physical entries they target).
 */
describe("beginBack — the any-outstanding travel-guard rule (answers #493)", () => {
  it("nothing outstanding — either issuer proceeds and sets its own flag", () => {
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

  it("same-issuer request while outstanding — refused, state unchanged", () => {
    const state: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    };
    const anotherGoBack = beginBack(state, "go-back");
    expect(anotherGoBack.ok).toBe(false);
    expect(anotherGoBack.next).toEqual(state);
  });

  /**
   * #493 (PR #492 round 4): the ORIGINAL per-issuer matrix let a
   * DIFFERENT issuer proceed while the other had an outstanding call, on
   * the reasoning that `goBack` and the recorder's commit-close exit target
   * different physical history entries and so "do not contend." Frank kept
   * finding that this addresses only LOGICAL contention, not BROWSER-API
   * contention: two `window.history.back()` calls issued before the
   * first one's `popstate` has landed can coalesce in some browsers,
   * independent of which entries they logically target. The any-outstanding
   * rule closes this by refusing a cross-issuer request too — these two rows
   * are the ones that change shape from the retired per-issuer matrix (row 2
   * there let the second of these two proceed).
   */
  it("cross-issuer request while the OTHER issuer is outstanding — refused, both directions (answers #493)", () => {
    const goBackOutstanding: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    };
    const commitCloseWhileGoBackOutstanding = beginBack(
      goBackOutstanding,
      "commit-close"
    );
    expect(commitCloseWhileGoBackOutstanding.ok).toBe(false);
    expect(commitCloseWhileGoBackOutstanding.next).toEqual(goBackOutstanding);

    const commitCloseOutstanding: TravelGuardState = {
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    };
    const goBackWhileCommitCloseOutstanding = beginBack(
      commitCloseOutstanding,
      "go-back"
    );
    expect(goBackWhileCommitCloseOutstanding.ok).toBe(false);
    expect(goBackWhileCommitCloseOutstanding.next).toEqual(
      commitCloseOutstanding
    );
  });

  it("both outstanding — a request from either issuer is refused entirely", () => {
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

  it("settle then request — proceeds once the ONLY outstanding call has settled", () => {
    const begun = beginBack(initialTravelGuardState, "go-back");
    expect(begun.ok).toBe(true);
    const settled = settleBack(begun.next, "go-back");
    const nextRequest = beginBack(settled, "commit-close");
    expect(nextRequest.ok).toBe(true);
  });

  it("settle then request — still refused if a DIFFERENT issuer is still outstanding after the settle", () => {
    // Both outstanding, settle only goBack: commitClose is still up, so a
    // fresh request from either issuer must still be refused.
    const bothOutstanding: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    };
    const afterGoBackSettles = settleBack(bothOutstanding, "go-back");
    expect(afterGoBackSettles).toEqual({
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    });
    const goBackRetry = beginBack(afterGoBackSettles, "go-back");
    expect(goBackRetry.ok).toBe(false);
  });
});

describe("settleBack", () => {
  it("clears only the settled issuer's flag, leaving the other untouched — settle still requires naming which issuer settled", () => {
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
