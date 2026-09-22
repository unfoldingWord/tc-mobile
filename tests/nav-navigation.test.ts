import { describe, expect, it } from "vitest";

import {
  backEffectFor,
  navDirection,
  overlayBlocksClose,
  overlayDismissal,
  popAction,
  type PopAction,
  screenFor,
} from "@/lib/nav/navigation";
import type { Layer, LayerStack } from "@/lib/nav/layer-stack";

/**
 * Invariant 7's rename (docs/design/back-navigation.md:290-291, #452 PR2): the
 * recorder-commit-in-flight guard's tag is `"rearm-transition-busy"`, not the
 * PR1 placeholder `"rearm-during-commit"`. Asserted through a typed `PopAction`
 * const so a future rename of the union member is caught by `tsc` too, not only
 * at runtime — `@vitest/expect`'s `toBe` is unconstrained, so a stale string
 * literal would still typecheck and go red only when the test runs.
 */
const REARM_TRANSITION_BUSY: PopAction = "rearm-transition-busy";

/**
 * The History wiring in `App.tsx` is browser-only and untestable here (there is
 * no jsdom/renderer — see AGENTS.md); what IS testable is the decision it runs
 * on. The regression these guard: a Back gesture on the recorder must route to
 * the commit path, not to a bare unmount that drops the in-progress take (#58 /
 * #168). If `backEffectFor("recorder")` ever stops returning
 * `"commit-close-recorder"`, that data-loss regression is back — so that row is
 * the mutation that must fail.
 */
describe("screenFor", () => {
  it("is books with no chapter and no recorder", () => {
    expect(screenFor(false, false)).toBe("books");
  });

  it("is segments with a chapter and no recorder", () => {
    expect(screenFor(true, false)).toBe("segments");
  });

  it("is recorder whenever the recorder is open — even over a chapter", () => {
    expect(screenFor(true, true)).toBe("recorder");
    // The recorder is a sheet, so an open recorder wins over the screen beneath
    // it regardless of the chapter flag.
    expect(screenFor(false, true)).toBe("recorder");
  });
});

describe("backEffectFor", () => {
  it("commits and closes the recorder — never a take-dropping unmount (#58)", () => {
    expect(backEffectFor("recorder")).toBe("commit-close-recorder");
  });

  it("returns Segments to the Books shelf", () => {
    expect(backEffectFor("segments")).toBe("to-books");
  });

  it("exits the app from the Books shelf, where Back loses nothing", () => {
    expect(backEffectFor("books")).toBe("exit-app");
  });
});

describe("navDirection", () => {
  it("is back when the destination index is lower", () => {
    expect(navDirection(2, 1)).toBe("back");
  });

  it("is forward when the destination index is higher", () => {
    // `popstate` fires for Forward too; the old handler had no way to see this
    // and misrouted it as a Back (Frank R1 F2).
    expect(navDirection(1, 2)).toBe("forward");
  });

  it("is same when the index did not move", () => {
    expect(navDirection(1, 1)).toBe("same");
  });
});

