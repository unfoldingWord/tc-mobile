import { describe, expect, it } from "vitest";

import {
  backEffectFor,
  navDirection,
  overlayBlocksClose,
  overlayDismissal,
  popAction,
  reconcilePopState,
  screenFor,
} from "@/lib/nav/navigation";

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

  it("re-arms every gesture while a recorder commit is in flight (F1)", () => {
    // The load-bearing F1 row. First Back starts the commit…
    expect(popAction("back", "recorder", false, false)).toBe(
      "commit-close-recorder"
    );
    // …and a SECOND Back arriving before it settles must re-arm the protective
    // entry, never escape the recorder and drop the uncommitted take (#58).
    // `committing` wins over direction and screen, so nothing else can leave.
    expect(popAction("back", "recorder", true, false)).toBe(
      "rearm-during-commit"
    );
    expect(popAction("back", "segments", true, false)).toBe(
      "rearm-during-commit"
    );
    expect(popAction("forward", "recorder", true, false)).toBe(
      "rearm-during-commit"
    );
  });

  it("re-arms on Books too, the same way (George round 1 P2-1, #393)", () => {
    // App now OR's a second ref (`dismissingOverlay`) into the `committing`
    // argument for the window between `dismiss-screen-overlay` re-arming and
    // Books'/Segments' own overlay-close consume actually landing as a
    // popstate — reusing this exact row rather than adding a new `PopAction`
    // case, since the effect (re-arm, absorb) is identical. `committing`
    // could previously only ever be true for "recorder"/"segments" (an
    // in-flight recorder commit); this pins the previously-untested "books"
    // combination the new caller introduces.
    expect(popAction("back", "books", true, false)).toBe("rearm-during-commit");
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

  describe("screenOverlayOpen (#393, #374)", () => {
    it("dismisses Books'/Segments' own overlay instead of exit-app/to-books", () => {
      // The load-bearing #393/#374 row: a system Back used to walk straight past
      // an open Menu/rename/delete-confirm to the plain screen effect, silently
      // abandoning a typed name or leaving a write committing with nothing open
      // to show it. `screenOverlayOpen` must outrank `backEffectFor`.
      expect(popAction("back", "books", false, false, true)).toBe(
        "dismiss-screen-overlay"
      );
      expect(popAction("back", "segments", false, false, true)).toBe(
        "dismiss-screen-overlay"
      );
    });

    it("defaults to false and preserves the pre-#393 mapping when nothing is open", () => {
      // Every existing call site (and every row above) omits this argument —
      // it must default to false, not to an overlay always being open.
      expect(popAction("back", "books", false, false)).toBe("exit-app");
      expect(popAction("back", "segments", false, false)).toBe("to-books");
      expect(popAction("back", "books", false, false, false)).toBe("exit-app");
      expect(popAction("back", "segments", false, false, false)).toBe(
        "to-books"
      );
    });

    it("never applies to the recorder — its own overlays stay inside commit-close-recorder", () => {
      // The recorder's ≡ menu/erase-confirm are handled entirely by
      // `overlayBlocksClose`/`overlayDismissal` inside `commit-close-recorder`
      // (unchanged). If this ever routed the recorder to
      // `dismiss-screen-overlay` instead, Back would stop running the commit
      // path at all — the exact #58 regression `backEffectFor("recorder")`
      // guards above, reached through a different door.
      expect(popAction("back", "recorder", false, false, true)).toBe(
        "commit-close-recorder"
      );
    });

    it("is outranked by recovery, an in-flight commit, and Forward/same", () => {
      // Screen-overlay dismissal is real navigation-effect work; every trap
      // above it in the decision must still win regardless of it.
      expect(popAction("back", "segments", false, true, true)).toBe(
        "trap-recovery"
      );
      expect(popAction("back", "segments", true, false, true)).toBe(
        "rearm-during-commit"
      );
      expect(popAction("forward", "segments", false, false, true)).toBe(
        "trap-forward"
      );
      expect(popAction("same", "segments", false, false, true)).toBe("ignore");
    });
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
    // The load-bearing R4 row: clearing `confirmOpen` mid-erase would let a
    // system Back reach Record again (the HEADER's `inert` — not only the
    // sheet's, corrected here per #376 — is what the confirm/erase keep up),
    // whose new capture the erase completion then discards. While erasing, the
    // confirm is left alone — the erase tears itself down.
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

  it("refuses a busy menu close (Back during create, create in flight, #393)", () => {
    // The load-bearing regression row (Frank, on 25faf3f): Books' New Book
    // dialog refuses to close mid-create (`onCancelNewBook`'s own
    // `creatingBook.current` guard) — the write cannot be recalled, unlike a
    // rename, which lands silently underneath a closed menu instead.
    // `menuBusy=true` must make `closeMenu` false even though the menu IS
    // open, exactly mirroring how `erasing` already refuses `closeConfirm`
    // above. App's `dismissingOverlay` latch reads `closeMenu || closeConfirm`
    // back from this function, so a wrong `true` here would strand every
    // later Back on `rearm-during-commit` even once the create settles.
    expect(overlayDismissal(true, false, false, true)).toEqual({
      closeMenu: false,
      closeConfirm: false,
    });
  });

  it("Back during create, create fails, next Back dismisses (Frank, #393)", () => {
    // The exact scenario Frank named: while `menuBusy` is true (a create in
    // flight) a Back is refused — nothing closes, so the screen keeps
    // whatever protective history entry it already holds. Once the create
    // SETTLES (fails, and the dialog stays open but is cancellable again —
    // `creatingBook.current` back to false), the very next Back must dismiss
    // for real. Two calls, same inputs but for `menuBusy`, standing in for
    // "before the write settles" and "after" on the one boolean this
    // function actually decides on.
    expect(overlayDismissal(true, false, false, true)).toEqual({
      closeMenu: false,
      closeConfirm: false,
    });
    expect(overlayDismissal(true, false, false, false)).toEqual({
      closeMenu: true,
      closeConfirm: false,
    });
  });

  it("defaults menuBusy to false, preserving every pre-#393 call site (recorder, Segments)", () => {
    // Neither the recorder's nor Segments' call site passes a 4th argument —
    // both must keep behaving exactly as before this parameter existed.
    expect(overlayDismissal(true, false, false)).toEqual({
      closeMenu: true,
      closeConfirm: false,
    });
  });
});

/**
 * George round 3 P3-3 (#393): the App History wiring (`suppressPop`,
 * `pendingPush`, `backRequested`) had no Node table of its own — only
 * `popAction`/`overlayDismissal` were pinned — and George's rounds 2 AND 3
 * both found a real defect in exactly this arithmetic while it lived only as
 * refs. `reconcilePopState` is the extracted decision: given how many of
 * THIS app's own `history.back()` calls are outstanding, and how many index
 * levels a landed popstate actually traversed backward, how much of that
 * traversal is ours to absorb versus a genuine navigation still needing
 * routing. This table is what would have failed both George R3 P2s before
 * their fix: round-2's model (`suppressPop.current` as a boolean, one
 * popstate always fully "ours") could not represent row 3 below (a coalesced
 * jump bigger than what was outstanding) or row 4 (more outstanding than one
 * popstate resolves).
 */
describe("reconcilePopState (#393, George round 3 P3-3)", () => {
  it("is null (route normally) when nothing of ours is outstanding", () => {
    // The ordinary case: a genuine system/on-screen Back with no programmatic
    // back() in flight. Every popstate before this PR's overlay/recorder
    // consumes existed took this path.
    expect(reconcilePopState(0, 1)).toBeNull();
  });

  it("is null for a forward or same-index move regardless of outstanding count", () => {
    // `delta <= 0` is `navDirection`'s concern (forward/same), never this
    // function's — even with something outstanding, a non-backward delta is
    // not this app's own back() resolving.
    expect(reconcilePopState(1, 0)).toBeNull();
    expect(reconcilePopState(2, -1)).toBeNull();
  });

  it("fully absorbs a single outstanding back() against a single-step popstate", () => {
    // The common consume case (an overlay close, a programmatic recorder
    // close): one `back()` issued, one popstate, exactly accounted for.
    expect(reconcilePopState(1, 1)).toEqual({
      outstandingBacks: 0,
      remaining: 0,
    });
  });

  it("splits a coalesced jump bigger than what was outstanding (George R3 P2-1)", () => {
    // The load-bearing row for P2-1: one outstanding consume `back()`, but the
    // browser coalesced it with a SECOND, genuine Back (a header Back tapped
    // in the async gap before the consume's own popstate landed) into ONE
    // popstate whose index jumped by 2. Round 2's single-bit `suppressPop`
    // treated any popstate in that window as fully "ours" and silently ate
    // the extra step — exactly the bug George's round 3 P2-1 found. This
    // model attributes only what was outstanding (1) and reports the other
    // level as `remaining`, so the caller still routes it.
    expect(reconcilePopState(1, 2)).toEqual({
      outstandingBacks: 0,
      remaining: 1,
    });
  });

  it("absorbs only part of a multi-step popstate when MORE was outstanding (George R3 P2-2)", () => {
    // The mirror row for P2-2: two outstanding back()s (an overlay consume,
    // then a recorder close chained through it), delivered as one popstate
    // that only travelled one level so far (sequential delivery, not fully
    // coalesced yet) — one is accounted for, one is still owed, and NOTHING
    // should be routed as a genuine navigation from this popstate alone.
    expect(reconcilePopState(2, 1)).toEqual({
      outstandingBacks: 1,
      remaining: 0,
    });
  });

  it("fully absorbs two outstanding back()s coalesced into one two-step popstate", () => {
    expect(reconcilePopState(2, 2)).toEqual({
      outstandingBacks: 0,
      remaining: 0,
    });
  });

  it("absorbs two outstanding back()s delivered as two separate one-step popstates", () => {
    // Same starting count as the row above, but the OTHER legal delivery
    // shape (sequential, not coalesced) — this model does not need to know
    // in advance which one the browser will choose; each popstate is
    // reconciled independently against whatever is still outstanding.
    const first = reconcilePopState(2, 1);
    expect(first).toEqual({ outstandingBacks: 1, remaining: 0 });
    const second = reconcilePopState(first!.outstandingBacks, 1);
    expect(second).toEqual({ outstandingBacks: 0, remaining: 0 });
  });
});
