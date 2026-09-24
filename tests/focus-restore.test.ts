import { describe, expect, it } from "vitest";

import {
  focusRestoreTarget,
  overlayFallbackLabel,
} from "@/lib/a11y/focus-restore";

/**
 * #97 — where focus goes when an overlay closes.
 *
 * The rule this file exists to pin is the ORDERING one: a captured trigger that
 * is still inside an `inert` subtree is NOT a restore target, because
 * `.focus()` on it is a silent no-op.
 *
 * These tests exercise only the pure decision. They do not read
 * `document.activeElement`, inspect DOM ancestry with `closest("[inert]")`,
 * or run the layout effect that calls `.focus()`. Browser focus behavior
 * remains outside this suite's scope (#361).
 */

/** The shape every case starts from: a healthy, restorable trigger. */
const restorable = {
  captured: true,
  suppressed: false,
  connected: true,
  inert: false,
  focusable: true,
  hasFallback: true,
} as const;

describe("focusRestoreTarget", () => {
  it("returns the trigger when it is still alive, focusable and out of inert", () => {
    expect(focusRestoreTarget(restorable)).toBe("previous");
  });

  it("returns the trigger even when there is no fallback to fall back to", () => {
    expect(focusRestoreTarget({ ...restorable, hasFallback: false })).toBe(
      "previous"
    );
  });

  it("does nothing when the open edge captured nothing", () => {
    // A touch user has no focused element when the menu opens
    // (`document.activeElement` is `<body>`), and forcing a focus ring onto
    // them on close would be inventing a state they never had. A fallback is
    // deliberately NOT used here: nothing was taken, so nothing is restored.
    expect(
      focusRestoreTarget({ ...restorable, captured: false, hasFallback: true })
    ).toBe("none");
  });

  it("does nothing when another surface has already taken focus", () => {
    // The recorder's full-body panels (permission, load-failed, held-take) each
    // `autoFocus` their own primary control in the same commit that tears the
    // overlay down. Restoring on top of that would yank a screen-reader user
    // off the Retry they were just handed. The capture is still CONSUMED, so a
    // later close cannot resurrect it (this is the `suppressed` contract).
    expect(focusRestoreTarget({ ...restorable, suppressed: true })).toBe(
      "none"
    );
  });

  it("suppression beats a perfectly good trigger", () => {
    expect(
      focusRestoreTarget({
        ...restorable,
        suppressed: true,
        hasFallback: false,
      })
    ).toBe("none");
  });

  it("falls back when the trigger is still INERT — the ordering case", () => {
    // THE case. The trigger is alive and focusable, and `.focus()` on it would
    // still do nothing, because an element inside an inert subtree cannot take
    // focus. A restore that runs before the subtree's `inert` lifts must not
    // report success by picking "previous".
    expect(focusRestoreTarget({ ...restorable, inert: true })).toBe("fallback");
  });

  it("falls back when the trigger has been detached", () => {
    // The row `⋮` and both erase confirms tear their trigger's subtree down as
    // they close; a menu row that opened a dialog is gone by the time the
    // dialog closes.
    expect(focusRestoreTarget({ ...restorable, connected: false })).toBe(
      "fallback"
    );
  });

  it("falls back when the trigger has gone natively disabled", () => {
    // The recorder's ≡ opener is `disabled` while `denied`, while a take is
    // held, and through the close window. A natively disabled button can never
    // be `document.activeElement`.
    expect(focusRestoreTarget({ ...restorable, focusable: false })).toBe(
      "fallback"
    );
  });

  it("gives up rather than inventing a target when there is no fallback", () => {
    for (const broken of [
      { inert: true },
      { connected: false },
      { focusable: false },
    ]) {
      expect(
        focusRestoreTarget({ ...restorable, ...broken, hasFallback: false })
      ).toBe("none");
    }
  });

  it("treats a trigger that is detached AND inert AND disabled as one case", () => {
    expect(
      focusRestoreTarget({
        ...restorable,
        connected: false,
        inert: true,
        focusable: false,
      })
    ).toBe("fallback");
  });
});

describe("overlayFallbackLabel — #368 George R5 P2", () => {
  const menuOpenLabel = "More actions";

  it("never resolves to the header's last button — the modepill, an exit control", () => {
    // Edit mode's header is [Back, modepill]. The old fallback query picked
    // "the last header button" positionally and landed on the modepill
    // ("Done editing"), which EXITS edit mode — arming the very next
    // Space/Enter/switch-activate to leave. This is the exact case George
    // reported: no menu-opener present in this candidate list at all, so the
    // only correct answer is `null`, never "Done editing".
    expect(
      overlayFallbackLabel(["Close recorder", "Done editing"], menuOpenLabel)
    ).toBeNull();
  });

  it("resolves to the menu opener when it is present, in record mode's header", () => {
    expect(
      overlayFallbackLabel(["Close recorder", menuOpenLabel], menuOpenLabel)
    ).toBe(menuOpenLabel);
  });

  it("resolves to the menu opener when it is present, in edit mode's toolbar", () => {
    // The edit-mode ≡ lives in the toolbar, not the header, and shares the
    // header opener's exact accessible name — the one label safe in both
    // modes.
    expect(
      overlayFallbackLabel(
        ["Zoom in", "Select", "Undo", "Redo", menuOpenLabel],
        menuOpenLabel
      )
    ).toBe(menuOpenLabel);
  });

  it("is not positional — the menu opener wins regardless of where it sits in the list", () => {
    expect(
      overlayFallbackLabel([menuOpenLabel, "Done editing"], menuOpenLabel)
    ).toBe(menuOpenLabel);
  });

  it("gives up rather than guessing when nothing safe is present", () => {
    expect(overlayFallbackLabel([], menuOpenLabel)).toBeNull();
    expect(overlayFallbackLabel(["Close recorder"], menuOpenLabel)).toBeNull();
  });
});