describe("popAction", () => {
  it("routes a Back on the recorder to the commit path (#58)", () => {
    expect(popAction("back", "recorder", false, false)).toBe(
      "commit-close-recorder"
    );
  });

  it("routes a Back on Segments to Books, and on Books to exit", () => {
    expect(popAction("back", "segments", false, false)).toBe("to-books");
    expect(popAction("back", "books", false, false)).toBe("exit-app");
  });

  it("traps a Forward instead of misrouting it as a Back (F2)", () => {
    // The load-bearing F2 row: a Forward while on Segments must NOT run
    // `to-books` (which dropped the UI to Books). It is trapped.
    expect(popAction("forward", "segments", false, false)).toBe("trap-forward");
    expect(popAction("forward", "recorder", false, false)).toBe("trap-forward");
  });

  it("ignores a same-index popstate", () => {
    expect(popAction("same", "segments", false, false)).toBe("ignore");
  });

  it("re-arms every gesture while a screen transition is in flight (F1, #168 — re-targeted at transitionInFlight)", () => {
    // The load-bearing F1 / #168 row, carried forward re-targeted at the
    // renamed transition-in-flight guard (invariant 7). First Back starts the
    // commit…
    expect(popAction("back", "recorder", false, false)).toBe(
      "commit-close-recorder"
    );
    // …and a SECOND Back arriving before it settles must re-arm the protective
    // entry, never escape the recorder and drop the uncommitted take (#58).
    // `transitionInFlight` wins over direction and screen, so nothing else can
    // leave.
    expect(popAction("back", "recorder", true, false)).toBe(
      REARM_TRANSITION_BUSY
    );
    expect(popAction("back", "segments", true, false)).toBe(
      REARM_TRANSITION_BUSY
    );
    expect(popAction("forward", "recorder", true, false)).toBe(
      REARM_TRANSITION_BUSY
    );
  });

  it("traps every gesture under the failed-save recovery modal (R3 G-R3-1)", () => {
    // The load-bearing R3 row. A Back under the `SaveFailed` modal must NOT run
    // `to-books`/`exit-app` — those walk one entry farther toward the document
    // unload that destroys the heap and the ONLY in-memory copy of the held take.
    // `recovering` outranks direction, screen, and even a commit in flight, so
    // nothing under the modal can escape; the handler absorbs it by re-arming.
    expect(popAction("back", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("back", "books", false, true)).toBe("trap-recovery");
    expect(popAction("back", "recorder", false, true)).toBe("trap-recovery");
    expect(popAction("forward", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("same", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("back", "recorder", true, true)).toBe("trap-recovery");
  });

  it("traps every gesture under the database panel (George R3 P3)", () => {
    // The panel is a full-screen alertdialog in the same slot as `SaveFailed`,
    // not a navigation level. Untrapped, a Back from the BLOCKED panel on Books
    // runs `exit-app`: the copy that was waiting for the other one to close is
    // the one that leaves, and reopening is blocked all over again. From
    // Segments it runs `backToBooks()` underneath a panel that stays up.
    for (const screen of ["books", "segments", "recorder"] as const) {
      expect(popAction("back", screen, false, false, true)).toBe(
        "trap-database-panel"
      );
    }
    // Outranks direction and a commit in flight, like the recovery row above.
    expect(popAction("forward", "books", false, false, true)).toBe(
      "trap-database-panel"
    );
    expect(popAction("same", "books", false, false, true)).toBe(
      "trap-database-panel"
    );
    expect(popAction("back", "recorder", true, false, true)).toBe(
      "trap-database-panel"
    );
  });

  it("ranks a held take above the database panel", () => {
    // Both are modals in the same slot; the recovery screen holds the only copy
    // of a recording, so it wins. In the product the two cannot be up together
    // — `databasePanel` is null while anything is held — but the ordering is
    // what makes that true rather than incidental.
    expect(popAction("back", "segments", false, true, true)).toBe(
      "trap-recovery"
    );
  });

  it("changes nothing when no panel is up — the flag defaults to absent", () => {
    // Every existing caller and every row above this one passes four arguments.
    expect(popAction("back", "books", false, false)).toBe(
      popAction("back", "books", false, false, false)
    );
    expect(popAction("back", "segments", false, false, false)).toBe("to-books");
  });
});

describe("overlayBlocksClose", () => {
  it("refuses close while the erase is busy — never save over an erase (G1)", () => {
    // The load-bearing G1 row: a system Back must not commit while an erase is in
    // flight, or `saveEditedSegment` races the erase (last IDB writer wins).
    expect(overlayBlocksClose(false, false, true)).toBe(true);
  });

  it("refuses close while the erase-confirm or the menu is open", () => {
    expect(overlayBlocksClose(false, true, false)).toBe(true);
    expect(overlayBlocksClose(true, false, false)).toBe(true);
  });

  it("allows close when no overlay is up", () => {
    expect(overlayBlocksClose(false, false, false)).toBe(false);
  });
});

describe("overlayDismissal", () => {
  it("does NOT dismiss the confirm while an erase is in flight (Frank R4-1)", () => {
    // The erase owns its confirmation until completion. Independently,
    // `erasing` keeps the overlay gate up: header inert always, sheet at idle.
    expect(overlayDismissal(false, true, true)).toEqual({
      closeMenu: false,
      closeConfirm: false,
    });
  });

  it("dismisses a confirm dialog that is not yet erasing, and the menu", () => {
    expect(overlayDismissal(false, true, false)).toEqual({
      closeMenu: false,
      closeConfirm: true,
    });
    expect(overlayDismissal(true, false, false)).toEqual({
      closeMenu: true,
      closeConfirm: false,
    });
  });
});

/**
 * popAction's new layer-routing tags, `"rearm-layer-dismiss"` and
 * `"rearm-layer-busy"` (#452 PR1, docs/design/back-navigation.md; shape
 * corrected per George R1 P2-1 on PR #492 — both names say "rearm" on
 * purpose, since both outcomes re-arm the screen-depth entry the `popstate`
 * already consumed; only `"rearm-layer-dismiss"` additionally means dismiss
 * the top layer, recovered by the adapter via `topLayer(stack)`).
 * `layerStack` is an OPTIONAL trailing parameter defaulting to an empty
 * stack — a hard PR1 constraint is that this is a ZERO-BEHAVIOUR-CHANGE
 * addition, so every row above this point (every existing call, all five
 * positional args or fewer) must keep producing exactly what it does today.
 * That is asserted directly below, not just assumed.
 */
function fakeLayer(id: string, busy: boolean): Layer {
  return { id, busy: () => busy, dismiss: () => {} };
}

describe("popAction — layer routing (#452 PR1)", () => {
  it("an empty layerStack (the default) reproduces every pre-existing row unchanged", () => {
    // On `develop` before PR2 the only caller (App.tsx's popstate switch)
    // passed no 6th argument at all; this is that shape. The PR2 adapter now
    // passes the empty `layerStack` ref as the 6th arg, which the row below
    // proves equivalent. Confirm the omitted-argument form and the
    // explicit-empty-array form agree, and that both match the pre-existing
    // (5-arg) results already pinned above.
    const rows: Array<
      [
        Parameters<typeof popAction>[0],
        Parameters<typeof popAction>[1],
        boolean,
        boolean,
        boolean?,
      ]
    > = [
      ["back", "recorder", false, false],
      ["back", "segments", false, false],
      ["back", "books", false, false],
      ["forward", "segments", false, false],
      ["forward", "recorder", false, false],
      ["same", "segments", false, false],
      ["back", "recorder", true, false],
      ["back", "segments", true, false],
      ["forward", "recorder", true, false],
      ["back", "segments", false, true],
      ["back", "books", false, true],
      ["back", "recorder", false, true],
      ["back", "books", false, false, true],
      ["back", "segments", false, false, true],
      ["back", "recorder", false, false, true],
    ];
    for (const [
      direction,
      screen,
      committing,
      recovering,
      databasePanel,
    ] of rows) {
      const withoutSixthArg =
        databasePanel === undefined
          ? popAction(direction, screen, committing, recovering)
          : popAction(direction, screen, committing, recovering, databasePanel);
      const withExplicitEmptyStack =
        databasePanel === undefined
          ? popAction(direction, screen, committing, recovering, false, [])
          : popAction(
              direction,
              screen,
              committing,
              recovering,
              databasePanel,
              []
            );
      expect(withExplicitEmptyStack).toEqual(withoutSixthArg);
    }
  });

  /**
   * George R1 P2-1 (PR #492): a `popstate` has already popped the SCREEN-DEPTH
   * entry before `popAction` runs (the adapter updates `navIndex` from the
   * landing index just before the call, `hooks/use-nav-stack.ts`) — overlays
   * never owned one of their own (invariant 1). Every existing intercept that is
   * not a real screen pop re-arms with `pushHistoryEntry()`
   * (`trap-recovery`/`trap-database-panel`/`rearm-transition-busy`, the adapter's
   * `switch` cases), and so does the recorder's own commit-close re-arm (it
   * pushes BEFORE the overlay is even asked to dismiss). The layer case must
   * match: BOTH a dismiss and a refusal re-arm the entry the popstate already
   * consumed — `"dismiss"` also tells the adapter to dismiss the top layer
   * (recovered via `topLayer(stack)`), `"refused-busy"` re-arms only. Two string
   * tags, not an object, so the obligation is encoded in the type the adapter's
   * string `switch` already consumes, not left to prose a reader could miss (the
   * bug this replaces: `tests/nav-layer-stack.test.ts`'s old comment taught
   * "nothing on refused-busy").
   */
  it("a non-empty stack with a non-busy top layer re-arms AND signals dismiss", () => {
    const stack: LayerStack = [fakeLayer("book-menu", false)];
    expect(popAction("back", "books", false, false, false, stack)).toBe(
      "rearm-layer-dismiss"
    );
  });

  it("a non-empty stack with a busy top layer re-arms only — never the screen-level routing", () => {
    const stack: LayerStack = [fakeLayer("deleting", true)];
    expect(popAction("back", "books", false, false, false, stack)).toBe(
      "rearm-layer-busy"
    );
    // Prove it did NOT fall through to backEffectFor("books") = "exit-app".
    expect(popAction("back", "books", false, false, false, stack)).not.toBe(
      "exit-app"
    );
  });

  it("only the TOP layer is routed — a layer beneath a busy top is never asked (invariant 3)", () => {
    const stack: LayerStack = [
      fakeLayer("bottom-menu", false),
      fakeLayer("top-confirm", true),
    ];
    expect(popAction("back", "segments", false, false, false, stack)).toBe(
      "rearm-layer-busy"
    );
  });

  it("the two global traps still outrank a non-empty layer stack", () => {
    const stack: LayerStack = [fakeLayer("menu", false)];
    expect(popAction("back", "books", false, true, false, stack)).toBe(
      "trap-recovery"
    );
    expect(popAction("back", "books", false, false, true, stack)).toBe(
      "trap-database-panel"
    );
  });

  it("a screen transition in flight (transitionInFlight) still outranks a non-empty layer stack (invariant 3: 'no screen transition in flight')", () => {
    const stack: LayerStack = [fakeLayer("menu", false)];
    expect(popAction("back", "recorder", true, false, false, stack)).toBe(
      REARM_TRANSITION_BUSY
    );
  });

  /**
   * George R2 P2-1 (PR #492): the layer-routing premise — "a popstate has
   * ALREADY popped the screen-depth entry" — holds only for Back. Forward
   * RESTORED a previously truncated entry; its live cancel is `trap-forward`'s
   * own extra `history.back()`, not a layer re-arm. The F2 row above
   * (`"traps a Forward instead of misrouting it as a Back"`) uses the
   * empty-stack default and so CANNOT catch a non-empty stack shadowing it —
   * these two rows exist specifically because that one does not cover this.
   */
  it("a non-empty stack does not shadow Forward — `trap-forward` still cancels it, never a layer re-arm (George R2 P2-1)", () => {
    const nonBusyStack: LayerStack = [fakeLayer("menu", false)];
    const busyStack: LayerStack = [fakeLayer("deleting", true)];
    expect(
      popAction("forward", "segments", false, false, false, nonBusyStack)
    ).toBe("trap-forward");
    expect(
      popAction("forward", "recorder", false, false, false, busyStack)
    ).toBe("trap-forward");
  });

  it("a non-empty stack does not shadow 'same' — `ignore` still wins, never a layer re-arm (George R2 P2-1)", () => {
    const stack: LayerStack = [fakeLayer("menu", false)];
    expect(popAction("same", "segments", false, false, false, stack)).toBe(
      "ignore"
    );
  });
});
