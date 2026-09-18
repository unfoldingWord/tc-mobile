import { describe, expect, it } from "vitest";

import {
  navDirection,
  popAction,
  resumeNavIndex,
  screenFor,
} from "@/lib/nav/navigation";

/**
 * Amendment B of docs/design/back-navigation.md — reload/bootstrap safety.
 *
 * `resumeNavIndex` is pure: no `window`, no `history`, only what the adapter
 * (PR2) will read from `window.history.state` and hand in as a plain value.
 * The second describe block below drives a scenario with fake
 * `history.state`-shaped inputs, composing `resumeNavIndex` with
 * `navDirection`/`popAction` the way the adapter is DESIGNED to — no jsdom,
 * no real `history`, and no exercise of `App.tsx`'s actual (still unchanged,
 * still unconditional) mount effect. That composition proof is real and
 * useful — it is the exact decision table PR2 must reproduce — but it is not
 * evidence the live reload defect is fixed in this PR (Frank R4 P2, PR
 * #492): that requires PR2 to actually wire `resumeNavIndex` into the mount
 * effect, which has not happened yet. See the second describe block's own
 * docblock for the corrected scope statement.
 */
describe("resumeNavIndex", () => {
  it("resumes 0 for a fresh load with no state at all", () => {
    expect(resumeNavIndex(null)).toBe(0);
  });

  it("resumes 0 for undefined", () => {
    expect(resumeNavIndex(undefined)).toBe(0);
  });

  it("resumes 0 for a state that is not this app's own shape", () => {
    expect(resumeNavIndex({})).toBe(0);
    expect(resumeNavIndex({ foo: "bar" })).toBe(0);
    expect(resumeNavIndex("index:2")).toBe(0);
    expect(resumeNavIndex(42)).toBe(0);
  });

  it("resumes 0 when `tc` is missing or false, even if `index` looks valid", () => {
    expect(resumeNavIndex({ index: 2 })).toBe(0);
    expect(resumeNavIndex({ tc: false, index: 2 })).toBe(0);
  });

  it("resumes 0 when `index` is missing or not a number", () => {
    expect(resumeNavIndex({ tc: true })).toBe(0);
    expect(resumeNavIndex({ tc: true, index: "2" })).toBe(0);
  });

  it("adopts the index from a well-formed entry, unchanged", () => {
    expect(resumeNavIndex({ tc: true, index: 2 })).toBe(2);
    expect(resumeNavIndex({ tc: true, index: 0 })).toBe(0);
  });

  /**
   * Frank R1 P2 (PR #492): `typeof x === "number"` alone accepts `NaN` and
   * `Infinity` as "well-formed" — neither is an integer `++nextIndex.current`
   * (App.tsx:78) could ever stamp, so both can only arrive here from state
   * this app never wrote. Adopting `NaN` is actively dangerous, not just
   * wrong: `navDirection(NaN, x)` reads `"same"` for every `x` (both `<`/`>`
   * comparisons on `NaN` are false), so a real Back gesture would be silently
   * swallowed forever once adopted as the baseline.
   */
  it("resumes 0 for non-finite or out-of-domain `index` values (Frank R1 P2)", () => {
    expect(resumeNavIndex({ tc: true, index: NaN })).toBe(0);
    expect(resumeNavIndex({ tc: true, index: Infinity })).toBe(0);
    expect(resumeNavIndex({ tc: true, index: -Infinity })).toBe(0);
    expect(resumeNavIndex({ tc: true, index: -1 })).toBe(0);
    expect(resumeNavIndex({ tc: true, index: 1.5 })).toBe(0);
  });
});

/**
 * SCOPE, corrected per Frank R4 P2 (PR #492): this describe block's earlier
 * name and comments read as "confirms the fix actually closes" the reload
 * hazard — overclaiming what a pure-function test can prove. `App.tsx:85-89`
 * still runs its OLD, unconditional `replaceState`/reset on every mount
 * TODAY, unchanged by this PR (Amendment B's fix is PR1's pure half only;
 * wiring `resumeNavIndex` into the mount effect is PR2, per this PR's own
 * "Deferred to PR2" list). So the reload-then-Back defect this describes is
 * STILL PRESENT on `develop`/this branch's shipped app — nothing here
 * exercises `App.tsx`'s real mount effect, only the pure functions PR2 will
 * compose.
 *
 * What these tests DO prove, correctly: `resumeNavIndex` + `navDirection` +
 * `popAction`, composed the way the adapter is DESIGNED to compose them,
 * classify a reload-then-Back scenario correctly — no `trap-forward`
 * misfire, no skipped physical level — GIVEN that composition is actually
 * wired in. That is a real, valuable regression test for the pure core (and
 * the exact decision table PR2 must reproduce), but it is a claim about the
 * pure functions' correctness, not a claim that the live defect is fixed.
 * The first test below (still using the WRONG, un-adopted baseline) is the
 * one that demonstrates the defect currently shipping; the two after it
 * demonstrate what the correct composition WOULD produce once PR2 wires it.
 */
