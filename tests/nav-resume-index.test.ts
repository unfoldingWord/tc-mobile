import { describe, expect, it } from "vitest";

import {
  backEffectFor,
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
 * The second describe block below drives an integration-shaped scenario with
 * fake `history.state`-shaped inputs to confirm the fix actually closes the
 * `trap-forward` misfire / skipped-level hazard the design traces through —
 * still no jsdom, no real `history`, just the same pure functions wired
 * together the way the adapter will.
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
 * The reload-then-Back scenario the design traces through concretely: reload
 * while on the recorder (physical depth 2). Without the fix, the mount effect
 * force-resets `navIndex`/`nextIndex` to 0 regardless of what is physically
 * below, so the first post-reload Back (landing on the depth-1 entry,
 * `{tc:true,index:1}`) reads as "forward" against the wrongly-reset baseline
 * of 0 and `popAction` returns `trap-forward` — which cancels by walking the
 * browser back ANOTHER physical level, skipping the depth-1 entry entirely
 * for one Back gesture. With the fix, the mount effect adopts
 * `resumeNavIndex(window.history.state)` as its baseline instead of forcing
 * 0, so the same landing reads as a genuine "back" and routes normally.
 */
describe("reload/bootstrap integration (fake history.state, no jsdom)", () => {
  it("without adopting the resumed index, a post-reload Back misfires as trap-forward", () => {
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

  it("adopting the resumed index at mount, the SAME post-reload Back reads correctly and does not misfire", () => {
    // The mount effect reads window.history.state BEFORE the first popstate —
    // simulate the fix: it adopts the current top entry's own index rather
    // than forcing 0.
    const currentEntryAtMount = { tc: true, index: 2 }; // top of stack, depth 2
    const adoptedNavIndex = resumeNavIndex(currentEntryAtMount);
    expect(adoptedNavIndex).toBe(2);

    // The first popstate after reload still lands on the depth-1 entry.
    const landingState = { tc: true, index: 1 };
    const toIndex = resumeNavIndex(landingState);
    const direction = navDirection(adoptedNavIndex, toIndex);
    expect(direction).toBe("back"); // no misfire — correctly read as Back.
    expect(popAction(direction, screenFor(true, false), false, false)).toBe(
      backEffectFor(screenFor(true, false))
    ); // routes normally, no trap-forward
  });

  it("adopting the resumed index does not skip a physical level on the FOLLOWING Back either", () => {
    // Continue the corrected scenario: after the Back above lands (depth 1,
    // Segments), navIndex is updated to the landing index (1) exactly as the
    // real popstate handler already does (`navIndex.current = toIndex`,
    // App.tsx:302, unaffected by this fix). The following Back — landing on
    // the depth-0 entry — must read as a normal "back", not compound any
    // earlier corruption.
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
