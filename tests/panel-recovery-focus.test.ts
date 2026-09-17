import { describe, expect, it } from "vitest";

import { panelRecoveryFocus } from "@/lib/a11y/panel-recovery";

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
    ).toBe(true);
  });

  it("does nothing while a panel still owns the body", () => {
    // Its own autoFocus is the correct landing; stealing that back would strand
    // a screen-reader user off the Retry they were just handed.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: true,
        closing: false,
      })
    ).toBe(false);
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: true,
        closing: false,
      })
    ).toBe(false);
  });

  it("does nothing on a commit where no panel was ever up", () => {
    // The steady state — every ordinary render of a healthy sheet. Firing here
    // would yank focus off whatever the translator is actually using.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: false,
        closing: false,
      })
    ).toBe(false);
  });

  it("does nothing when the panel cleared because the sheet is closing", () => {
    // `heldTake`'s two-tap discard clears the panel AND closes the recorder in
    // the same turn. Focusing inside a sheet that is unmounting is dead code at
    // best; at worst it fights the Segments screen's own hand-off. Same
    // `isClosing` guard the overlay restore in `recorder.tsx` already takes,
    // and the same reason.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: false,
        closing: true,
      })
    ).toBe(false);
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
    expect(rows.filter((r) => r.out).map((r) => r.input)).toEqual([
      { ownedLastCommit: true, ownsNow: false, closing: false },
    ]);
  });
});