describe("resumeNavIndex + navDirection + popAction composition (pure-core proof for PR2, not yet wired into App.tsx)", () => {
  it("without adopting the resumed index (App.tsx's CURRENT, unwired behaviour), a post-reload Back misfires as trap-forward", () => {
    // Simulate: reload happened while the current entry (top of stack) was
    // stamped `index:2` (recorder depth), but the OLD, unconditional
    // mount-reset behaviour still zeroes `navIndex` regardless.
    const wronglyResetNavIndex = 0;
    // The first popstate after reload lands on the depth-1 entry below.
    const landingState = { tc: true, index: 1 };
    const toIndex = resumeNavIndex(landingState);
    const direction = navDirection(wronglyResetNavIndex, toIndex);
    expect(direction).toBe("forward");
    expect(popAction(direction, screenFor(true, false), false, false)).toBe(
      "trap-forward"
    );
  });

  it("IF the adapter adopts the resumed index (PR2, not yet wired), the SAME post-reload Back would classify correctly — a pure-composition proof, not a claim about the shipped app", () => {
    // George R1 P3-6 (PR #492): a reload always resets React state to Books
    // (`chapterId = null`, `App.tsx:42-46`) regardless of history depth — the
    // mount effect at `App.tsx:85-89` runs unconditionally on every mount, a
    // reload included, and nothing restores `chapterId`/`recorder` from the
    // history entry. So the SCREEN this row must exercise is Books
    // (`screenFor(false, false)`), not Segments — driving it with
    // `screenFor(true, false)` asserted a property that holds by coincidence
    // (both screens avoid `trap-forward`) while pinning the wrong `popAction`
    // outcome for a reader/PR2 to copy: it would compute `"to-books"` and
    // call `backToBooks()` on a tree that is already showing Books.
    //
    // Frank R4 P2 (PR #492): this row HYPOTHESIZES what the mount effect
    // would read BEFORE the first popstate IF PR2 wires it to call
    // `resumeNavIndex(window.history.state)` — App.tsx's mount effect does
    // NOT do this yet (unchanged, `App.tsx:85-89`), so this is a composition
    // proof for PR2 to reproduce, not evidence the live app is fixed.
    const currentEntryAtMount = { tc: true, index: 2 }; // top of stack, depth 2
    const adoptedNavIndex = resumeNavIndex(currentEntryAtMount);
    expect(adoptedNavIndex).toBe(2);

    // The first popstate after reload still lands on the depth-1 entry.
    const landingState = { tc: true, index: 1 };
    const toIndex = resumeNavIndex(landingState);
    const direction = navDirection(adoptedNavIndex, toIndex);
    expect(direction).toBe("back"); // no misfire — correctly read as Back.
    expect(popAction(direction, screenFor(false, false), false, false)).toBe(
      "exit-app"
    ); // routes normally to the real post-reload root, no trap-forward
  });

  it("IF adopted, the resumed index does not skip a physical level on the FOLLOWING Back either — same pure-composition scope as above", () => {
    // Continue the hypothesized scenario: after the Back above lands (depth
    // 1, Segments), navIndex is updated to the landing index (1) exactly as
    // the real popstate handler already does (`navIndex.current = toIndex`,
    // App.tsx:302, unaffected by this fix). The following Back — landing on
    // the depth-0 entry — must read as a normal "back", not compound any
    // earlier corruption. Still a pure-composition proof, not a live-app
    // claim (see the describe block's docblock).
    const navIndexAfterFirstBack = 1; // set by the popstate handler itself
    const nextLandingState = { tc: true, index: 0 };
    const toIndex = resumeNavIndex(nextLandingState);
    const direction = navDirection(navIndexAfterFirstBack, toIndex);
    expect(direction).toBe("back");
    expect(popAction(direction, screenFor(false, false), false, false)).toBe(
      "exit-app"
    ); // Books, the correct root — not a skipped level.
  });
});
