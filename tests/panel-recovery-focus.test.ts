import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  panelRecoveryFocus,
  type PanelRecoveryAction,
} from "@/lib/a11y/panel-recovery";

/**
 * The recovery-path focus decision (#199).
 *
 * A truth table, not a phone, for the same reason `focus-restore.ts` is one:
 * the DOM half has no automated coverage in this repo (#361) and is not
 * claimed as tested. What is pinned here is WHEN focus must be handed back
 * into the sheet — which is the part #199 asked to be decided explicitly
 * rather than left an omission.
 */
describe("panelRecoveryFocus (#199)", () => {
  it("hands focus back when a full-body panel resolves successfully", () => {
    // The whole point: a "Try again" that SUCCEEDS unmounts LoadErrorPanel with
    // focus on its own autoFocused control. The sheet's focus grab is
    // mount-only, and the Segments list behind is inert, so focus lands on
    // <body> and the next Tab reaches the header Back.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: false,
        closing: false,
      })
    ).toBe("focus");
  });

  it("idles while a panel still owns the body", () => {
    // Its own autoFocus is the correct landing; stealing that back would strand
    // a screen-reader user off the Retry they were just handed.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: true,
        closing: false,
      })
    ).toBe("idle");
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: true,
        closing: false,
      })
    ).toBe("idle");
  });

  it("idles on a commit where no panel was ever up", () => {
    // The steady state — every ordinary render of a healthy sheet. Firing here
    // would yank focus off whatever the translator is actually using.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: false,
        closing: false,
      })
    ).toBe("idle");
  });

  it("HOLDS when the panel cleared because the sheet is closing", () => {
    // `heldTake`'s two-tap discard clears the panel AND closes the recorder in
    // the same turn. Focusing inside a sheet that is unmounting is dead code at
    // best; at worst it fights the Segments screen's own hand-off. Same
    // `isClosing` guard the overlay restore in `recorder.tsx` already takes,
    // and the same reason.
    //
    // `hold`, not `idle`: that close can FAIL and leave the sheet mounted, and
    // the caller must not spend the pending recovery on this commit. That is
    // the QA-review P2 on #457 — see the sequence tests at the foot of this
    // file, which are what actually pin it.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: false,
        closing: true,
      })
    ).toBe("hold");
  });

  it("is the panel-resolved edge, not any panel change", () => {
    // Exhaustive over the eight inputs, so a later "simplification" to
    // `ownedLastCommit !== ownsNow` (which would also fire on the panel
    // APPEARING, stealing its autoFocus) fails here.
    const rows = [false, true].flatMap((ownedLastCommit) =>
      [false, true].flatMap((ownsNow) =>
        [false, true].map((closing) => ({
          input: { ownedLastCommit, ownsNow, closing },
          out: panelRecoveryFocus({ ownedLastCommit, ownsNow, closing }),
        }))
      )
    );
    expect(rows.filter((r) => r.out === "focus").map((r) => r.input)).toEqual([
      { ownedLastCommit: true, ownsNow: false, closing: false },
    ]);
    // And every closing commit HOLDS rather than idling — the half that keeps
    // a pending recovery alive across a close that fails (#457 QA P2).
    expect(rows.filter((r) => r.out === "hold").length).toBe(4);
  });
});

/**
 * The consumed-history defect (QA review P2 on #457).
 *
 * The first version of this returned a boolean and the effect wrote its
 * previous-commit ref on EVERY commit. That spent the pending recovery on the
 * closing commit, and there is a real path where the sheet then stays open:
 * `leaveHeldTake()` clears `heldTake` and sets `isClosing = true`, then
 * `executeTail()` awaits — and a failed clear or Finished write calls
 * `stayOpen()`, which sets `isClosing = false` and leaves the recorder mounted.
 * By that commit `ownedLastCommit` was already false, so the removed panel's
 * control never got a focus hand-off and focus stayed on <body>.
 *
 * `recorder.tsx`'s own overlay-restore effect, a hundred lines above the one
 * this feeds, already carried the lesson in its comment — "HOLD the capture
 * through the commit window rather than spending it" — and the first version of
 * this module did not apply it. So the decision is now three-valued: `hold`
 * means do nothing AND remember nothing, which is what makes the recovery
 * survive a close that fails.
 *
 * Sequence-level, not a DOM reproduction: the caller path was read in
 * `recorder.tsx` and the transitions replayed here. The `.focus()` call itself
 * is still uncovered (#361).
 */
