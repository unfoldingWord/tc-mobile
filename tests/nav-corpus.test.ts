import { describe, expect, it } from "vitest";

import {
  backEffectFor,
  navDirection,
  popAction,
  resumeNavIndex,
} from "@/lib/nav/navigation";
import {
  beginBack,
  initialTravelGuardState,
  settleOutstanding,
} from "@/lib/nav/travel-guard";

/**
 * Corpus decision-table test (docs/design/back-navigation.md, "Test plan":
 * "one row per finding id from the six-round corpus... so the corpus itself
 * becomes the permanent regression suite rather than living only in triage
 * comments"). This file covers the findings enumerated in the design's own
 * "Resolving every surviving attack finding" table — the base model's own
 * attack findings (F1-F5) plus the still-possible replays it names
 * (R1-G-P3-3, R3-G-P3-2, R4-G-P3-5).
 *
 * Several of these findings are disposed by an ADAPTER change (PR2/PR3/PR4:
 * `hooks/use-nav-stack.ts`, the overlay catalogue's live-ref accessors,
 * per-overlay `Layer` construction) rather than by the pure core this PR
 * builds. Those rows are `it.todo`, named with the finding id and the reason,
 * per this PR's explicit instruction: "do not fake it." A `todo` row is not a
 * skipped assertion pretending to pass — it is a visible, named gap Vitest
 * reports every run, to be filled in the PR that actually builds the adapter
 * code the finding depends on.
 */
