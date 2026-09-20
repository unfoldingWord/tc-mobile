import { describe, expect, it } from "vitest";

import {
  floorEntryForLayerChange,
  rearmAfterLayerBack,
  routeBackToLayer,
  topLayer,
  type Layer,
} from "@/lib/nav/layer-stack";

/**
 * The layer-stack decision table (docs/design/back-navigation.md, "Pure
 * core" and "Test plan"). `routeBackToLayer` never calls `dismiss()` itself —
 * it is pure decision only: it names WHICH layer (if any) is the top of the
 * stack and whether it is busy. These tests cover only that narrow decision.
 *
 * George R1 P2-1 (PR #492): the FULL adapter obligation is NOT "call
 * `dismiss()` on a `"dismiss"` outcome, and nothing on `"refused-busy"` or
 * `"empty"`" — that was this file's own bug. A `popstate` has already popped
 * the screen-depth entry before `popAction` runs (the adapter updates `navIndex`
 * from the landing index first, `hooks/use-nav-stack.ts`), and every existing
 * non-screen intercept re-arms it (the adapter's `switch` cases, and the
 * recorder commit-close re-arm). So the real contract is: a
 * `"dismiss"` outcome means dismiss the layer AND re-arm; a `"refused-busy"`
 * outcome means re-arm only. That full contract is encoded where the adapter
 * actually reads it — `navigation.ts`'s `popAction`, as the string tags
 * `"rearm-layer-dismiss"` / `"rearm-layer-busy"` (both names say "rearm" on
 * purpose) — and pinned in `tests/nav-navigation.test.ts`'s
 * "popAction — layer routing" block, not here. This file's own assertions
 * below are correct as far as they go (which layer, busy or not) but must
 * not be read as the whole adapter contract on their own.
 */

function fakeLayer(
  id: string,
  busy: boolean
): { layer: Layer; dismissCount: () => number } {
  let dismissCalls = 0;
  const layer: Layer = {
    id,
    busy: () => busy,
    dismiss: () => {
      dismissCalls += 1;
    },
  };
  return { layer, dismissCount: () => dismissCalls };
}

describe("routeBackToLayer", () => {
  it("is empty for an empty stack — nothing to dismiss", () => {
    expect(routeBackToLayer([])).toEqual({ kind: "empty" });
  });

  it("dismisses a single non-busy layer, and the adapter's dismiss() fires once", () => {
    const { layer, dismissCount } = fakeLayer("menu", false);
    const result = routeBackToLayer([layer]);
    expect(result).toEqual({ kind: "dismiss", layerId: "menu" });
    // Simulate the layer-level half of the adapter: it calls dismiss() only
    // on a "dismiss" result. The adapter ALSO re-arms the screen-depth entry
    // in this case — that half of the contract is popAction's
    // "rearm-layer-dismiss" tag, tested in tests/nav-navigation.test.ts, not
    // modeled here.
    if (result.kind === "dismiss") layer.dismiss();
    expect(dismissCount()).toBe(1);
  });

  it("refuses a single busy layer, and dismiss() never fires", () => {
    const { layer, dismissCount } = fakeLayer("confirm", true);
    const result = routeBackToLayer([layer]);
    expect(result).toEqual({ kind: "refused-busy", layerId: "confirm" });
    if ((result as { kind: string }).kind === "dismiss") layer.dismiss();
    expect(dismissCount()).toBe(0);
    // The adapter still re-arms here (popAction's "rearm-layer-busy" tag) —
    // "dismiss() never fires" is not "nothing happens".
  });

  it("with two layers, only the TOP layer's dismiss() fires — a layer below the top is never asked (invariant 3)", () => {
    const bottom = fakeLayer("menu", false);
    const top = fakeLayer("rename", false);
    const result = routeBackToLayer([bottom.layer, top.layer]);
    expect(result).toEqual({ kind: "dismiss", layerId: "rename" });
    if (result.kind === "dismiss") {
      // Only the layer the result names is dismissed — the adapter never
      // iterates the whole stack.
      const named = [bottom.layer, top.layer].find(
        (l) => l.id === result.layerId
      );
      named?.dismiss();
    }
    expect(top.dismissCount()).toBe(1);
    expect(bottom.dismissCount()).toBe(0);
  });

  it("a busy top layer refuses even with a non-busy layer beneath it", () => {
    const bottom = fakeLayer("menu", false);
    const top = fakeLayer("saving", true);
    const result = routeBackToLayer([bottom.layer, top.layer]);
    expect(result).toEqual({ kind: "refused-busy", layerId: "saving" });
  });
});

