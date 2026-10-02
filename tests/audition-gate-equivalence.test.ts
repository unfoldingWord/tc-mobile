import { describe, expect, it } from "vitest";

import type { AuditionPlan } from "@/lib/audio/audition";
import type { PlaySource } from "@/components/recorder-toolbars";

/**
 * Pins #828 item 2: that the audition gate's equivalence is checkable rather
 * than assertable.
 *
 * Both toolbar arms in `recorder-toolbars.tsx` disable Play on
 * `playSource === null`. Before the toolbar split, the same gate read
 * `playPlan === null` directly. The call site (`recorder.tsx`) now derives
 * `playSource` as `playPlan?.source ?? null`, so the two gates agree **iff**
 * a non-null `AuditionPlan`'s `source` can never itself be nullish — if
 * `source` were ever widened to admit `null` or made optional, a live plan
 * could map to `playSource === null` and the audition button would go inert
 * with an `AuditionPlan` still in hand, and nothing today would catch it
 * (#828's stated blast radius: the edit-mode audition button).
 *
 * These are TYPE-level assertions, so `npm run typecheck` is what runs them
 * (`tsc -b` compiles `tests/`), in `verify` and in CI — the same shape
 * `tests/audio-views.test.ts` (#654) uses. The runtime cases below exist so a
 * reader of the test output can see the guarantee is claimed, and so an
 * assertion that stops compiling cannot vanish silently.
 */

/** `true` only if A and B are the same type. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Would `null` ever satisfy a non-optional `AuditionPlan["source"]`? */
type SourceAdmitsNull = null extends AuditionPlan["source"] ? true : false;

/** What `playPlan?.source ?? null` can actually produce at the call site. */
type DerivedPlaySource = AuditionPlan["source"] | null;

// Each `true` below is the assertion; a drift makes the annotation fail `tsc`.
const sourceNeverNull: Exact<SourceAdmitsNull, false> = true;
const gateShapesAgree: Exact<PlaySource, DerivedPlaySource> = true;

describe("the audition gate's equivalence (#828)", () => {
  it("never lets a live plan's source come out nullish", () => {
    // If AuditionPlan["source"] admitted null or undefined, `?? null` could
    // no longer tell "no plan" apart from "plan with a nullish source", and
    // the removed `playPlan === null` check and today's
    // `playSource === null` would diverge on that case.
    expect(sourceNeverNull).toBe(true);
  });

  it("keeps the toolbars' PlaySource exactly what the call site can derive", () => {
    // The other half: PlaySource must not be narrower or wider than what
    // `playPlan?.source ?? null` can actually produce, or the toolbars could
    // declare a prop shape the call site cannot fill (or vice versa).
    expect(gateShapesAgree).toBe(true);
  });
});