describe("Corpus decision table — 'Resolving every surviving attack finding'", () => {
  it.todo(
    "F1 (P1): layerStack has no unmount-safety net (Amendment C's fix — a centrally-owned cleanup effect in hooks/use-nav-stack.ts with dependency array [screen, recovering, databasePanel]) is adapter-level, React-lifecycle code. The pure core has no notion of a React unmount at all, so nothing in src/lib/nav can assert it. PR2 scope."
  );

  it("F2 (P2): the adapter's goBack and commit-close settle call beginBack/settleOutstanding (wired in PR2, hooks/use-nav-stack.ts) — a second same-issuer request is refused while the first is outstanding, and — since round 4's any-outstanding guard (answers #493) — so is a DIFFERENT issuer's request, not just the same one", () => {
    // As of PR2 the live issuers ARE these functions: use-nav-stack.ts's
    // `goBack` calls `beginBack("go-back")` in place of the old `backRequested`
    // latch, the commit-close settle calls `beginBack("commit-close")`, and
    // every popstate landing clears the guard with `settleOutstanding`. This
    // row pins the pure decision table those call sites compose; the DOM wiring
    // itself is review-only (no renderer — AGENTS.md).
    const firstGoBack = beginBack(initialTravelGuardState, "go-back");
    expect(firstGoBack.ok).toBe(true);

    // A second goBack landing before the first settles is refused, not
    // silently allowed to double-issue history.back().
    const secondGoBack = beginBack(firstGoBack.next, "go-back");
    expect(secondGoBack.ok).toBe(false);

    // Once the first settles, a fresh goBack is allowed again. The landing
    // settle is issuer-blind (settleOutstanding) — the adapter's popstate
    // handler clears the guard without naming which issuer landed.
    const settled = settleOutstanding(firstGoBack.next);
    const thirdGoBack = beginBack(settled, "go-back");
    expect(thirdGoBack.ok).toBe(true);

    // #493, answered round 4 (2026-09-18): the recorder's commit-close exit
    // is a DIFFERENT issuer, but ANY outstanding call now refuses a request
    // from either issuer — cross-issuer `history.back()` coalescing is no
    // longer possible, superseding Amendment A's original "different
    // physical entries do not contend" per-issuer table.
    const commitCloseWhileGoBackOutstanding = beginBack(
      thirdGoBack.next,
      "commit-close"
    );
    expect(commitCloseWhileGoBackOutstanding.ok).toBe(false);

    // Once goBack settles, the recorder's commit-close exit may proceed.
    const goBackSettled = settleOutstanding(thirdGoBack.next);
    const commitCloseAfterSettle = beginBack(goBackSettled, "commit-close");
    expect(commitCloseAfterSettle.ok).toBe(true);
  });

  it("F3 (P2): the adapter adopts the resumed index (wired in PR2, hooks/use-nav-stack.ts) so a reload mid-stack no longer misroutes the first post-reload Back as a phantom Forward, and does not skip a physical level (Amendment B)", () => {
    // Traced concretely in tests/nav-resume-index.test.ts; this row pins the
    // corpus-level claim about the PURE composition: adopting the resumed
    // index (instead of forcing 0) makes the landing read as "back", not
    // "forward". The adapter's mount effect now reads window.history.state and
    // adopts this index into BOTH refs; the composition is proven here, but the
    // DOM reload path itself is review-only (no renderer — AGENTS.md), not a
    // claim it has been exercised on a device.
    const adoptedAtMount = resumeNavIndex({ tc: true, index: 2 });
    const landingIndex = resumeNavIndex({ tc: true, index: 1 });
    expect(navDirection(adoptedAtMount, landingIndex)).toBe("back");
    // Without the fix (baseline forced to 0 regardless of the real stack),
    // the same landing would read as "forward" — navDirection(0, 1).
    expect(navDirection(0, landingIndex)).toBe("forward");

    // George R2 P2-2 (PR #492): the contract requires BOTH navIndex AND
    // nextIndex adopt this same value — pushHistoryEntry stamps only from
    // `++nextIndex.current`. Proved against the real stamp path, not just
    // navDirection: a nextIndex correctly seeded at the adopted value stamps
    // the next push one above it, and the following Back reads "back"; a
    // nextIndex left at 0 (the mis-wire the adapter avoids) stamps BELOW the
    // adopted value and the following Back misreads as "forward" — F3 again,
    // one push later. See tests/nav-resume-index.test.ts for the dedicated
    // positive/negative pair.
    const correctlySeededNextIndex = adoptedAtMount;
    expect(navDirection(correctlySeededNextIndex + 1, adoptedAtMount)).toBe(
      "back"
    );
    const misWiredNextIndex = 0;
    expect(navDirection(misWiredNextIndex + 1, adoptedAtMount)).toBe("forward");
  });

  it.todo(
    "F4 (P2): the overlay catalogue's new live-ref accessors (isSavingBookName(), isDeleting(), isSavingChapterName(), etc.) are net-new adapter plumbing in use-books.ts / use-erase-segment.ts's siblings — the pure core only specifies THAT Layer.busy() must be ref-backed (invariant 4), never which hook builds the ref. PR3/PR4 scope."
  );

  it("F5 / R4-G-P3-5 (P3): the originally-proposed numeric-displacement clamp (invariant 10) is dropped, not built — no numeric magnitude is threaded through to popAction at all, so there was never anything for a clamp to attach to; Amendment A's exhaustively-enumerated 2-boolean matrix (see the F2 row above) is the replacement", () => {
    // navDirection already collapses any magnitude to a tri-state before
    // popAction ever sees it — a jump of 1 and a jump of 4 read identically.
    expect(navDirection(5, 1)).toBe(navDirection(2, 1));
    expect(navDirection(5, 1)).toBe("back");
    // popAction's decision for "back" depends only on that tri-state, never
    // on how far the index moved.
    expect(popAction("back", "books", false, false)).toBe(
      backEffectFor("books")
    );
  });

  it.todo(
    "R1-G-P3-3 (still-possible): a Layer's id/busy() must resolve against the live entity (e.g. the shelf-resolved book), never a stale stored id — this is a documented PR3/PR4 review-checklist discipline (see Residual Risks), not a property the pure Layer/LayerStack type can enforce or that a test can observe without a concrete overlay's own entity-resolution code. PR3/PR4 scope."
  );

  it("R3-G-P3-2: PR2 DRAINS the refused commit-close consume, it does not drop it — the pure settle-then-proceed sequence the adapter composes", () => {
    // travel-guard.ts's beginBack REFUSES a second request while one is
    // outstanding; it does not queue one. When the recorder's commit-close
    // settle is refused because a goBack is still outstanding, PR2's adapter
    // (hooks/use-nav-stack.ts) does NOT drop that settle — it records a
    // one-slot pending consume and DRAINS it on the next popstate landing,
    // after settleOutstanding clears the guard, reproducing develop's
    // two-traversal end state. The pending-slot machinery is adapter code
    // (review-only, no renderer); the pure sequence it composes is pinned here
    // and in tests/nav-travel-guard.test.ts.
    const goBackOutstanding = beginBack(
      initialTravelGuardState,
      "go-back"
    ).next;
    // The settle is refused right now — this is the moment the adapter records
    // the pending consume rather than dropping it.
    expect(beginBack(goBackOutstanding, "commit-close").ok).toBe(false);
    // Next landing: settleOutstanding clears the guard, and the drain's
    // re-issued settle proceeds.
    const drained = beginBack(
      settleOutstanding(goBackOutstanding),
      "commit-close"
    );
    expect(drained.ok).toBe(true);
  });
});