describe("topLayer", () => {
  it("returns undefined for an empty stack", () => {
    expect(topLayer([])).toBeUndefined();
  });

  it("returns the LAST-pushed (most recently opened) layer, not the first", () => {
    const first = fakeLayer("first", false).layer;
    const second = fakeLayer("second", false).layer;
    // Mutation guard: if `topLayer` were changed to index `[0]` instead of
    // `[length - 1]`, this assertion would read "first" and die — that is
    // the mutation the design's test plan calls for.
    expect(topLayer([first, second])).toBe(second);
  });
});

/**
 * The negative example the design's test plan calls for (`busy()`-is-a-ref):
 * a snapshot boolean captured once, versus a ref-reading function, flipped
 * SYNCHRONOUSLY with no intervening render/await. Only the ref-backed shape
 * reflects the flip immediately. Both shapes type-check identically as
 * `() => boolean` — nothing in `Layer`'s type catches the wrong one; this is
 * a documented negative example, never shipped code (invariant 4).
 */
describe("busy() must be ref-backed, never a snapshot boolean (invariant 4, negative example)", () => {
  it("a snapshot-boolean busy() does NOT see a synchronous flip", () => {
    let erasing = false;
    // WRONG SHAPE — do not ship this. `busy` closes over the boolean's value
    // at the moment this object literal was built, exactly like reading
    // `erase.erasing` (a `useState` value) at render time in
    // `recorder.tsx:2014` on `develop` today.
    const snapshotBusy = erasing;
    const wrongLayer: Layer = {
      id: "wrong",
      busy: () => snapshotBusy,
      dismiss: () => {},
    };
    erasing = true; // synchronous flip, no render/await between this and the read
    expect(routeBackToLayer([wrongLayer])).toEqual({
      kind: "dismiss",
      layerId: "wrong",
    });
    // Stale: the flip happened, but the closed-over snapshot never saw it.
  });

  it("a ref-backed busy() DOES see the same synchronous flip", () => {
    const erasingRef = { current: false };
    // RIGHT SHAPE — reads the ref at call time, every time.
    const rightLayer: Layer = {
      id: "right",
      busy: () => erasingRef.current,
      dismiss: () => {},
    };
    erasingRef.current = true; // same synchronous flip as above
    expect(routeBackToLayer([rightLayer])).toEqual({
      kind: "refused-busy",
      layerId: "right",
    });
  });
});

/**
 * Amendment G's decision table (#452 PR3, #374) — see
 * `floorEntryForLayerChange`'s own docblock for why the floor needs an entry
 * at all, and `e2e/back-navigation.spec.ts`'s PR3 header for the measurement
 * that established it (a Back on the pre-PR3 shelf navigated the document to
 * `about:blank` with no `popstate`, so the layer stack was never consulted).
 *
 * Enumerated, not spot-checked: the decision is `atFloor` × `armed` × whether
 * any layer is left open, which is small enough to state completely — and
 * every row below is one a plausible wrong implementation gets wrong.
 */
