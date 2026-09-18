import { describe, expect, it } from "vitest";

import {
  beginBack,
  initialTravelGuardState,
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

  it("settle then request — proceeds once the outstanding call has settled", () => {
    const begun = beginBack(initialTravelGuardState, "go-back");
    expect(begun.ok).toBe(true);
    // The landing settle is issuer-blind (settleOutstanding) — the adapter's
    // popstate handler does not know which issuer's back() just landed.
    const settled = settleOutstanding(begun.next);
    const nextRequest = beginBack(settled, "commit-close");
    expect(nextRequest.ok).toBe(true);
  });
});

/**
 * `settleOutstanding` (#494 item 2, PR2): the adapter clears the guard at the
 * ONE place `App.tsx`'s live latch cleared today — the top of the `popstate`
 * handler (`backRequested.current = false`), which runs on EVERY landing and
 * has no notion of WHICH issuer settled. A per-issuer settle (the shape the
 * guard shipped with in #492) does not compose at that issuer-blind site:
 * always clearing `goBackOutstanding` leaves `commitCloseOutstanding` stuck
 * after the first recorder Back, so every later `beginBack` — from either
 * issuer — is refused and on-screen Back is dead for the session. That
 * per-issuer settle is DELETED with this PR (settleOutstanding is the sole
 * settle now — it has no src consumer, so its @pivotpending tag would be a
 * false claim); this block pins the issuer-blind landing settle that replaces
 * it. It clears the whole guard back to `initialTravelGuardState`, so the next
 * `beginBack` proceeds.
 *
 * It is defined TOTAL — it returns a both-flags-clear state for ANY input,
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

  it("#494 item 2 negative pin: a per-issuer go-back settle leaves commit-close stuck and refuses every later beginBack; settleOutstanding does not", () => {
    // The live latch site (top of the popstate handler) settles on EVERY
    // popstate with no issuer. After a successful recorder Back, the guard is:
    const commitCloseOutstanding: TravelGuardState = {
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    };

    // The wrong port — a per-issuer go-back settle (what settleBack(state,
    // "go-back") did before it was deleted, `{ ...state, goBackOutstanding:
    // false }`) — clears the flag that is NOT set and leaves
    // commitCloseOutstanding stuck true.
    const afterNaivePort: TravelGuardState = {
      ...commitCloseOutstanding,
      goBackOutstanding: false,
    };
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

  /**
   * The refused-commit-close DRAIN's pure sequence (PR2, objection #11). When
   * requestClose resolves while a `goBack` is still outstanding,
   * `beginBack("commit-close")` is REFUSED; the adapter records a one-slot
   * pending consume and drains it on the NEXT popstate landing — after
   * `settleOutstanding` has cleared the outstanding flag at the top of the
   * handler. This row pins the pure half of that drain: settle-then-proceed.
   * The pending-slot machinery itself is adapter code (hooks/use-nav-stack.ts),
   * review-only (no renderer), so only this sequence is asserted here.
   */
  it("drain: a commit-close refused while go-back is outstanding proceeds after settleOutstanding", () => {
    // A goBack is outstanding when requestClose resolves.
    const goBackOutstanding: TravelGuardState = {
      goBackOutstanding: true,
      commitCloseOutstanding: false,
    };
    // The settle back() is refused right now (any-outstanding) — this is why
    // the adapter must NOT drop it but queue it for the drain.
    expect(beginBack(goBackOutstanding, "commit-close").ok).toBe(false);

    // The goBack's popstate lands: settleOutstanding clears the guard at the
    // top of the handler. THEN the drain re-issues the commit-close settle,
    // which now proceeds.
    const afterLanding = settleOutstanding(goBackOutstanding);
    const drained = beginBack(afterLanding, "commit-close");
    expect(drained.ok).toBe(true);
    expect(drained.next).toEqual({
      goBackOutstanding: false,
      commitCloseOutstanding: true,
    });
  });
});
