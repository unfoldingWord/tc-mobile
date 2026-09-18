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
  settleBack,
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

  it("F2 (P2): the two remaining raw history.back() issuers (goBack, the recorder's commit-close exit) are now bookkept by a pure, tested travel-guard instead of unformalized adapter code (Amendment A) — the exact R2-G-P2-1 / R2-G-P2-2 / R3-G-P2-1 shape this closes", () => {
    const firstGoBack = beginBack(initialTravelGuardState, "go-back");
    expect(firstGoBack.ok).toBe(true);

    // A second goBack landing before the first settles is refused, not
    // silently allowed to double-issue history.back().
    const secondGoBack = beginBack(firstGoBack.next, "go-back");
    expect(secondGoBack.ok).toBe(false);

    // Once the first settles, a fresh goBack is allowed again.
    const settled = settleBack(firstGoBack.next, "go-back");
    const thirdGoBack = beginBack(settled, "go-back");
    expect(thirdGoBack.ok).toBe(true);

    // The recorder's commit-close exit is a DIFFERENT issuer and is not
    // blocked by an outstanding goBack (Amendment A's table, row 2).
    const commitCloseWhileGoBackOutstanding = beginBack(
      thirdGoBack.next,
      "commit-close"
    );
    expect(commitCloseWhileGoBackOutstanding.ok).toBe(true);
  });

  it("F3 (P2): IF the adapter adopts the resumed index (PR2, not yet wired — Frank R4 P2 on PR #492), a reload mid-stack would no longer misroute the first post-reload Back as a phantom Forward, and would not skip a physical level (Amendment B)", () => {
    // Traced concretely in tests/nav-resume-index.test.ts; this row pins the
    // corpus-level claim about the PURE composition: adopting the resumed
    // index (instead of forcing 0) makes the landing read as "back", not
    // "forward". `App.tsx`'s mount effect does not adopt it yet (unchanged,
    // `App.tsx:85-89`) — that wiring is PR2 — so this is a composition proof
    // for PR2 to reproduce, not a claim the live reload defect is fixed.
    const adoptedAtMount = resumeNavIndex({ tc: true, index: 2 });
    const landingIndex = resumeNavIndex({ tc: true, index: 1 });
    expect(navDirection(adoptedAtMount, landingIndex)).toBe("back");
    // Without the fix (baseline forced to 0 regardless of the real stack),
    // the same landing would read as "forward" — navDirection(0, 1).
    expect(navDirection(0, landingIndex)).toBe("forward");
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

  it.todo(
    "R3-G-P3-2 (still-possible): latest-wins queued-intent drop is an accepted risk, not eliminated by this design — travel-guard.ts's beginBack REFUSES a second same-issuer request (see the F2 row above), it does not queue one, so whether a refused request is silently dropped or retried is adapter behaviour (hooks/use-nav-stack.ts, PR2), not something the pure core decides. PR2 scope."
  );
});
