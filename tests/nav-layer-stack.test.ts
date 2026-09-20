import { describe, expect, it } from "vitest";

import {
  floorArmedOnResume,
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
  const floor = (armed: boolean, open: number) =>
    floorEntryForLayerChange({ atFloor: true, armed, open });

  it("arms on the floor's FIRST layer, when nothing is armed yet", () => {
    expect(floor(false, 1)).toBe("arm");
  });

  it("arms nothing for a SECOND layer stacked on the floor — one entry per SCREEN, never one per overlay (invariant 2)", () => {
    expect(floor(true, 2)).toBe("none");
  });

  it("arms nothing when the floor's LAST layer closes — there is no release, by design", () => {
    // The entry is never handed back by a traversal (Frank R1 P2 and R2 P1 on
    // PR #531 were both about a release existing). It is consumed by whichever
    // comes first: a Back that `rearmAfterLayerBack` declines to re-arm, or a
    // screen transition that re-stamps it.
    expect(floor(true, 0)).toBe("none");
  });

  it("arms nothing while a layer remains on the floor", () => {
    expect(floor(true, 1)).toBe("none");
  });

  it("arms nothing on a bare shelf with nothing armed — the resting state", () => {
    expect(floor(false, 0)).toBe("none");
  });

  it("arms nothing when an entry is ALREADY armed and the shelf opens another overlay — including after a trap cleared the stack under one", () => {
    // Amendment C's cleanup empties the stack when `recovering` or
    // `databasePanel` engages, which on Books can happen with a menu open
    // (`useDatabaseStatus` flips from another tab). That leaves `armed` true
    // with nothing stacked, and this row is what makes the state harmless:
    // when the shelf comes back, the next overlay arms nothing on top of the
    // entry already there.
    expect(floor(true, 1)).toBe("none");
  });

  it("does NOTHING above the floor, whatever the stack holds — Segments and the Recorder already hold their own entry", () => {
    for (const armed of [false, true]) {
      for (const open of [0, 1, 2]) {
        expect(floorEntryForLayerChange({ atFloor: false, armed, open })).toBe(
          "none"
        );
      }
    }
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
    // Forcing this to `true` leaves a spurious entry standing on the shelf,
    // which `e2e/back-navigation.spec.ts` case (e) kills twice over: its
    // closing `navIndex` assertion (where the shelf ended) and its
    // `pushState`/`back()` call counts (that the adapter issued nothing of its
    // own to get there).
    expect(rearmAfterLayerBack(true, 0)).toBe(false);
  });
});

/**
 * Amendment G's resume half (Frank R3 P2 on PR #531). Two booleans, so the
 * table is stated complete rather than spot-checked — and each row is one a
 * plausible wrong implementation gets wrong, including the two shapes actually
 * proposed: "adopt whenever `index > 0`" (row 3) and "adopt whenever the entry
 * is marked" (row 4).
 */
describe("floorArmedOnResume (Amendment G, the reload half)", () => {
  it("adopts a MARKED entry when the resumed screen is the floor — the reload-with-an-overlay-open case", () => {
    // Without this the adapter forgets an entry that is still on the stack and
    // the next overlay arms a second one, one dead Back per reload cycle.
    expect(floorArmedOnResume({ marked: true, atFloor: true })).toBe(true);
  });

  it("does NOT adopt an unmarked entry at the floor — a Segments entry that outlived its screen is not the floor's", () => {
    // A reload always re-renders the shelf, so depth alone would say "floor"
    // here and be wrong. Adopting this would let the next `enterScreen`
    // `replaceState` over a level PR2 keeps on purpose (e2e case (c)'s tail).
    expect(floorArmedOnResume({ marked: false, atFloor: true })).toBe(false);
  });

  it("does NOT adopt a marked entry when the resumed screen is NOT the floor", () => {
    // Unreachable today (nothing restores a screen across a reload) and a row
    // rather than an assumption: a screen that owns its own entry must not
    // come back believing it also holds the floor's.
    expect(floorArmedOnResume({ marked: true, atFloor: false })).toBe(false);
  });

  it("adopts nothing on a first load — no marker, not the floor's entry", () => {
    expect(floorArmedOnResume({ marked: false, atFloor: false })).toBe(false);
  });
});
