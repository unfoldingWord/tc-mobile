import { describe, expect, it } from "vitest";

import { planReveal } from "@/lib/a11y/pending-reveal";

/**
 * When a newly created row is scrolled to and focused (#160 L-15).
 *
 * Pinning the CHOICE, in plain Node. The other half — that the `scrollIntoView`
 * and `.focus()` calls land on the right nodes, in the right commit — is DOM
 * ordering and cannot be observed in this repo's Node-only suite (the same gap
 * as #361). Nothing here should be read as covering it.
 */

const A = "a";
const B = "b";

describe("planReveal", () => {
  it("does nothing, and stays armed with nothing, when nothing is armed", () => {
    expect(planReveal({ scroll: null, focus: null }, false)).toEqual({
      scroll: null,
      focus: null,
      rest: { scroll: null, focus: null },
    });
  });

  it("spends both halves when the row can take focus", () => {
    expect(planReveal({ scroll: A, focus: A }, false)).toEqual({
      scroll: A,
      focus: A,
      rest: { scroll: null, focus: null },
    });
  });

  it("scrolls while the focus is held — an inert subtree still scrolls", () => {
    // Holding the scroll too would leave the new row off-screen for as long as
    // the overlay is up, and the translator has no way to ask for it again.
    expect(planReveal({ scroll: A, focus: A }, true)).toEqual({
      scroll: A,
      focus: null,
      rest: { scroll: null, focus: A },
    });
  });

  it("RETAINS the held focus target rather than spending it (#364)", () => {
    // The line this module exists for. Consuming it here is not a small bug:
    // `.focus()` inside an `inert` subtree is a silent no-op, so the hand-off
    // would be gone with nothing to show that it ever happened, and a switch
    // user would be left on the document. Kill the retention and this dies.
    const held = planReveal({ scroll: A, focus: A }, true);
    expect(held.rest.focus).toBe(A);
    // The commit that lifts `inert` runs the effect again, and the target is
    // still there to spend.
    const lifted = planReveal(held.rest, false);
    expect(lifted.focus).toBe(A);
    expect(lifted.rest.focus).toBeNull();
  });

  it("does not re-scroll on the commit that lifts the hold", () => {
    // The scroll was already spent while held, so the lift commit plans no
    // SECOND `scrollIntoView` — which is the whole of what this pins, and
    // deliberately narrower than "the viewport does not move". The hook hands
    // focus on that same commit with a bare `.focus()`, and the HTML focus
    // steps scroll the target into view unless `preventScroll: true` is
    // passed, so the view may still shift. Whether to pass it is a behaviour
    // question, not this extraction's (#800, George round 1 finding 2); it is
    // filed separately rather than settled here.
    const held = planReveal({ scroll: A, focus: A }, true);
    expect(planReveal(held.rest, false).scroll).toBeNull();
  });

  it("holds nothing when nothing was armed to focus", () => {
    // A hold must not invent a target: an effect that runs under an overlay
    // with an empty arm has to come out empty, or the NEXT arm would find a
    // stale one already waiting.
    expect(
      planReveal({ scroll: null, focus: null }, true).rest.focus
    ).toBeNull();
  });

  it("keeps the two halves independent", () => {
    // Segments arms a scroll alone on every append after the first: the corner
    // `+` survives the append and keeps focus, so only the empty chapter's
    // invite — which unmounts on the append it triggers — arms the hand-off
    // too (`segments-screen.tsx`'s `if (fromEmpty)`). Both of Books' create
    // paths arm the pair.
    expect(planReveal({ scroll: A, focus: null }, false)).toEqual({
      scroll: A,
      focus: null,
      rest: { scroll: null, focus: null },
    });
    // And the delete path arms a focus alone, because a delete creates no row
    // to scroll to: focus goes to a sibling already laid out, or — deleting
    // the last book — to the empty state's CTA, which replaces the whole
    // shelf (`focusTargetAfterDelete`). Neither needs a scroll armed.
    expect(planReveal({ scroll: null, focus: B }, false)).toEqual({
      scroll: null,
      focus: B,
      rest: { scroll: null, focus: null },
    });
  });
});
