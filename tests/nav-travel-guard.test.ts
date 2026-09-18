import { describe, expect, it } from "vitest";

import {
  beginBack,
  initialTravelGuardState,
  settleBack,
  settleOutstanding,
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

/**
 * `settleOutstanding` (#494 item 2, PR2): the adapter clears the guard at the
 * ONE place `App.tsx`'s live latch clears today — the top of the `popstate`
 * handler (`App.tsx:287-291`), which runs on EVERY landing and has no notion
 * of WHICH issuer settled. `settleBack` is per-issuer; refusal (`beginBack`)
 * is any-issuer since #492 round 4. A literal port of the old undifferentiated
 * latch to `settleBack(state, "go-back")` at that site leaves
 * `commitCloseOutstanding` stuck after the first recorder Back, so every later
 * `beginBack` — from either issuer — is refused and on-screen Back is dead for
 * the session. `settleOutstanding` is the landing settle: it clears the whole
 * guard back to `initialTravelGuardState`, so the next `beginBack` proceeds.
 *
 * It is defined TOTAL — it returns `initialTravelGuardState` for ANY input,
 * including the both-set state — rather than "clear whichever single flag is
 * set". The both-set state is unreachable THROUGH `beginBack` under the
 * any-outstanding rule (a second `beginBack` is refused before a second flag
 * can be set), but it is a legal value of the two-boolean type and the suite
 * already constructs it (the `both outstanding` rows above), so totality must
 * not lean on that invariant.
 */
describe("settleOutstanding — the any-issuer landing settle (#494 item 2)", () => {
  it("clears a single outstanding flag, from either issuer, back to the initial state", () => {
    const goBackOnly: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    };
    expect(settleOutstanding(goBackOnly)).toEqual(initialTravelGuardState);

    const commitCloseOnly: TravelGuardState = {
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    };
    expect(settleOutstanding(commitCloseOnly)).toEqual(initialTravelGuardState);
  });

  it("is a no-op on the already-clear initial state", () => {
    expect(settleOutstanding(initialTravelGuardState)).toEqual(
      initialTravelGuardState
    );
  });

  it("clears the both-set state too — totality does not rely on beginBack's any-outstanding invariant", () => {
    // The both-set state is unreachable through beginBack, but it is a legal
    // value of the two-boolean type (and the `both outstanding` rows above
    // construct it), so settleOutstanding must clear it unconditionally rather
    // than assume at most one flag is ever set.
    const bothOutstanding: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: true,
    };
    expect(settleOutstanding(bothOutstanding)).toEqual(initialTravelGuardState);
  });

  it("#494 item 2 negative pin: the naive settleBack(state,'go-back') port leaves commit-close stuck and refuses every later beginBack; settleOutstanding does not", () => {
    // The live latch site (App.tsx:287-291) settles on EVERY popstate with no
    // issuer. After a successful recorder Back, the guard is:
    const commitCloseOutstanding: TravelGuardState = {
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    };

    // The wrong port — settleBack(state, "go-back") — clears the flag that is
    // NOT set and leaves commitCloseOutstanding stuck true.
    const afterNaivePort = settleBack(commitCloseOutstanding, "go-back");
    expect(afterNaivePort).toEqual(commitCloseOutstanding); // unchanged; still stuck
    // …so every later beginBack — from EITHER issuer — is refused for the rest
    // of the session (on-screen Back dead).
    expect(beginBack(afterNaivePort, "go-back").ok).toBe(false);
    expect(beginBack(afterNaivePort, "commit-close").ok).toBe(false);

    // settleOutstanding is the fix: it clears the outstanding flag whichever
    // issuer set it, and the next beginBack proceeds.
    const afterLandingSettle = settleOutstanding(commitCloseOutstanding);
    expect(afterLandingSettle).toEqual(initialTravelGuardState);
    expect(beginBack(afterLandingSettle, "go-back").ok).toBe(true);
    expect(beginBack(afterLandingSettle, "commit-close").ok).toBe(true);
  });
});