describe("panelRecoveryFocus holds through a close that may fail (#457 QA P2)", () => {
  /** Replay a run of commits the way the effect does, and report every focus. */
  function replay(commits: readonly { panel: boolean; closing: boolean }[]): {
    focused: number[];
    actions: PanelRecoveryAction[];
  } {
    let ownedLastCommit = false;
    const focused: number[] = [];
    const actions: PanelRecoveryAction[] = [];
    commits.forEach(({ panel, closing }, i) => {
      const action = panelRecoveryFocus({
        ownedLastCommit,
        ownsNow: panel,
        closing,
      });
      actions.push(action);
      if (action === "focus") focused.push(i);
      // `hold` is the whole point: the ref is NOT written, so the pending
      // recovery survives into the next commit.
      if (action !== "hold") ownedLastCommit = panel;
    });
    return { focused, actions };
  }

  it("lands focus when a held-take discard's close FAILS and the sheet stays open", () => {
    // The exact sequence the reviewer traced through `leaveHeldTake` →
    // `executeTail` → `stayOpen`.
    const { focused, actions } = replay([
      { panel: true, closing: false }, // recovery panel up
      { panel: false, closing: true }, // heldTake cleared, isClosing set
      { panel: false, closing: false }, // stayOpen(): the write failed, sheet lives
    ]);
    expect(actions).toEqual(["idle", "hold", "focus"]);
    expect(focused).toEqual([2]);
  });

  it("still lands focus on the ordinary retry-succeeds path", () => {
    // The #199 case must not regress: no closing commit at all.
    const { focused } = replay([
      { panel: true, closing: false },
      { panel: false, closing: false },
    ]);
    expect(focused).toEqual([1]);
  });

  it("focuses once, not twice, when a close fails after several closing commits", () => {
    // `executeTail` awaits, so `isClosing` can span more than one commit (the
    // elapsed-ms tick alone re-renders this sheet). Every one of them holds.
    const { focused } = replay([
      { panel: true, closing: false },
      { panel: false, closing: true },
      { panel: false, closing: true },
      { panel: false, closing: true },
      { panel: false, closing: false },
    ]);
    expect(focused).toEqual([4]);
  });

  it("does not focus when the panel goes up and straight into a close", () => {
    // No panel was ever resolved — it appeared and the sheet began closing. A
    // `hold` that later fired here would steal focus for a recovery that never
    // happened.
    const { focused } = replay([
      { panel: false, closing: false },
      { panel: true, closing: false },
      { panel: true, closing: true },
      { panel: true, closing: false },
    ]);
    expect(focused).toEqual([]);
  });

  it("never focuses on a commit where the sheet is closing", () => {
    // Focusing into a sheet that is unmounting is dead code at best, and at
    // worst fights the Segments screen's own hand-off.
    for (const ownedLastCommit of [false, true])
      for (const ownsNow of [false, true])
        expect(
          panelRecoveryFocus({ ownedLastCommit, ownsNow, closing: true })
        ).toBe("hold");
  });
});

/**
 * WHERE the recovery lands (George R1 P2 on #457).
 *
 * The decision above says WHEN; this pins the target. The first version of the
 * caller reused the open-edge landing — the sheet's first `button`, which is
 * header Back — for the recovery edge too. Back is `close()`, which SAVES, and
 * `use-focus-restore.ts`'s contract is explicit that a landmark "must never be
 * a destructive or exiting control": a keyboard/switch user whose "Try again"
 * had just succeeded would have had the very next Space/Enter/switch-activate
 * armed to leave — the #97 hazard, on exactly the users #199 exists for.
 *
 * Open and recovery are different edges: open is not mid-task, recovery is.
 * So the recovery lands on the ≡, resolved by accessible name through
 * `overlayFallbackLabel` — the same landmark the overlay restore in the same
 * file uses, for the same reason — and never by position.
 *
 * Source-shape, because there is no DOM runner here (#197) and the `.focus()`
 * itself stays uncovered (#361).
 */
describe("the recovery landing is the ≡ landmark, never the sheet's first button (#457 George R1 P2)", () => {
  const recorder = readFileSync(
    path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
    "utf8"
  );

  it("hands a `focus` action to the menu landmark", () => {
    expect(recorder).toMatch(
      /if \(action === "focus"\) menuLandmark\(\)\?\.focus\(\);/
    );
    expect(
      recorder,
      "the recovery edge still lands on header Back"
    ).not.toMatch(/if \(action === "focus"\) focusSheet\(\);/);
  });

  it("resolves that landmark by accessible name, not by position", () => {
    const start = recorder.indexOf("const menuLandmark = useCallback(");
    expect(start, "no menuLandmark callback in recorder.tsx").toBeGreaterThan(
      -1
    );
    const body = recorder.slice(start, recorder.indexOf("}, []);", start));
    expect(body).toMatch(
      /overlayFallbackLabel\(labels, strings\.recorderMenuOpen\)/
    );
    expect(body).not.toMatch(/querySelector<HTMLElement>\("button"\)/);
  });

  it("keeps the open-edge landing as its own call, used on the open edge only", () => {
    // `focusSheet` still exists — the open edge is allowed to land on the
    // sheet's first control — but it is called from exactly one place now.
    expect(recorder.match(/focusSheet\(\);/g)?.length).toBe(1);
  });
});
