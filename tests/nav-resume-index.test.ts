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
 * reads from `window.history.state` and hands in as a plain value. The second
 * describe block below drives a scenario with fake `history.state`-shaped
 * inputs, composing `resumeNavIndex` with `navDirection`/`popAction` the way
 * the adapter (`hooks/use-nav-stack.ts`, wired in PR2) composes them — no
 * real `history`, and no exercise of the adapter's actual mount effect.
 * These rows test pure composition, not the live reload path. See the second
 * describe block's scope statement.
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
   * (the adapter's `pushHistoryEntry`, `hooks/use-nav-stack.ts`) could ever
   * stamp, so both can only arrive here from state
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
 * SCOPE: these tests prove the PURE composition — `resumeNavIndex` +
 * `navDirection` + `popAction`, composed the way the adapter composes them —
 * classifies a reload-then-Back scenario correctly (no `trap-forward` misfire,
 * no skipped physical level). As of PR2 the adapter (`hooks/use-nav-stack.ts`)
 * DOES wire this in: its mount effect reads `window.history.state`, adopts
 * `resumeNavIndex(state)` into BOTH `navIndex` and `nextIndex`, and only
 * `replaceState`-stamps index 0 when there is nothing app-shaped to adopt,
 * replacing `develop`'s old unconditional `replaceState`/reset.
 *
 * These pure-function tests do not exercise the adapter's mount effect or a
 * real `popstate`. They pin the decision table the adapter composes and the
 * both-refs contract it must honour. The first row models the un-adopted
 * baseline; the following rows model the adopted composition. Browser reload
 * behavior belongs to `e2e/back-navigation.spec.ts`, not these Node rows.
 */
describe("resumeNavIndex + navDirection + popAction composition (the pure decision table the PR2 adapter composes)", () => {
  it("without adopting the resumed index (the OLD develop baseline, before PR2), a post-reload Back misfires as trap-forward", () => {
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

  it("with the resumed index adopted (the pure composition the PR2 adapter performs), the SAME post-reload Back classifies correctly — DOM path exercised by e2e case (c), a device item", () => {
    // George R1 P3-6 (PR #492): a reload always resets React state to Books
    // (`chapterId` starts `null`) regardless of history depth — the adapter's
    // mount effect runs on every mount, a reload included, and nothing restores
    // `chapterId`/`recorder` from the history entry (the adapter adopts the nav
    // INDEX, not the screen). So the SCREEN this row must exercise is Books
    // (`screenFor(false, false)`), not Segments — driving it with
    // `screenFor(true, false)` asserted a property that holds by coincidence
    // (both screens avoid `trap-forward`) while pinning the wrong `popAction`
    // outcome for a reader/PR2 to copy: it would compute `"to-books"` and
    // call `backToBooks()` on a tree that is already showing Books.
    //
    // Frank R4 P2 (PR #492): this row models what the adapter's mount effect
    // reads BEFORE the first popstate — it calls
    // `resumeNavIndex(window.history.state)` as of PR2. This is the pure
    // composition that effect performs; it does not execute that effect or
    // establish the live reload behavior on a device.
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
    );
    // George R3 P2-1 (PR #492), dev lead decision (round 4, 2026-09-18): this
    // pure `"exit-app"` result is correctly classified, but its LIVE meaning
    // is a no-op — the adapter's `case "exit-app"` (`hooks/use-nav-stack.ts`)
    // assumes the browser is already leaving, which holds at real depth 0 but
    // not here. Adopt-
    // don't-rewrite (Amendment B) leaves the physical stack below (`index:0`,
    // `index:1`) intact rather than flattening it, so this popstate lands at
    // physical depth 1, not depth 0 — the app does NOT exit on this Back; it
    // takes one more (the accepted-UX cost of adopt-don't-rewrite; see
    // `docs/design/back-navigation.md`'s Residual Risks). This test only pins
    // the pure classification, not that the app has left.
  });

  it("IF adopted, the resumed index does not skip a physical level on the FOLLOWING Back either — same pure-composition scope as above", () => {
    // Continue the hypothesized scenario: after the Back above lands (still
    // Books — the reload always resets React state to Books regardless of
    // history depth, George R1 P3-6; there is no Segments screen to land on
    // here), navIndex is updated to the landing index (1) exactly as the
    // adapter's popstate handler does (`navIndex.current = toIndex`),
    // unaffected by this fix. The following Back — landing on the depth-0
    // entry — must read as a normal "back", not compound any earlier
    // corruption. Still a pure-composition proof, not a live-app claim (see the
    // describe block's docblock).
    const navIndexAfterFirstBack = 1; // set by the popstate handler itself
    const nextLandingState = { tc: true, index: 0 };
    const toIndex = resumeNavIndex(nextLandingState);
    const direction = navDirection(navIndexAfterFirstBack, toIndex);
    expect(direction).toBe("back");
    expect(popAction(direction, screenFor(false, false), false, false)).toBe(
      "exit-app"
    );
    // George R3 P2-1 (PR #492), dev lead decision (round 4, 2026-09-18): THIS
    // is the Back that actually leaves — it lands on physical depth 0, where
    // the adapter's `case "exit-app"` no-op assumption (the browser is already
    // leaving) is true. Two real system Backs were needed after this reload at depth
    // 2 (one per leftover physical level below the adopted baseline), not
    // one — accepted as UX, not a skipped level: nothing was lost, no
    // misclassification occurred, the user simply pressed Back one extra
    // time. See the residual-risks note in `docs/design/back-navigation.md`.
  });

  /**
   * George R2 P2-2 (PR #492): `resumeNavIndex`'s own docblock says the
   * adapter must adopt the returned value into BOTH `navIndex` and
   * `nextIndex` — but every composition test above only ever feeds it into
   * `navDirection`, never into a `++nextIndex` stand-in. `pushHistoryEntry`
   * stamps from `++nextIndex.current` alone, not from `navIndex`. Adopting
   * only `navIndex` and leaving `nextIndex` at 0 (the mis-wire the adapter
   * avoids by seeding BOTH from the same `resumeNavIndex` value on mount)
   * would stamp the NEXT pushed entry with a LOWER index than the one just
   * adopted — desyncing the strictly-increasing invariant `navDirection`
   * relies on — and the following Back misreads as Forward. That is finding F3
   * again, one push later than the first-Back-only rows above look.
   */
  it("George R2 P2-2: the contract requires BOTH refs adopt the SAME baseline — proven against the actual stamp path (`++nextIndex.current`)", () => {
    const adopted = resumeNavIndex({ tc: true, index: 2 });
    // The contract's required wiring: nextIndex starts at the SAME adopted
    // value navIndex did, not left at its old default.
    let nextIndex = adopted;
    const stamped = ++nextIndex; // pushHistoryEntry's own `++nextIndex.current`
    expect(navDirection(stamped, adopted)).toBe("back");
  });

  it("George R2 P2-2 (negative — the mis-wire the adapter avoids): nextIndex left un-synced at 0 reintroduces F3 on the very next push", () => {
    const adopted = resumeNavIndex({ tc: true, index: 2 });
    // The mis-wire: navIndex adopts, nextIndex does not.
    let nextIndex = 0;
    const stamped = ++nextIndex;
    expect(navDirection(stamped, adopted)).toBe("forward"); // the F3 misfire
  });
});