describe("floorEntryForLayerChange (Amendment G)", () => {
  /** The untrapped floor — the ordinary case, where every arm/release happens. */
  const floor = (armed: boolean, open: number) =>
    floorEntryForLayerChange({ atFloor: true, trapped: false, armed, open });

  it("arms on the floor's FIRST layer, when nothing is armed yet", () => {
    expect(floor(false, 1)).toBe("arm");
  });

  it("arms nothing for a SECOND layer stacked on the floor — one entry per SCREEN, never one per overlay (invariant 2)", () => {
    expect(floor(true, 2)).toBe("none");
  });

  it("releases when the floor's LAST layer closes", () => {
    expect(floor(true, 0)).toBe("release");
  });

  it("releases nothing while a layer remains on the floor", () => {
    expect(floor(true, 1)).toBe("none");
  });

  it("releases nothing when the stack is empty with nothing armed", () => {
    // Also the every-render resting state of a shelf with no overlay open:
    // this row is what makes a spurious `history.back()` impossible there.
    expect(floor(false, 0)).toBe("none");
  });

  it("does NOTHING above the floor, whatever the stack holds — Segments and the Recorder already hold their own entry", () => {
    for (const trapped of [false, true]) {
      for (const armed of [false, true]) {
        for (const open of [0, 1, 2]) {
          expect(
            floorEntryForLayerChange({ atFloor: false, trapped, armed, open })
          ).toBe("none");
        }
      }
    }
  });

  /**
   * The two trap EDGES (Frank R1 P2 on PR #531). Amendment C's cleanup effect
   * runs on both of them with the stack already cleared, and they must do
   * opposite things — which is the whole reason `trapped` is a parameter of
   * the decision rather than a condition at the call site.
   */
  it("RETAINS the entry when a trap engages over an open Books overlay — the trap's own re-arm is what it is for", () => {
    // The cleanup has just emptied the stack, so this reads exactly like the
    // release row above except for `trapped`. Releasing here would let a Back
    // walk out of the app from under a panel whose purpose is to hold it.
    expect(
      floorEntryForLayerChange({
        atFloor: true,
        trapped: true,
        armed: true,
        open: 0,
      })
    ).toBe("none");
  });

  it("RELEASES the entry when the trap clears and the shelf is bare again", () => {
    // The `blocked` panel self-dismisses when the other tab closes and Books
    // remounts with no overlay, so nothing will call pushLayer/popLayer again
    // on its own. Without this the stale entry costs a second Back to leave.
    expect(floor(true, 0)).toBe("release");
  });

  it("arms nothing while a trap is up, even if an overlay is somehow registered", () => {
    // Unreachable today (App's early return unmounts both screens, so nothing
    // can call `pushLayer`), but the rule is "nothing moves while a trap is
    // up", and a total function says so for every input rather than relying on
    // that unreachability holding elsewhere.
    expect(
      floorEntryForLayerChange({
        atFloor: true,
        trapped: true,
        armed: false,
        open: 1,
      })
    ).toBe("none");
  });
});

describe("rearmAfterLayerBack (Amendment G)", () => {
  it("always re-arms above the floor — the consumed entry is the SCREEN's own", () => {
    expect(rearmAfterLayerBack(false, 0)).toBe(true);
    expect(rearmAfterLayerBack(false, 1)).toBe(true);
    expect(rearmAfterLayerBack(false, 2)).toBe(true);
  });

  it("re-arms at the floor while a layer remains (a busy refusal, or a dismissal over a layer beneath it)", () => {
    expect(rearmAfterLayerBack(true, 1)).toBe(true);
    expect(rearmAfterLayerBack(true, 2)).toBe(true);
  });

  it("does NOT re-arm at the floor once the last layer is gone — the shelf goes back to being the floor with no self-caused traversal", () => {
    // This row is about CHURN, not about the end state, and the docblock says
    // why: with this forced to `true` the adapter's own `popLayer` releases
    // the entry a moment later and the shelf ends up identical. The assertion
    // that kills that mutant is in `e2e/back-navigation.spec.ts` case (e),
    // which counts the app's `pushState`/`back()` calls across the dismissal.
    expect(rearmAfterLayerBack(true, 0)).toBe(false);
  });
});
